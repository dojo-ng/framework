/**
 * WSocket against a fake socket (no network). Covers every SendState transition, the
 * readyState-mismatch out-of-sync path, and the two call sites where a stale/still-open socket
 * must have its listeners nulled before `close()` — the reconnect-storm bug (websocket-spec.md
 * T3). Pure — no DOM, no timers.
 *
 * Run: node --test test/wsocket.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { WSocket, ReadyState, SendState } from "../dist/wsocket.js";
import { FakeWebSocket, withFakeWebSocket } from "./helpers/fake-websocket.mjs";

function openedSocket() {
	const ws = new WSocket("wss://example.test");
	ws.open();
	const fake = ws.socket;
	fake.simulateOpen();
	return { ws, fake };
}

test("send() is NOT_READY when never opened", () => {
	withFakeWebSocket(() => {
		const ws = new WSocket("wss://example.test");
		assert.equal(ws.send("m"), SendState.NOT_READY);
	});
});

test("send() is NOT_READY after an explicit close", () => {
	withFakeWebSocket(() => {
		const { ws } = openedSocket();
		ws.close();
		assert.equal(ws.send("m"), SendState.NOT_READY);
	});
});

test("send() is BUFFERING when bufferedAmount > 0", () => {
	withFakeWebSocket(() => {
		const { ws, fake } = openedSocket();
		fake.bufferedAmount = 1024;
		assert.equal(ws.send("m"), SendState.BUFFERING);
		assert.deepEqual(fake.sent, []); // never actually sent
	});
});

test("send() is SEND_ERROR when the underlying send throws, and it closes", () => {
	withFakeWebSocket(() => {
		const { ws, fake } = openedSocket();
		fake.sendThrows = true;
		assert.equal(ws.send("m"), SendState.SEND_ERROR);
		assert.equal(ws.state, ReadyState.CLOSED);
	});
});

test("send() is OKAY otherwise, and the message reaches the socket", () => {
	withFakeWebSocket(() => {
		const { ws, fake } = openedSocket();
		assert.equal(ws.send("hello"), SendState.OKAY);
		assert.deepEqual(fake.sent, ["hello"]);
	});
});

test("send() detects a readyState out of sync with tracked state, closes, and returns NOT_READY", () => {
	withFakeWebSocket(() => {
		const { ws, fake } = openedSocket();
		// The fake's readyState moved to CLOSED without going through the wrapper's close() and
		// without firing onclose — e.g. the underlying socket dropped before its event fired. isOpen()
		// still says OPEN (it only reflects state WE'VE observed), so this has to be caught live.
		fake.readyState = FakeWebSocket.CLOSED;

		let closeEvents = 0;
		ws.addEventListener("close", () => { closeEvents++; });

		assert.equal(ws.send("m"), SendState.NOT_READY);
		assert.equal(closeEvents, 1);
		assert.equal(ws.state, ReadyState.CLOSED);
		assert.equal(ws.socket, null);
	});
});

test("open(force) tears down the stale socket's listeners before closing it — no spurious close event", () => {
	withFakeWebSocket(() => {
		const { ws, fake: first } = openedSocket();

		let closeEvents = 0;
		ws.addEventListener("close", () => { closeEvents++; });

		ws.open(true); // force a fresh connection while `first` is still open
		const second = ws.socket;

		assert.notEqual(second, first);
		// If open(force) forgot to null `first.onclose` before calling `first.close()`, that stale
		// callback would still be wired and would fire — re-entering #handleClose for a socket the
		// wrapper has already moved on from. The correct behavior emits nothing for it.
		assert.equal(closeEvents, 0);
		assert.equal(ws.socket, second); // untouched by the old socket's teardown
	});
});

test("#handleClose tears down listeners before closing a still-open socket — no reconnect-storm re-entry", () => {
	withFakeWebSocket(() => {
		const { ws, fake } = openedSocket();

		let closeEvents = 0;
		ws.addEventListener("close", () => { closeEvents++; });

		// A post-open error while the socket is still nominally OPEN (readyState < CLOSING) makes
		// #handleClose actively close the socket itself — the "self-initiated close" case. If it
		// didn't null onclose first, this fake's close() firing its own (still-wired) onclose would
		// re-enter #handleClose a second time, inflating the close-event count.
		fake.onerror({ type: "error" });

		assert.equal(closeEvents, 1);
		assert.equal(ws.state, ReadyState.CLOSED);
		assert.equal(ws.socket, null);
	});
});

test("open → message → close: the happy path relays events with the right detail", () => {
	withFakeWebSocket(() => {
		const ws = new WSocket("wss://example.test");
		const events = [];
		ws.addEventListener("open", () => events.push("open"));
		ws.addEventListener("message", (e) => events.push(["message", e.detail.data]));
		ws.addEventListener("close", () => events.push("close"));

		ws.open();
		const fake = ws.socket;
		fake.simulateOpen();
		fake.onmessage({ data: "payload" });
		ws.close();

		assert.deepEqual(events, ["open", ["message", "payload"], "close"]);
	});
});

test("a pre-open error goes straight to close, with no error event", () => {
	withFakeWebSocket(() => {
		const ws = new WSocket("wss://example.test");
		const events = [];
		ws.addEventListener("error", () => events.push("error"));
		ws.addEventListener("close", () => events.push("close"));

		ws.open();
		const fake = ws.socket;
		fake.onerror({ type: "error" }); // before simulateOpen()

		assert.deepEqual(events, ["close"]); // no "error" — asymmetric with the post-open case
	});
});
