// Fixture run as a plain child process (not under node:test) so its uncaughtException can be
// observed directly. node:test's own runner hooks process-level uncaughtException and attributes
// any exception firing during a test to that test as a failure — which fires even when the test
// installs its own listener, so the isolation behavior this fixture proves cannot be asserted
// in-process under the test runner. See pubsub.test.mjs's "a throwing subscriber..." case.
import { createPubSub } from "../../dist/index.js";

process.on("uncaughtException", (err) => {
	console.log(`UNCAUGHT:${err.message}`);
});

const ps = createPubSub();
ps.subscribe("t", () => { throw new Error("boom"); }, { replay: false });
ps.subscribe("t", () => { console.log("SECOND_RAN"); }, { replay: false });
ps.publish("t", "x");

setTimeout(() => {}, 20);
