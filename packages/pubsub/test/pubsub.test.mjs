/**
 * Pub/sub: subscribe, publish, replay-to-late-subscriber, and getLast. Pure — no DOM. Ported
 * from components/tests/unit/pubsub.test.js (Vitest) to node --test; every case preserved
 * (framework-monorepo-spec.md C3).
 *
 * Run: node --test test/pubsub.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPubSub } from "../dist/index.js";

test("subscribe receives subsequent publishes", () => {
	const ps = createPubSub();
	const seen = [];
	ps.subscribe("topic", (v) => seen.push(v));
	ps.publish("topic", 1);
	ps.publish("topic", 2);
	assert.deepEqual(seen, [1, 2]);
});

test("late subscriber replays the last value by default", () => {
	const ps = createPubSub();
	ps.publish("t", "last");
	const seen = [];
	ps.subscribe("t", (v) => seen.push(v));
	assert.deepEqual(seen, ["last"]); // should replay the retained value immediately
});

test("replay can be disabled", () => {
	const ps = createPubSub();
	ps.publish("t", "x");
	const seen = [];
	ps.subscribe("t", (v) => seen.push(v), { replay: false });
	assert.deepEqual(seen, []); // no replay when replay:false
	ps.publish("t", "y");
	assert.deepEqual(seen, ["y"]);
});

test("every publish notifies, even with an unchanged payload", () => {
	const ps = createPubSub();
	let count = 0;
	ps.subscribe("t", () => count++);
	ps.publish("t", "same");
	ps.publish("t", "same");
	assert.equal(count, 2);
});

test("getLast returns the last payload; unsubscribe stops delivery", () => {
	const ps = createPubSub();
	const seen = [];
	const off = ps.subscribe("t", (v) => seen.push(v));
	ps.publish("t", "a");
	assert.equal(ps.getLast("t"), "a");
	off();
	ps.publish("t", "b");
	assert.deepEqual(seen, ["a"]); // no delivery after unsubscribe
	assert.equal(ps.getLast("t"), "b"); // store still retains the latest
});
