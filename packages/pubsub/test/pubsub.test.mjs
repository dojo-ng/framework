/**
 * Pub/sub: subscribe, publish, replay-to-late-subscriber, and getLast. Pure — no DOM. Ported
 * from components/tests/unit/pubsub.test.js (Vitest) to node --test; every case preserved.
 * Namespaced-delivery cases follow.
 *
 * Run: node --test test/pubsub.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

test("a:b:c reaches subscribers of a:b:c, a:b, and a, most-specific first, and not a:x or ab", () => {
	const ps = createPubSub();
	const events = [];
	ps.subscribe("a:b:c", (v, t) => events.push(["a:b:c", v, t]), { replay: false });
	ps.subscribe("a:b", (v, t) => events.push(["a:b", v, t]), { replay: false });
	ps.subscribe("a", (v, t) => events.push(["a", v, t]), { replay: false });
	ps.subscribe("a:x", (v, t) => events.push(["a:x", v, t]), { replay: false });
	ps.subscribe("ab", (v, t) => events.push(["ab", v, t]), { replay: false });

	ps.publish("a:b:c", "V");

	assert.deepEqual(events, [
		["a:b:c", "V", "a:b:c"],
		["a:b", "V", "a:b:c"],
		["a", "V", "a:b:c"],
	]);
});

test("a namespace subscriber gets exactly one replay: the most recent descendant by global seq", () => {
	const ps = createPubSub();
	ps.publish("a:b", "first");
	ps.publish("a:x", "second"); // published later, so it wins the replay even though "a:x" sorts after "a:b"

	const seen = [];
	ps.subscribe("a", (v, t) => seen.push([v, t]));

	assert.deepEqual(seen, [["second", "a:x"]]);
});

test("getLast on a namespace follows the same most-recent-descendant rule", () => {
	const ps = createPubSub();
	ps.publish("a:b", "first");
	ps.publish("a:x", "second");
	assert.equal(ps.getLast("a"), "second");
});

test("a leading-separator topic produces no ancestors", () => {
	const ps = createPubSub();
	const rootSeen = [];
	const leafSeen = [];
	ps.subscribe("", (v, t) => rootSeen.push([v, t]), { replay: false });
	ps.subscribe(":a", (v, t) => leafSeen.push([v, t]), { replay: false });

	ps.publish(":a", "x");

	assert.deepEqual(rootSeen, []); // no ancestor notification from a leading separator
	assert.deepEqual(leafSeen, [["x", ":a"]]);
});

test("a throwing subscriber does not stop delivery to the next handler, and the error surfaces", () => {
	// Run as a child process: node:test's own runner hooks process-level uncaughtException and
	// would attribute the deliberate throw to this test as a failure even with our own listener
	// installed, so the two facts (second handler ran; error surfaced) have to be observed outside
	// the test runner's process. See fixtures/throw-isolation.mjs.
	const fixture = fileURLToPath(new URL("fixtures/throw-isolation.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [fixture], { encoding: "utf8" });
	assert.equal(result.status, 0);
	assert.match(result.stdout, /SECOND_RAN/); // the second handler ran despite the first throwing
	assert.match(result.stdout, /UNCAUGHT:boom/); // and the error actually surfaced, not just got swallowed
});
