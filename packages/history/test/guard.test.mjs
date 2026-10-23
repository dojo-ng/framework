/**
 * Guards (H12): `block` asks before a go or a Back/Forward. A refused Back is put back with a
 * traversal (history.go), never a write. The fake window traverses synchronously, so the undo's
 * popstate arrives inside the first one's handler; the real-browser test covers the real timing.
 *
 * Run: node --test test/guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fixtures/env.mjs";

const guardEnv = (t, options = {}) => makeEnv(t, { dwellMs: 0, ...options });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const noWarn = (t) => t.mock.method(console, "warn", () => {});

/** A stack of landing, /a, /b with Forward behind. */
function stacked(t) {
	const env = guardEnv(t);
	env.h.go("/a");
	env.h.go("/b");
	return env;
}

test("a refused go writes nothing and publishes nothing", async (t) => {
	const { win, h, locations } = guardEnv(t);
	h.block(() => false);
	const calls = win.calls.length;
	const published = locations.length;
	h.go("/x");
	await tick();
	assert.equal(win.calls.length, calls);
	assert.equal(locations.length, published);
	assert.equal(win.location.pathname, "/");
});

test("an allowed async go writes and publishes after the answer", async (t) => {
	const { win, h, locations } = guardEnv(t);
	h.block(async () => true);
	h.go("/x");
	assert.equal(win.location.pathname, "/", "not yet");
	await tick();
	assert.equal(win.location.pathname, "/x");
	assert.equal(locations.at(-1).path, "/x");
});

test("the blocker is given the target and the current location", async (t) => {
	const { h } = guardEnv(t);
	const seen = [];
	h.block((to, from) => (seen.push([to, from.path]), true));
	h.go("/x", { n: 1 });
	await tick();
	assert.deepEqual(seen[0][0].path, "/x");
	assert.deepEqual(seen[0][0].state, { n: 1 });
	assert.equal(seen[0][1], "/");
});

test("every blocker must allow; one refusal is enough", async (t) => {
	const { win, h } = guardEnv(t);
	h.block(() => true);
	h.block(() => false);
	h.go("/x");
	await tick();
	assert.equal(win.location.pathname, "/");
});

test("only an answer of exactly true allows, and a blocker that throws refuses", async (t) => {
	const error = t.mock.method(console, "error", () => {});
	const { win, h } = guardEnv(t);
	const off = h.block(() => undefined);
	h.go("/x");
	await tick();
	assert.equal(win.location.pathname, "/");
	off();
	h.block(() => {
		throw new Error("boom");
	});
	h.go("/y");
	await tick();
	assert.equal(win.location.pathname, "/");
	assert.equal(error.mock.callCount(), 1);
});

test("while a check is pending a newer go replaces it: last one wins", async (t) => {
	const { win, h, locations } = guardEnv(t);
	const answers = [];
	h.block(() => new Promise((resolve) => answers.push(resolve)));
	h.go("/first");
	h.go("/second");
	answers[0](true);
	answers[1](true);
	await tick();
	assert.deepEqual(locations.slice(1).map((l) => l.path), ["/second"]);
	assert.equal(win.location.pathname, "/second");
});

test("unblock stops the blocker", async (t) => {
	const { win, h } = guardEnv(t);
	const unblock = h.block(() => false);
	unblock();
	unblock(); // idempotent
	h.go("/x");
	assert.equal(win.location.pathname, "/x", "no blocker: synchronous, as without guards");
});

test("a refused Back leaves the location, the stack and the publishes exactly as they were", async (t) => {
	const warn = noWarn(t);
	const { win, h, locations } = stacked(t);
	h.block(() => false);
	const calls = win.calls.length;
	const published = locations.length;
	h.back();
	await tick();
	assert.equal(win.location.pathname, "/b");
	assert.equal(h.current.path, "/b");
	assert.equal(locations.length, published);
	assert.equal(win.history.length, 3);
	assert.equal(win.calls.length, calls, "no pushState or replaceState anywhere in the undo");
	assert.equal(h.canGoBack, true);
	assert.equal(warn.mock.callCount(), 0, "the undo is not a foreign location");
});

