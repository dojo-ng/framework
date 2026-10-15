/**
 * WSDispatcher against the fake socket, with fake timers for the backoff/heartbeat cases.
 * Every case here is a named behavior, and every one is written to
 * fail without its feature — see the source comments below for how each discriminates.
 *
 * Run: node --test test/wsdispatcher.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WSDispatcher } from "../dist/wsdispatcher.js";
import { withFakeWebSocketAsync } from "./helpers/fake-websocket.mjs";

// The Fibonacci step table, copied literally rather than
// imported from the module under test — importing the module's own constant would let a wrong
// table pass against itself.
const TIMEOUT_BASE_S = 15;
const TIMEOUT_STEP = [0, 0, 0, 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

function sentFrames(fake) {
	return fake.sent.map((s) => JSON.parse(s));
}

test("call() sent while closed resolves only after the socket opens and flushes", async () => {
	await withFakeWebSocketAsync(async () => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		const promise = dispatcher.call({ hello: "world" });

		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		// Without the offline queue, call() would have tried to send immediately while closed —
		// WSocket.send() returns NOT_READY and nothing is queued, so no frame would ever reach the
		// fake here, and this assertion is what catches that.
		const callFrame = sentFrames(fake).find((f) => f.action === "call");
		assert.ok(callFrame, "the call frame was never sent");

		fake.onmessage({ data: JSON.stringify({ action: "call", id: callFrame.id, data: "reply" }) });
		assert.equal(await promise, "reply");
	});
});

test("two concurrent call()s resolve to their own responses, not each other's", async () => {
	await withFakeWebSocketAsync(async () => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		const p1 = dispatcher.call("first");
		const p2 = dispatcher.call("second");

		const [f1, f2] = sentFrames(fake).filter((f) => f.action === "call");
		assert.notEqual(f1.id, f2.id);

		// Answered out of order on purpose: if correlation used anything other than the response's
		// own id (e.g. resolving whichever call is oldest), this would cross-wire the two replies.
		fake.onmessage({ data: JSON.stringify({ action: "call", id: f2.id, data: "reply-to-second" }) });
		fake.onmessage({ data: JSON.stringify({ action: "call", id: f1.id, data: "reply-to-first" }) });

		assert.equal(await p1, "reply-to-first");
		assert.equal(await p2, "reply-to-second");
	});
});

test("reconnect backoff follows the Fibonacci step table and resets after a successful open", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		let fake = dispatcher.socket.socket;
		fake.simulateOpen();

		for (const step of TIMEOUT_STEP.slice(0, 6)) {
			const expectedDelayMs = (step + TIMEOUT_BASE_S) * 1000;
			// A pre-open error, not fake.close() — the reopened socket after the first iteration is
			// still CONNECTING (never told to simulateOpen()), and WSocket doesn't wire onclose until
			// onopen fires, so fake.close() would be a silent no-op on it. WSocket's pre-open onerror
			// IS wired from the start (and stays wired, reassigned, after open too), so it works
			// uniformly here whether `fake` has opened yet or not — and staying unopened is the point:
			// simulateOpen() would reset reopenCount, which is exactly what this loop must NOT do.
			fake.onerror({ type: "error" });
			// WSocket nulls its own #socket synchronously once the close finishes.
			assert.equal(dispatcher.socket.socket, null);

			t.mock.timers.tick(expectedDelayMs - 1);
			assert.equal(dispatcher.socket.socket, null, `reopened early, before ${expectedDelayMs}ms`);

			t.mock.timers.tick(1);
			const next = dispatcher.socket.socket;
			assert.notEqual(next, null, `did not reopen at ${expectedDelayMs}ms`);
			fake = next; // still connecting — next iteration's onerror continues the same backoff run
		}

		// A successful open resets the counter. Confirm by dropping once more and checking the delay
		// is back to the table's first entry, not a continuation of the run above.
		fake.simulateOpen();
		fake.close();
		const resetDelayMs = (TIMEOUT_STEP[0] + TIMEOUT_BASE_S) * 1000;
		t.mock.timers.tick(resetDelayMs - 1);
		assert.equal(dispatcher.socket.socket, null);
		t.mock.timers.tick(1);
		assert.notEqual(dispatcher.socket.socket, null);
	});
});

test("dispatcher.close() schedules no reconnect", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		dispatcher.close();
		assert.equal(dispatcher.socket.socket, null); // WSocket nulls its own #socket once close finishes

		// Comfortably longer than any single backoff step (max is TIMEOUT_STEP[15]+15 = 248s). If the
		// `closing` flag didn't suppress #scheduleReopen, a new socket would appear well before this.
		t.mock.timers.tick(10 * 60 * 1000);
		assert.equal(dispatcher.socket.socket, null);
		assert.equal(dispatcher.isOpen(), false);
	});
});

test("a missed PING closes the socket, waits 2s, then reopens through the normal backoff path", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		fake.onmessage({ data: JSON.stringify({ action: "ping", id: 0, data: null }) });

		t.mock.timers.tick(39_999);
		assert.equal(dispatcher.isOpen(), true, "closed before the 40s watchdog expired");

		t.mock.timers.tick(1); // 40_000ms total: watchdog expires, close() runs
		assert.equal(dispatcher.isOpen(), false);
		assert.equal(dispatcher.socket.socket, null);

		t.mock.timers.tick(1_999);
		assert.equal(dispatcher.socket.socket, null, "reopened before the 2s recovery delay");

		t.mock.timers.tick(1); // +2_000ms: closing is cleared and a reopen is scheduled (not immediate)
		assert.equal(dispatcher.socket.socket, null, "reopened immediately instead of going through backoff");

		const backoffMs = (TIMEOUT_STEP[0] + TIMEOUT_BASE_S) * 1000;
		t.mock.timers.tick(backoffMs - 1);
		assert.equal(dispatcher.socket.socket, null);
		t.mock.timers.tick(1);
		assert.notEqual(dispatcher.socket.socket, null);
	});
});

test("the onConnect identity frame is sent before any queued message", async () => {
	await withFakeWebSocketAsync(() => {
		const identityFrame = { action: "event", id: 0, data: { event: "identify", params: { who: "me" } } };
		const dispatcher = new WSDispatcher({
			url: "wss://example.test",
			onConnect: () => [identityFrame],
		});

		// Queued before the socket even exists — if identity were sent AFTER a flush instead of
		// before it, or the queue drained before onConnect ran, this ordering would flip.
		dispatcher.call("payload");

		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		const sent = sentFrames(fake);
		assert.deepEqual(sent[0], identityFrame);
		assert.equal(sent[1].action, "call");
		assert.equal(sent[1].data, "payload");
	});
});

test("inbound event frames publish on pub/sub under their own name; publishing the outbound topic sends one", async () => {
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		const seen = [];
		dispatcher.pubsub.subscribe("some:topic", (payload) => seen.push(payload), { replay: false });
		fake.onmessage({
			data: JSON.stringify({ action: "event", id: 0, data: { event: "some:topic", params: { x: 1 } } }),
		});
		assert.deepEqual(seen, [{ x: 1 }]);

		dispatcher.pubsub.publish("notify:event", { event: "outbound:topic", params: { y: 2 } });
		const sentEvent = sentFrames(fake).find((f) => f.action === "event");
		assert.deepEqual(sentEvent.data, { event: "outbound:topic", params: { y: 2 } });
	});
});

test("simulate('disconnect') closes with no reconnect; simulate('connect') opens only if not already open", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test" });
		dispatcher.open();
		const fake = dispatcher.socket.socket;
		fake.simulateOpen();

		dispatcher.simulate("disconnect");
		assert.equal(dispatcher.isOpen(), false);
		t.mock.timers.tick(60_000);
		assert.equal(dispatcher.socket.socket, null, "simulate('disconnect') reconnected on its own");

		dispatcher.simulate("connect");
		assert.notEqual(dispatcher.socket.socket, null);

		const reconnectedSocket = dispatcher.socket.socket;
		reconnectedSocket.simulateOpen();
		dispatcher.simulate("connect"); // already open — must be a no-op
		assert.equal(dispatcher.socket.socket, reconnectedSocket);
	});
});

// Lets the dispatcher's awaited URL provider settle. Only setTimeout is mocked in the fake-timer
// tests, so setImmediate still runs for real.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a URL provider is called once per open, and a reconnect opens the SECOND url it returned", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(async () => {
		let n = 0;
		const dispatcher = new WSDispatcher({ url: () => `wss://example.test/ws?ticket=${++n}` });
		dispatcher.open();
		await settle();
		const first = dispatcher.socket.socket;
		assert.equal(first.url, "wss://example.test/ws?ticket=1");
		assert.equal(dispatcher.url, "wss://example.test/ws?ticket=1");
		first.simulateOpen();

		// Reconnecting with the stored first URL is the bug: a spent ticket is refused forever.
		first.close();
		t.mock.timers.tick((TIMEOUT_STEP[0] + TIMEOUT_BASE_S) * 1000);
		await settle();
		assert.equal(n, 2, "provider was not called again for the reconnect");
		assert.equal(dispatcher.socket.socket.url, "wss://example.test/ws?ticket=2");
		assert.equal(dispatcher.url, "wss://example.test/ws?ticket=2");
	});
});

test("a rejecting URL provider schedules a reopen through the backoff ladder", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(async () => {
		let calls = 0;
		const dispatcher = new WSDispatcher({
			url: async () => {
				calls++;
				if (calls === 1) throw new Error("ticket request failed");
				return "wss://example.test/ok";
			},
		});
		dispatcher.open();
		await settle();
		assert.equal(dispatcher.socket.socket, null, "opened a socket despite the provider failing");

		const delayMs = (TIMEOUT_STEP[0] + TIMEOUT_BASE_S) * 1000;
		t.mock.timers.tick(delayMs - 1);
		await settle();
		assert.equal(calls, 1, "retried before the backoff delay");
		t.mock.timers.tick(1);
		await settle();
		assert.equal(calls, 2);
		assert.equal(dispatcher.socket.socket.url, "wss://example.test/ok");
	});
});

test("a provider that calls close() then throws produces no further attempts", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(async () => {
		let calls = 0;
		const dispatcher = new WSDispatcher({
			url: async () => {
				calls++;
				dispatcher.close();
				throw new Error("401");
			},
		});
		dispatcher.open();
		await settle();
		t.mock.timers.tick(10 * 60 * 1000);
		await settle();
		assert.equal(calls, 1);
		assert.equal(dispatcher.socket.socket, null);
	});
});

test("close() while the URL provider is pending opens no socket", async () => {
	await withFakeWebSocketAsync(async () => {
		const { promise, resolve } = Promise.withResolvers();
		const dispatcher = new WSDispatcher({ url: () => promise });
		dispatcher.open();
		dispatcher.close();
		resolve("wss://example.test/late");
		await settle();
		assert.equal(dispatcher.socket.socket, null, "opened a socket after the app asked to stop");
	});
});

test("a string url behaves as before: the same url on every reconnect, opened synchronously", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const dispatcher = new WSDispatcher({ url: "wss://example.test/fixed" });
		dispatcher.open();
		const first = dispatcher.socket.socket;
		assert.notEqual(first, null, "a string url must open synchronously");
		assert.equal(dispatcher.url, "wss://example.test/fixed");
		first.simulateOpen();
		first.close();
		t.mock.timers.tick((TIMEOUT_STEP[0] + TIMEOUT_BASE_S) * 1000);
		assert.equal(dispatcher.socket.socket.url, "wss://example.test/fixed");
	});
});

test("reconnectBase sets the first reopen delay; the default is still 15s", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await withFakeWebSocketAsync(() => {
		const fast = new WSDispatcher({ url: "wss://example.test", reconnectBase: 2 });
		fast.open();
		fast.socket.socket.simulateOpen();
		fast.socket.socket.close();
		t.mock.timers.tick(1_999);
		assert.equal(fast.socket.socket, null, "reopened before 2s");
		t.mock.timers.tick(1);
		assert.notEqual(fast.socket.socket, null, "did not reopen at 2s");
		fast.close();

		const dflt = new WSDispatcher({ url: "wss://example.test" });
		dflt.open();
		dflt.socket.socket.simulateOpen();
		dflt.socket.socket.close();
		t.mock.timers.tick(14_999);
		assert.equal(dflt.socket.socket, null, "default reopened before 15s");
		t.mock.timers.tick(1);
		assert.notEqual(dflt.socket.socket, null, "default did not reopen at 15s");
	});
});
