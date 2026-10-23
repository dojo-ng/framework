/**
 * Scroll restoration (H10) and focus on navigation (H11) against the fake window. Positions are in
 * sessionStorage by entry id; the wait is two animation frames, or the app's `ready`.
 *
 * Run: node --test test/scroll.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory } from "../dist/index.js";
import { FakeWindow } from "./fixtures/fake-window.mjs";
import { makeEnv } from "./fixtures/env.mjs";

const scrollEnv = (t, options = {}) => makeEnv(t, { dwellMs: 0, scroll: true, ...options });
const storeOf = (win) => JSON.parse(win.sessionStorage.getItem("dojo-ng.history.scroll") ?? '{"order":[],"pos":{}}');
const noWarn = (t) => t.mock.method(console, "warn", () => {});

test("with scroll on, scrollRestoration is manual until destroy puts it back", (t) => {
	const { win, h } = scrollEnv(t);
	assert.equal(win.history.scrollRestoration, "manual");
	h.destroy();
	assert.equal(win.history.scrollRestoration, "auto");
});

test("with scroll off, scrollRestoration is left alone and nothing is stored", async (t) => {
	const { win, h } = makeEnv(t, { dwellMs: 0 });
	win.scrollY = 300;
	h.go("/a");
	await win.settle();
	assert.equal(win.history.scrollRestoration, "auto");
	assert.equal(win.sessionStorage.getItem("dojo-ng.history.scroll"), null);
	assert.deepEqual(win.scrolls, []);
});

test("a go saves the page left, then scrolls to the top after two frames", async (t) => {
	const { win, h } = scrollEnv(t);
	const landing = win.history.state.__djnav.id;
	win.scrollY = 300;
	h.go("/a");
	assert.deepEqual(win.scrolls, [], "nothing scrolls before the view has had its frames");
	await win.settle();
	assert.deepEqual(storeOf(win).pos[landing], { x: 0, y: 300 });
	assert.deepEqual(win.scrolls, [[0, 0]]);
});

test("Back restores the saved offset; Forward restores the one saved when leaving", async (t) => {
	const { win, h } = scrollEnv(t);
	win.scrollY = 300;
	h.go("/a");
	await win.settle();
	win.scrollY = 500;
	h.back();
	await win.settle();
	assert.equal(win.scrollY, 300, "Back returns to where the landing page was left");
	h.forward();
	await win.settle();
	assert.equal(win.scrollY, 500, "Forward returns to where /a was left, saved at the top of onPop");
});

test("pagehide saves the position, and a reload restores it", async (t) => {
	const first = scrollEnv(t);
	first.h.go("/a");
	await first.win.settle();
	first.win.scrollY = 720;
	first.win.dispatchEvent(new Event("pagehide"));

	first.h.destroy(); // the reload is a new page: one install per page
	const reloaded = new FakeWindow({ url: "http://example.test/a", state: first.win.history.state });
	reloaded.sessionStorage = first.win.sessionStorage;
	const h = installHistory(createPubSub(), { dwellMs: 0, scroll: true, window: reloaded });
	t.after(() => h.destroy());
	assert.deepEqual(reloaded.scrolls, []);
	await reloaded.settle();
	assert.deepEqual(reloaded.scrolls, [[0, 720]]);
});

test("a fresh landing is not scrolled", async (t) => {
	const { win } = scrollEnv(t);
	await win.settle();
	assert.deepEqual(win.scrolls, []);
});

test("a go to a path with #fragment scrolls that element into view instead of the top", async (t) => {
	const { win, h } = scrollEnv(t);
	const section = win.document.element({ id: "sec 1" });
	h.go("/a#sec%201");
	await win.settle();
	assert.equal(section.scrolledIntoView, 1);
	assert.deepEqual(win.scrolls, []);
});

test("a #fragment with no matching element falls back to the top", async (t) => {
	const { win, h } = scrollEnv(t);
	h.go("/a#missing");
	await win.settle();
	assert.deepEqual(win.scrolls, [[0, 0]]);
});

test("ready is awaited before restoring, and gets the location", async (t) => {
	let release;
	const seen = [];
	const { win, h } = scrollEnv(t, {
		scroll: {
			ready: (location) => {
				seen.push(location.path);
				return new Promise((resolve) => (release = resolve));
			},
		},
	});
	win.scrollY = 300;
	h.go("/a");
	await win.settle(4);
	assert.deepEqual(win.scrolls, [], "still waiting for the view");
	release();
	await win.settle();
	assert.deepEqual(seen, ["/a"]);
	assert.deepEqual(win.scrolls, [[0, 0]]);
});

test("a ready that rejects is logged and the scroll still happens", async (t) => {
	const error = t.mock.method(console, "error", () => {});
	const { win, h } = scrollEnv(t, { scroll: { ready: () => Promise.reject(new Error("boom")) } });
	h.go("/a");
	await win.settle();
	assert.equal(error.mock.callCount(), 1);
	assert.deepEqual(win.scrolls, [[0, 0]]);
});

test("a newer navigation cancels the wait of an older one", async (t) => {
	const { win, h } = scrollEnv(t);
	h.go("/a");
	h.go("/b#nope");
	await win.settle();
	assert.deepEqual(win.scrolls, [[0, 0]], "one scroll for the two gos");
});

test("a provisional entry that is replaced loses its stored position (the dwell drop)", async (t) => {
	const { win, h } = scrollEnv(t, { dwellMs: 3000 });
	h.go("/a");
	const skimmed = win.history.state.__djnav.id;
	win.scrollY = 100;
	h.go("/b");
	await win.settle();
	assert.equal(skimmed in storeOf(win).pos, false);
});

test("the store keeps the newest 50 entries", (t) => {
	const { win, h } = scrollEnv(t);
	const first = win.history.state.__djnav.id;
	for (let i = 0; i < 60; i++) {
		win.scrollY = i + 1;
		h.go(`/p${i}`);
	}
	const store = storeOf(win);
	assert.equal(store.order.length, 50);
	assert.equal(first in store.pos, false, "the oldest was dropped");
	assert.equal(Object.keys(store.pos).length, 50);
});

test("blocked storage: nothing throws and nothing is restored", async (t) => {
	const { win, h } = scrollEnv(t, { window: { storage: false } });
	win.scrollY = 300;
	h.go("/a");
	await win.settle();
	win.scrolls.length = 0;
	h.back();
	await win.settle();
	assert.deepEqual(win.scrolls, []);
});

test("targets are saved and restored by element id; one without an id is skipped with one warning", async (t) => {
	const warn = noWarn(t);
	const { win, h } = scrollEnv(t, { scroll: { targets: () => [panel, anonymous] } });
	const panel = win.document.element({ id: "panel", scrollTop: 40, scrollLeft: 5 });
	const anonymous = win.document.element({ scrollTop: 9 });
	h.go("/a");
	await win.settle();
	panel.scrollTop = 0;
	panel.scrollLeft = 0;
	h.back();
	await win.settle();
	assert.deepEqual([panel.scrollLeft, panel.scrollTop], [5, 40]);
	assert.equal(anonymous.scrollTop, 9);
	h.forward();
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /scroll-target-id/);
});

test("destroy removes the pagehide listener", (t) => {
	const { win, h } = scrollEnv(t);
	assert.equal(win.listenerCount("pagehide"), 1);
	h.destroy();
	assert.equal(win.listenerCount("pagehide"), 0);
});

// --- H11: focus ---------------------------------------------------------------------------------

const focusEnv = (t, options = {}) => makeEnv(t, { dwellMs: 0, focus: "h1", ...options });

test("after a go and two frames, focus moves to the match; a non-focusable one gets tabindex=-1 until it blurs", async (t) => {
	const { win, h } = focusEnv(t);
	const heading = win.document.element({ tagName: "h1" });
	h.go("/a");
	assert.equal(heading.focusCalls.length, 0, "not before the view has had its frames");
	await win.settle();
	assert.equal(heading.focusCalls.length, 1);
	assert.equal(win.document.activeElement, heading);
	assert.equal(heading.getAttribute("tabindex"), "-1");
	heading.blur();
	assert.equal(heading.hasAttribute("tabindex"), false);
});

test("an element that is already focusable gets no tabindex", async (t) => {
	const { win, h } = focusEnv(t);
	const heading = win.document.element({ tagName: "h1", focusable: true });
	h.go("/a");
	await win.settle();
	assert.equal(heading.focusCalls.length, 1);
	assert.equal(heading.hasAttribute("tabindex"), false);
});

test("focus does not move on a pop or on load", async (t) => {
	const { win, h } = focusEnv(t);
	const heading = win.document.element({ tagName: "h1" });
	await win.settle();
	assert.equal(heading.focusCalls.length, 0, "load");
	h.go("/a");
	await win.settle();
	h.back();
	await win.settle();
	h.forward();
	await win.settle();
	assert.equal(heading.focusCalls.length, 1, "only the go moved it");
});

test("focus already inside the match is left alone", async (t) => {
	const { win, h } = focusEnv(t, { focus: "main" });
	const main = win.document.element({ tagName: "main" });
	const tree = win.document.element({ tagName: "div", focusable: true });
	main.appendChild(tree);
	win.document.activeElement = tree;
	h.go("/a");
	await win.settle();
	assert.equal(main.focusCalls.length, 0);
	assert.equal(win.document.activeElement, tree);
});

test("no match moves nothing", async (t) => {
	const none = focusEnv(t);
	none.h.go("/a");
	await none.win.settle();
	assert.equal(none.win.document.activeElement, null);
});

test("focus off by default moves nothing", async (t) => {
	const off = makeEnv(t, { dwellMs: 0 });
	const heading = off.win.document.element({ tagName: "h1" });
	off.h.go("/a");
	await off.win.settle();
	assert.equal(heading.focusCalls.length, 0);
});

test("with scroll on, focus waits for ready and does not scroll the page itself", async (t) => {
	let release;
	const { win, h } = focusEnv(t, { scroll: { ready: () => new Promise((resolve) => (release = resolve)) } });
	const heading = win.document.element({ tagName: "h1" });
	h.go("/a");
	await win.settle(4);
	assert.equal(heading.focusCalls.length, 0);
	release();
	await win.settle();
	assert.deepEqual(heading.focusCalls, [{ preventScroll: true }]);
});
