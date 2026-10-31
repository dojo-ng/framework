/**
 * Scroll targets that register themselves (H14): `scrollTarget(key, el)` names a scroller that has
 * no usable id, such as one in a component's shadow root. Saved by key with the entry, restored by
 * key after the wait, so an element re-created under the same key gets the old offset.
 *
 * Run: node --test test/scroll-targets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fixtures/env.mjs";

const scrollEnv = (t, options = {}) => makeEnv(t, { dwellMs: 0, scroll: true, ...options });
const storeOf = (win) => JSON.parse(win.sessionStorage.getItem("dojo-ng.history.scroll") ?? '{"order":[],"pos":{}}');

test("a registered target is saved and restored by its key", async (t) => {
	const { win, h } = scrollEnv(t);
	const landing = win.history.state.__djnav.id;
	const start = win.document.element({ scrollTop: 120, scrollLeft: 4 });
	const end = win.document.element({ scrollTop: 60 });
	h.scrollTarget("split:start", start);
	h.scrollTarget("split:end", end);
	h.go("/a");
	await win.settle();
	assert.deepEqual(storeOf(win).pos[landing].t, { "split:start": [4, 120], "split:end": [0, 60] });

	start.scrollTop = 0;
	start.scrollLeft = 0;
	end.scrollTop = 0;
	h.back();
	await win.settle();
	assert.deepEqual([start.scrollLeft, start.scrollTop], [4, 120]);
	assert.equal(end.scrollTop, 60);
});

test("registered targets are saved after targets(), and an id from targets() keeps its own slot", async (t) => {
	const { win, h } = scrollEnv(t, { scroll: { targets: () => [panel] } });
	const panel = win.document.element({ id: "panel", scrollTop: 10 });
	const pane = win.document.element({ scrollTop: 20 });
	const landing = win.history.state.__djnav.id;
	h.scrollTarget("panel:start", pane);
	h.go("/a");
	await win.settle();
	const saved = storeOf(win).pos[landing].t;
	assert.deepEqual(Object.keys(saved), ["panel", "panel:start"]);
	assert.deepEqual(saved, { panel: [0, 10], "panel:start": [0, 20] });
});

test("an element re-created under the same key after Back gets the old offset", async (t) => {
	const { win, h } = scrollEnv(t);
	const first = win.document.element({ scrollTop: 250 });
	const unregisterFirst = h.scrollTarget("list", first);
	h.go("/a");
	// The view for /a replaces the old one: the first element goes away.
	first.isConnected = false;
	unregisterFirst();
	await win.settle();

	h.back();
	// Back re-renders the old view before the wait ends: a new element takes the key.
	const second = win.document.element({ scrollTop: 0 });
	h.scrollTarget("list", second);
	await win.settle();
	assert.equal(second.scrollTop, 250);
});

test("a stale unregister leaves the element that has since taken the key", async (t) => {
	const { win, h } = scrollEnv(t);
	const landing = win.history.state.__djnav.id;
	const old = win.document.element({ scrollTop: 1 });
	const fresh = win.document.element({ scrollTop: 77 });
	const unregisterOld = h.scrollTarget("list", old);
	h.scrollTarget("list", fresh);
	unregisterOld(); // the old element's cleanup runs after the new one registered
	h.go("/a");
	await win.settle();
	assert.deepEqual(storeOf(win).pos[landing].t, { list: [0, 77] });
});

test("unregister removes the target, and calling it twice is harmless", async (t) => {
	const { win, h } = scrollEnv(t);
	const landing = win.history.state.__djnav.id;
	const el = win.document.element({ scrollTop: 5 });
	const unregister = h.scrollTarget("list", el);
	unregister();
	unregister();
	h.go("/a");
	await win.settle();
	assert.equal(storeOf(win).pos[landing].t, undefined);
});

test("a disconnected element is skipped on save", async (t) => {
	const { win, h } = scrollEnv(t);
	const landing = win.history.state.__djnav.id;
	const gone = win.document.element({ scrollTop: 30 });
	const here = win.document.element({ scrollTop: 40 });
	h.scrollTarget("gone", gone);
	h.scrollTarget("here", here);
	gone.isConnected = false;
	h.go("/a");
	await win.settle();
	assert.deepEqual(storeOf(win).pos[landing].t, { here: [0, 40] });
});

test("with scroll off, registering is allowed and nothing is stored or restored", async (t) => {
	const { win, h } = makeEnv(t, { dwellMs: 0 });
	const el = win.document.element({ scrollTop: 90 });
	const unregister = h.scrollTarget("list", el);
	assert.equal(typeof unregister, "function");
	h.go("/a");
	await win.settle();
	el.scrollTop = 0;
	h.back();
	await win.settle();
	assert.equal(win.sessionStorage.getItem("dojo-ng.history.scroll"), null);
	assert.equal(el.scrollTop, 0);
	unregister();
});

test("after destroy, a registered target is not saved", async (t) => {
	const { win, h } = scrollEnv(t);
	const el = win.document.element({ scrollTop: 15 });
	h.scrollTarget("list", el);
	h.destroy();
	// A pagehide after destroy saves nothing, and no listener is left.
	win.dispatchEvent(new Event("pagehide"));
	assert.equal(win.sessionStorage.getItem("dojo-ng.history.scroll"), null);
});
