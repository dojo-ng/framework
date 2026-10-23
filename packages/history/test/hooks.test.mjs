/**
 * Hooks (H3): onCommit fires once per entry that commits, never for a skimmed one; resolve rebuilds
 * the state of a stateless landing before the load publish.
 *
 * Run: node --test test/hooks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fixtures/env.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("onCommit fires for A and E only in the skim scenario", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const committed = [];
	const { h } = makeEnv(t, { onCommit: (entry) => committed.push(entry.path) });
	h.go("/a");
	t.mock.timers.tick(3000);
	h.go("/b");
	t.mock.timers.tick(1000);
	h.go("/c");
	t.mock.timers.tick(1000);
	h.go("/d");
	t.mock.timers.tick(1000);
	h.go("/e");
	t.mock.timers.tick(3000);
	assert.deepEqual(committed, ["/a", "/e"]);
});

test("onCommit carries path, state and trail, and fires once even if commit() is also called", (t) => {
	const seen = [];
	const trail = [{ path: "/a", label: "A" }];
	const { h } = makeEnv(t, { onCommit: (entry) => seen.push(entry) });
	h.go("/a", { k: 1 }, { trail });
	h.commit();
	h.commit();
	assert.deepEqual(seen, [{ path: "/a", state: { k: 1 }, trail }]);
});

test("onCommit fires for every entry with dwellMs: 0, and not for the landing entry", (t) => {
	const committed = [];
	const { h } = makeEnv(t, { dwellMs: 0, onCommit: (entry) => committed.push(entry.path) });
	h.go("/a");
	h.go("/b");
	assert.deepEqual(committed, ["/a", "/b"]);
});

test("onCommit does not fire again when Back returns to a committed entry", (t) => {
	const committed = [];
	const { h } = makeEnv(t, { dwellMs: 0, onCommit: (entry) => committed.push(entry.path) });
	h.go("/a");
	h.go("/b");
	h.back();
	h.forward();
	assert.deepEqual(committed, ["/a", "/b"]);
});

test("an onCommit that throws is logged and does not break navigation", (t) => {
	const error = t.mock.method(console, "error", () => {});
	const { h } = makeEnv(t, { dwellMs: 0, onCommit: () => { throw new Error("boom"); } });
	h.go("/a");
	h.go("/b");
	assert.equal(h.current.path, "/b");
	assert.equal(error.mock.callCount(), 2);
});

test("resolve is called on a stateless landing; its result becomes the entry's state before the load publish", async (t) => {
	const calls = [];
	const { win, locations } = makeEnv(t, {
		dwellMs: 0,
		window: { url: "http://example.test/orders/7" },
		resolve: async (path) => { calls.push(path); return { restored: path }; },
	});
	assert.deepEqual(locations, [], "nothing is published until resolve settles");
	await flush();
	assert.deepEqual(calls, ["/orders/7"]);
	assert.equal(locations.length, 1);
	assert.deepEqual([locations[0].path, locations[0].source, locations[0].state], ["/orders/7", "load", { restored: "/orders/7" }]);
	assert.deepEqual(win.history.state.state, { restored: "/orders/7" });
	assert.equal(win.history.state.__djnav.index, 0);
});

test("resolve is not called when the landing entry already has our state (a same-tab reload)", async (t) => {
	let called = 0;
	const state = { __djnav: { id: "x", index: 2 }, state: { kept: true } };
	const { locations } = makeEnv(t, {
		dwellMs: 0,
		window: { url: "http://example.test/orders/7", state },
		resolve: async () => { called++; return {}; },
	});
	await flush();
	assert.equal(called, 0);
	assert.equal(locations.length, 1);
	assert.deepEqual(locations[0].state, { kept: true });
});

test("a rejecting resolve still produces exactly one load publish, with the bare path", async (t) => {
	const error = t.mock.method(console, "error", () => {});
	const { locations } = makeEnv(t, {
		dwellMs: 0,
		window: { url: "http://example.test/orders/7" },
		resolve: async () => { throw new Error("server down"); },
	});
	await flush();
	assert.equal(locations.length, 1);
	assert.deepEqual([locations[0].path, locations[0].source, locations[0].state], ["/orders/7", "load", undefined]);
	assert.equal(error.mock.callCount(), 1);
});

test("a resolve that throws synchronously is treated as a rejection", async (t) => {
	t.mock.method(console, "error", () => {});
	const { locations } = makeEnv(t, {
		dwellMs: 0,
		resolve: () => { throw new Error("sync"); },
	});
	await flush();
	assert.equal(locations.length, 1);
});

test("if the app navigates before resolve settles, the late result is dropped and load is not published", async (t) => {
	let release;
	const { locations, h } = makeEnv(t, {
		dwellMs: 0,
		resolve: () => new Promise((resolve) => { release = resolve; }),
	});
	h.go("/a");
	release({ late: true });
	await flush();
	assert.deepEqual(locations.map((l) => [l.path, l.source]), [["/a", "go"]]);
});