test("an allowed Back reaches the target and publishes once, as a pop", async (t) => {
	const warn = noWarn(t);
	const { win, h, locations } = stacked(t);
	const seen = [];
	h.block((to, from) => (seen.push([to, from.path]), true));
	const calls = win.calls.length;
	const published = locations.length;
	h.back();
	await tick();
	assert.deepEqual(seen, [[{ path: "/a", source: "pop" }, "/b"]]);
	assert.equal(win.location.pathname, "/a");
	assert.deepEqual(locations.slice(published).map((l) => [l.path, l.source, l.index]), [["/a", "pop", 1]]);
	assert.equal(win.calls.length, calls);
	assert.deepEqual(win.traversals, [1, -1], "undo, then redo");
	assert.equal(warn.mock.callCount(), 0);
});

test("a two-step jump (the user picks an older entry) is undone and replayed by the same distance", async (t) => {
	const { win, h, locations } = stacked(t);
	h.block(() => true);
	const published = locations.length;
	win._traverse(-2);
	await tick();
	assert.deepEqual(win.traversals, [2, -2]);
	assert.deepEqual(locations.slice(published).map((l) => [l.path, l.source, l.index]), [["/", "pop", 0]]);
});

test("a refused Forward is undone the same way", async (t) => {
	const { win, h, locations } = stacked(t);
	h.back();
	const published = locations.length;
	h.block(() => false);
	h.forward();
	await tick();
	assert.equal(win.location.pathname, "/a");
	assert.equal(locations.length, published);
});

test("a Back onto a foreign entry is not guarded: published as today, with the one warning", async (t) => {
	const warn = noWarn(t);
	const { win, h, locations } = guardEnv(t);
	h.go("/a");
	win.history.pushState(null, "", "/f"); // someone else's entry
	h.back(); // onto /a, which is stamped and already current: not guarded
	let asked = 0;
	h.block(() => (asked++, false));
	h.forward(); // onto /f, no stamp of ours
	await tick();
	assert.equal(asked, 0);
	assert.equal(locations.at(-1).path, "/f");
	assert.equal(warn.mock.calls.some((call) => /foreign-entry/.test(call.arguments[0])), true);
});

test("beforeunload is prevented while any blocker is active, and removed with the last one", (t) => {
	const { win, h } = guardEnv(t);
	assert.equal(win.listenerCount("beforeunload"), 0);
	const one = h.block(() => true);
	const two = h.block(() => true);
	assert.equal(win.listenerCount("beforeunload"), 1);
	const event = new Event("beforeunload", { cancelable: true });
	win.dispatchEvent(event);
	assert.equal(event.defaultPrevented, true);
	one();
	assert.equal(win.listenerCount("beforeunload"), 1);
	two();
	assert.equal(win.listenerCount("beforeunload"), 0);
});

test("destroy removes beforeunload and forgets the blockers", (t) => {
	const { win, h } = guardEnv(t);
	h.block(() => true);
	h.destroy();
	assert.equal(win.listenerCount("beforeunload"), 0);
});

test("app3 regression with a blocker active: Back, Forward, a refusal and an allow never write", async (t) => {
	const { win, h, locations } = stacked(t);
	let allow = true;
	h.block(() => allow);
	const calls = win.calls.length;

	h.back();
	await tick();
	assert.equal(locations.at(-1).path, "/a");
	h.forward();
	await tick();
	assert.equal(locations.at(-1).path, "/b");
	allow = false;
	h.back();
	await tick();
	assert.equal(locations.at(-1).path, "/b");

	assert.equal(win.calls.length, calls, "no pushState or replaceState call in any guard path");
	assert.equal(win.history.length, 3);
});
