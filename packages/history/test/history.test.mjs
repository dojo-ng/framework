/**
 * installHistory against a fake window (H1, H5, H6): the landing stamp, go/replace/base, Back and
 * Forward, the one-writer invariant, canGoBack/canGoForward, subscribe, the handle subpath, the
 * coexistence warnings, and the dj-navigate listener. No DOM, no real timers; dwellMs is 0 here
 * unless a test is about dwell (see dwell.test.mjs).
 *
 * Run: node --test test/history.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory, getHistory, whenHistory } from "../dist/index.js";
import { FakeWindow, FakeNode } from "./fixtures/fake-window.mjs";
import { makeEnv } from "./fixtures/env.mjs";

const noWarn = (t) => t.mock.method(console, "warn", () => {});

// --- H1: landing, go, pop -----------------------------------------------------------------------

test("install stamps the landing entry with replaceState and publishes it as load", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0, window: { url: "http://example.test/deep/path" } });
	assert.equal(win.calls.length, 1);
	assert.equal(win.calls[0].type, "replace");
	assert.equal(win.history.state.__djnav.index, 0);
	assert.equal(typeof win.history.state.__djnav.id, "string");
	assert.equal(win.history.length, 1); // stamped in place, nothing pushed
	assert.deepEqual(locations.map((l) => [l.path, l.source, l.index, l.committed]), [["/deep/path", "load", 0, true]]);
	assert.equal(h.current.path, "/deep/path");
});

test("install on an entry that already has our state (a reload) keeps its id and index", (t) => {
	const state = { __djnav: { id: "abc", index: 3 }, state: { q: 1 }, trail: [{ path: "/", label: "Home" }] };
	const { win, locations } = makeEnv(t, { dwellMs: 0, window: { url: "http://example.test/x", state } });
	assert.equal(win.calls.length, 0); // nothing to stamp
	assert.deepEqual(locations[0].state, { q: 1 });
	assert.equal(locations[0].index, 3);
	assert.deepEqual(locations[0].trail, [{ path: "/", label: "Home" }]);
});

test("go pushes with base added and publishes without it", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0, base: "/acme", window: { url: "http://example.test/acme/" } });
	h.go("/orders/7", { from: "test" });
	assert.equal(win.location.pathname, "/acme/orders/7");
	assert.equal(win.history.length, 2);
	assert.deepEqual(win.callsOf("push").map((c) => c.url), ["/acme/orders/7"]);
	const last = locations[locations.length - 1];
	assert.deepEqual([last.path, last.source, last.index, last.state], ["/orders/7", "go", 1, { from: "test" }]);
	assert.equal(h.href("/orders/7"), "/acme/orders/7");
});

test("the landing path has base stripped, query and hash kept", (t) => {
	const { locations } = makeEnv(t, { dwellMs: 0, base: "/acme/", window: { url: "http://example.test/acme/deep?x=1#h" } });
	assert.equal(locations[0].path, "/deep?x=1#h");
});

test("the landing path at exactly the base is /", (t) => {
	const { locations } = makeEnv(t, { dwellMs: 0, base: "/acme", window: { url: "http://example.test/acme" } });
	assert.equal(locations[0].path, "/");
});

test("go with replace: true replaces the current entry", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	h.go("/b", undefined, { replace: true });
	assert.equal(win.history.length, 2);
	assert.deepEqual(win.paths, ["/", "/b"]);
	assert.equal(win.callsOf("push").length, 1);
	assert.deepEqual([locations.at(-1).path, locations.at(-1).index], ["/b", 1]);
});

test("Back publishes source pop with the earlier entry's path and state", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a", { n: 1 });
	h.go("/b");
	h.back();
	assert.deepEqual(
		[locations.at(-1).path, locations.at(-1).source, locations.at(-1).index, locations.at(-1).committed, locations.at(-1).state],
		["/a", "pop", 1, true, { n: 1 }],
	);
	assert.equal(win.location.pathname, "/a");
});

test("app3 regression: a pop never writes history, and Forward still reaches the entry after it", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	h.go("/b");
	assert.equal(win.history.length, 3);

	const callsBefore = win.calls.length;
	h.back();
	assert.equal(win.history.length, 3, "Back must not change history.length");
	assert.equal(win.calls.length, callsBefore, "no pushState or replaceState call during the pop");
	assert.equal(locations.at(-1).path, "/a");

	h.forward();
	assert.equal(win.history.length, 3);
	assert.equal(win.calls.length, callsBefore);
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source], ["/b", "pop"]);
});

test("a second install warns once and returns the first instance", (t) => {
	const warn = noWarn(t);
	const { h, win } = makeEnv(t, { dwellMs: 0 });
	const again = installHistory(createPubSub(), { window: new FakeWindow() });
	const thirdTime = installHistory(createPubSub(), { window: new FakeWindow() });
	assert.equal(again, h);
	assert.equal(thirdTime, h);
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /more than once/);
	assert.equal(win.calls.length, 1); // the second install touched nothing
});

test("canGoBack and canGoForward across push, back, push (the push truncates Forward)", (t) => {
	const { h } = makeEnv(t, { dwellMs: 0 });
	assert.deepEqual([h.canGoBack, h.canGoForward], [false, false]);
	h.go("/a");
	h.go("/b");
	assert.deepEqual([h.canGoBack, h.canGoForward], [true, false]);
	h.back();
	assert.deepEqual([h.canGoBack, h.canGoForward], [true, true]);
	h.back();
	assert.deepEqual([h.canGoBack, h.canGoForward], [false, true]);
	h.forward();
	h.go("/c");
	assert.deepEqual([h.canGoBack, h.canGoForward], [true, false]);
});

test("canGoForward is false when sessionStorage is blocked, and nothing throws", (t) => {
	const { h } = makeEnv(t, { dwellMs: 0, window: { storage: false } });
	h.go("/a");
	h.back();
	assert.equal(h.canGoForward, false);
	assert.equal(h.canGoBack, false);
});

test("canGoForward starts false on a fresh landing even if the tab's storage remembers an older stack", (t) => {
	const win = new FakeWindow();
	win.sessionStorage.setItem("dojo-ng.history.max", "9");
	const bus = createPubSub();
	const h = installHistory(bus, { window: win, dwellMs: 0 });
	t.after(() => h.destroy());
	assert.equal(h.canGoForward, false);
});

test("subscribe delivers the current location at once and each change after; unsubscribe stops it", (t) => {
	const { h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	const seen = [];
	const stop = h.subscribe((loc) => seen.push(loc.path));
	assert.deepEqual(seen, ["/a"]);
	h.go("/b");
	h.back();
	assert.deepEqual(seen, ["/a", "/b", "/a"]);
	stop();
	h.go("/c");
	assert.deepEqual(seen, ["/a", "/b", "/a"]);
});

test("a nav:go published straight on the bus does the same as go()", (t) => {
	const { bus, win, locations } = makeEnv(t, { dwellMs: 0 });
	bus.publish("nav:go", { path: "/viaBus", state: 1 });
	assert.equal(win.location.pathname, "/viaBus");
	assert.equal(locations.at(-1).path, "/viaBus");
	assert.equal(locations.length, 2, "published once, not re-delivered");
});

test("annotate merges trail and state into the current entry with replaceState and republishes", (t) => {
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	const lengthBefore = win.history.length;
	const trail = [{ path: "/", label: "Home" }, { path: "/a", label: "A" }];
	h.annotate({ trail });
	assert.equal(win.history.length, lengthBefore);
	assert.deepEqual(win.history.state.trail, trail);
	assert.deepEqual(locations.at(-1).trail, trail);
	assert.equal(locations.at(-1).path, "/a");
	assert.equal(win.callsOf("push").length, 1);
});

test("getHistory returns the installed instance and undefined after destroy", (t) => {
	assert.equal(getHistory(), undefined);
	const { h } = makeEnv(t, { dwellMs: 0 });
	assert.equal(getHistory(), h);
	h.destroy();
	assert.equal(getHistory(), undefined);
});

test("whenHistory called before install resolves at install", async (t) => {
	const waiting = whenHistory();
	let settled = false;
	waiting.then(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	const { h } = makeEnv(t, { dwellMs: 0 });
	assert.equal(await waiting, h);
	assert.equal(await whenHistory(), h); // and after install, at once
});

test("destroy removes every listener it added", (t) => {
	const { win, h } = makeEnv(t, { dwellMs: 0 });
	assert.equal(win.listenerCount("popstate"), 1);
	assert.equal(win.document.listenerCount("dj-navigate"), 1);
	assert.equal(win.document.listenerCount("visibilitychange"), 1);
	h.destroy();
	assert.equal(win.listenerCount("popstate"), 0);
	assert.equal(win.document.listenerCount("dj-navigate"), 0);
	assert.equal(win.document.listenerCount("visibilitychange"), 0);
});

test("dist/handle.js and handle.d.ts import nothing, in particular not @dojo-ng/pubsub", () => {
	for (const file of ["handle.js", "handle.d.ts"]) {
		const text = readFileSync(fileURLToPath(new URL(`../dist/${file}`, import.meta.url)), "utf8");
		assert.doesNotMatch(text, /@dojo-ng\/pubsub/, file);
		assert.doesNotMatch(text, /^\s*(import|export)\b[^\n]*\bfrom\b/m, `${file} has an import or re-export`);
	}
});

// --- H5: coexistence warnings -------------------------------------------------------------------

test("a clean run produces no warnings", (t) => {
	const warn = noWarn(t);
	const { h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	h.go("/b");
	h.back();
	h.forward();
	h.annotate({ trail: [] });
	h.commit();
	assert.equal(warn.mock.callCount(), 0);
});

test("a patched pushState warns once at install, naming the signal", (t) => {
	const warn = noWarn(t);
	const win = new FakeWindow();
	const original = win.history.pushState;
	win.history.pushState = function patched(...args) { return original(...args); };
	const h = installHistory(createPubSub(), { window: win, dwellMs: 0 });
	t.after(() => h.destroy());
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /patched-pushstate/);
	h.go("/still-works");
	assert.equal(h.current.path, "/still-works"); // D6: warn, then keep going
	assert.equal(warn.mock.callCount(), 1);
});

test("a foreign pushState followed by Back warns once", (t) => {
	const warn = noWarn(t);
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	win.history.pushState(null, "", "/foreign"); // another router
	h.back();
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /foreign-location/);
	assert.equal(locations.at(-1).path, "/"); // and the pop was handled as normal
});

test("a foreign pushState followed by nav:go warns once", (t) => {
	const warn = noWarn(t);
	const { win, h } = makeEnv(t, { dwellMs: 0 });
	win.history.pushState(null, "", "/foreign");
	h.go("/a");
	h.go("/b");
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /foreign-location/);
});

test("Back onto an entry without our state warns with its own signal", (t) => {
	const warn = noWarn(t);
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	win.history.pushState(null, "", "/foreign1");
	win.history.pushState(null, "", "/foreign2");
	h.back();
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /foreign-entry/);
	assert.equal(locations.at(-1).path, "/foreign1");
});

test("two foreign pushes still produce exactly one warning per signal type", (t) => {
	const warn = noWarn(t);
	const { win, h } = makeEnv(t, { dwellMs: 0 });
	win.history.pushState(null, "", "/foreign1");
	win.history.pushState(null, "", "/foreign2");
	h.back(); // onto foreign1: no state of ours
	h.back(); // onto the landing entry, which is already current: history changed without a nav:go
	win.history.pushState(null, "", "/foreign3");
	win.history.pushState(null, "", "/foreign4");
	h.back();
	h.back();
	const signals = warn.mock.calls.map((c) => /\((foreign-[a-z]+)\)/.exec(c.arguments[0])?.[1]).sort();
	assert.deepEqual(signals, ["foreign-entry", "foreign-location"]);
});

// --- H6: the dj-navigate listener ----------------------------------------------------------------

function elementInShadowRoot(win) {
	const host = win.document.appendChild(new FakeNode());
	return host.attachShadow().appendChild(new FakeNode());
}

test("dj-navigate from inside an open shadow root reaches the listener, pushes, and publishes with the trail", (t) => {
	const { win, locations } = makeEnv(t, { dwellMs: 0 });
	const trail = [{ path: "/", label: "Home" }, { path: "/topics", label: "Topics" }];
	elementInShadowRoot(win).dispatchEvent(
		new CustomEvent("dj-navigate", { detail: { path: "/topics", trail, label: "Topics" }, bubbles: true, composed: true }),
	);
	assert.equal(win.location.pathname, "/topics");
	assert.equal(win.callsOf("push").length, 1);
	assert.deepEqual(locations.at(-1).trail, trail);
	assert.deepEqual(win.history.state.trail, trail); // and it is in the entry's state
});

test("the fake honors composed: a non-composed dj-navigate stays inside the shadow root", (t) => {
	const { win, locations } = makeEnv(t, { dwellMs: 0 });
	elementInShadowRoot(win).dispatchEvent(
		new CustomEvent("dj-navigate", { detail: { path: "/nope" }, bubbles: true, composed: false }),
	);
	assert.equal(locations.length, 1);
});

test("after a Back, the earlier entry's trail comes back in the pop payload", (t) => {
	const { win, locations } = makeEnv(t, { dwellMs: 0 });
	const trailA = [{ path: "/a", label: "A" }];
	const trailB = [{ path: "/a", label: "A" }, { path: "/a/b", label: "B" }];
	const el = elementInShadowRoot(win);
	const fire = (path, trail) => el.dispatchEvent(new CustomEvent("dj-navigate", { detail: { path, trail }, bubbles: true, composed: true }));
	fire("/a", trailA);
	fire("/a/b", trailB);
	win.history.back();
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source], ["/a", "pop"]);
	assert.deepEqual(locations.at(-1).trail, trailA);
	win.history.forward();
	assert.deepEqual(locations.at(-1).trail, trailB);
});

test("dj-navigate detail with replace and state is honored; a detail without a path is ignored", (t) => {
	const { win, locations } = makeEnv(t, { dwellMs: 0 });
	const el = win.document.appendChild(new FakeNode());
	const fire = (detail) => el.dispatchEvent(new CustomEvent("dj-navigate", { detail, bubbles: true, composed: true }));
	fire({ path: "/a" });
	fire({ path: "/b", state: { k: 1 }, replace: true });
	fire({ label: "no path" });
	fire(undefined);
	assert.deepEqual(win.paths, ["/", "/b"]);
	assert.deepEqual(locations.at(-1).state, { k: 1 });
	assert.equal(locations.length, 3);
});
