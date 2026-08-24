/**
 * The async-iterable subscription surface (websocket-spec.md T6). Core logic tested against a
 * counting fake `subscribe` (so "the underlying subscription was removed" can be asserted as an
 * actual count, not inferred from "the loop stopped" — a loop can end while leaking the
 * subscription, which is the bug this guards, per the spec's own honest-verification note), plus
 * one integration test against the real `createPubSub()`. Pure — no DOM.
 *
 * Run: node --test test/subscribe-async.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeAsync } from "../dist/subscribe-async.js";
import { createPubSub } from "../dist/index.js";

/** A minimal `subscribe`-shaped test double that can actually deliver values and counts active subscriptions. */
function makeFakeSubscribe() {
	const handlersByTopic = new Map();
	let active = 0;

	function subscribe(topic, handler) {
		let set = handlersByTopic.get(topic);
		if (!set) handlersByTopic.set(topic, (set = new Set()));
		set.add(handler);
		active++;
		return () => {
			if (set.delete(handler)) active--;
		};
	}

	subscribe.emit = (topic, value) => {
		const set = handlersByTopic.get(topic);
		if (set) for (const handler of [...set]) handler(value, topic);
	};
	subscribe.activeCount = () => active;

	return subscribe;
}

test("for await over a subscription receives published events in order", async () => {
	const fake = makeFakeSubscribe();
	const iterable = subscribeAsync(fake, "t");
	const received = [];

	const consumer = (async () => {
		for await (const v of iterable) {
			received.push(v);
			if (received.length === 3) break;
		}
	})();

	fake.emit("t", "a");
	fake.emit("t", "b");
	fake.emit("t", "c");
	await consumer;

	assert.deepEqual(received, ["a", "b", "c"]);
});

test("aborting the signal terminates the loop and removes the underlying subscription", async () => {
	const fake = makeFakeSubscribe();
	const controller = new AbortController();
	const iterable = subscribeAsync(fake, "t", { signal: controller.signal });
	assert.equal(fake.activeCount(), 1); // subscribed eagerly, at call time

	const received = [];
	const consumer = (async () => {
		for await (const v of iterable) {
			received.push(v);
		}
	})();

	fake.emit("t", "x");
	controller.abort();
	await consumer;

	assert.deepEqual(received, ["x"]);
	assert.equal(fake.activeCount(), 0); // the actual subscription is gone, not just the loop
});

test("break inside for await also tears down the subscription (AsyncIterator.return())", async () => {
	const fake = makeFakeSubscribe();
	const iterable = subscribeAsync(fake, "t");
	assert.equal(fake.activeCount(), 1);

	const consumer = (async () => {
		for await (const v of iterable) {
			if (v === "stop") break;
		}
	})();

	fake.emit("t", "stop");
	await consumer;

	assert.equal(fake.activeCount(), 0);
});

test("a slow consumer does not lose events up to the documented bound; older ones are dropped beyond it", async () => {
	const fake = makeFakeSubscribe();
	const iterable = subscribeAsync(fake, "t", { bufferSize: 3 });

	// A maximally slow consumer: every value published before anything has been read.
	for (let i = 0; i < 5; i++) fake.emit("t", i);

	const received = [];
	for await (const v of iterable) {
		received.push(v);
		if (received.length === 3) break;
	}

	assert.deepEqual(received, [2, 3, 4]); // 0 and 1 evicted, oldest-first
});

test("createPubSub().subscribeAsync is the real, wired-up thing, not just the core function", async () => {
	const ps = createPubSub();
	const iterable = ps.subscribeAsync("t", { bufferSize: 5 });

	ps.publish("t", 1);
	ps.publish("t", 2);

	const received = [];
	for await (const v of iterable) {
		received.push(v);
		if (received.length === 2) break;
	}

	assert.deepEqual(received, [1, 2]);
});
