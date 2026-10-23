/**
 * Dwell (H2): a page left within dwellMs is skimmed and does not stay on the stack. Fake timers and
 * a fake clock (setTimeout and Date) drive time; the fake window holds the stack.
 *
 * Run: node --test test/dwell.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fixtures/env.mjs";

function timers(t) {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	return t.mock.timers;
}

test("skimmed pages are replaced: landing, A (read), B C D (skimmed), E (read) leaves landing, A, E", (t) => {
	const clock = timers(t);
	const { win, locations, h } = makeEnv(t); // default dwellMs: 3000
	h.go("/a");
	clock.tick(3000);
	h.go("/b");
	clock.tick(1000);
	h.go("/c");
	clock.tick(1000);
	h.go("/d");
	clock.tick(1000);
	h.go("/e");
	clock.tick(3000);

	assert.deepEqual(win.paths, ["/", "/a", "/e"]);
	assert.equal(win.callsOf("push").length, 2); // A and B pushed; C, D, E replaced
	assert.deepEqual([locations.at(-1).path, locations.at(-1).committed], ["/e", true]);
	h.back();
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source], ["/a", "pop"]);
});

test("a new entry is provisional, then committed after dwellMs with a second publish", (t) => {
	const clock = timers(t);
	const { locations, h } = makeEnv(t);
	h.go("/a");
	assert.deepEqual(locations.slice(1).map((l) => [l.path, l.committed]), [["/a", false]]);
	clock.tick(2999);
	assert.equal(locations.length, 2);
	clock.tick(1);
	assert.deepEqual(locations.slice(1).map((l) => [l.path, l.committed]), [["/a", false], ["/a", true]]);
	assert.equal(h.current.committed, true);
});

test("the landing entry is committed at install", (t) => {
	timers(t);
	const { locations } = makeEnv(t);
	assert.equal(locations[0].committed, true);
});

test("dwellMs: 0 is plain browser behavior: every entry pushed and committed at once", (t) => {
	timers(t);
	const { win, locations, h } = makeEnv(t, { dwellMs: 0 });
	h.go("/a");
	h.go("/b");
	h.go("/c");
	assert.deepEqual(win.paths, ["/", "/a", "/b", "/c"]);
	assert.equal(win.callsOf("replace").length, 1); // only the install stamp
	assert.deepEqual(locations.slice(1).map((l) => l.committed), [true, true, true]);
	assert.equal(locations.length, 4, "one publish per entry, none for a later commit");
});

test("dwellMs is configurable", (t) => {
	const clock = timers(t);
	const { win, h } = makeEnv(t, { dwellMs: 500 });
	h.go("/a");
	clock.tick(500);
	h.go("/b");
	assert.deepEqual(win.paths, ["/", "/a", "/b"]);
});

test("commit() before dwellMs makes the next go push", (t) => {
	const clock = timers(t);
	const { win, locations, h } = makeEnv(t);
	h.go("/a");
	clock.tick(500);
	h.commit();
	assert.deepEqual([locations.at(-1).path, locations.at(-1).committed], ["/a", true]);
	h.go("/b");
	assert.deepEqual(win.paths, ["/", "/a", "/b"]);
	clock.tick(10_000); // the cancelled timer for A must not fire later
	assert.equal(locations.filter((l) => l.path === "/a" && l.committed).length, 1);
});

test("commit() on a committed entry does nothing", (t) => {
	timers(t);
	const { locations, h } = makeEnv(t);
	h.commit();
	assert.equal(locations.length, 1);
});

test("Back to a committed entry, then a fast go, pushes rather than replacing the committed entry", (t) => {
	const clock = timers(t);
	const { win, h } = makeEnv(t);
	h.go("/a");
	clock.tick(3000);
	h.go("/b");
	clock.tick(10);
	h.back(); // onto A, which already earned its place
	h.go("/c");
	assert.deepEqual(win.paths, ["/", "/a", "/c"]);
	assert.equal(win.callsOf("push").length, 3); // A, B, C: C was pushed after A, truncating B
});

test("Back also stops the pending timer of the entry it left", (t) => {
	const clock = timers(t);
	const { locations, h } = makeEnv(t);
	h.go("/a");
	clock.tick(100);
	h.back();
	const seen = locations.length;
	clock.tick(10_000);
	assert.equal(locations.length, seen);
});

test("Forward onto an entry that was left provisional commits it", (t) => {
	const clock = timers(t);
	const { locations, h } = makeEnv(t);
	h.go("/a");
	clock.tick(100);
	h.back();
	h.forward();
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source, locations.at(-1).committed], ["/a", "pop", true]);
	h.go("/b"); // A is committed now, so this pushes
	assert.equal(h.canGoBack, true);
	assert.equal(h.current.index, 2);
});

test("an explicit replace on a provisional entry replaces it and restarts the timer", (t) => {
	const clock = timers(t);
	const { win, locations, h } = makeEnv(t);
	h.go("/a");
	clock.tick(2000);
	h.go("/a2", undefined, { replace: true });
	clock.tick(2000); // 4 s since A, but only 2 s since A2
	assert.equal(locations.at(-1).committed, false);
	clock.tick(1000);
	assert.deepEqual([locations.at(-1).path, locations.at(-1).committed], ["/a2", true]);
	assert.deepEqual(win.paths, ["/", "/a2"]);
});

test("an explicit replace on a committed entry keeps its place: the replacement is committed", (t) => {
	timers(t);
	const { win, locations, h } = makeEnv(t);
	h.go("/home", undefined, { replace: true }); // e.g. a redirect at startup
	assert.deepEqual([locations.at(-1).path, locations.at(-1).committed], ["/home", true]);
	h.go("/a"); // pushed: the landing entry is not replaced by the next click
	assert.deepEqual(win.paths, ["/home", "/a"]);
});

test("hidden tab: only visible time counts toward the dwell", (t) => {
	const clock = timers(t);
	const { win, h } = makeEnv(t);
	h.go("/a");
	clock.tick(1000); // 1 s visible
	win.document.setVisibility("hidden");
	clock.tick(10_000); // 10 s hidden: the timer must not fire
	assert.equal(h.current.committed, false);
	win.document.setVisibility("visible");
	clock.tick(1000); // 2 s visible in total
	h.go("/b"); // still provisional, so it replaces
	assert.deepEqual(win.paths, ["/", "/b"]);
});

test("hidden tab: the remaining time resumes on show, and the entry then commits", (t) => {
	const clock = timers(t);
	const { win, h } = makeEnv(t);
	h.go("/a");
	clock.tick(1000);
	win.document.setVisibility("hidden");
	clock.tick(10_000);
	win.document.setVisibility("visible");
	clock.tick(1999);
	assert.equal(h.current.committed, false);
	clock.tick(1);
	assert.equal(h.current.committed, true);
	h.go("/b");
	assert.deepEqual(win.paths, ["/", "/a", "/b"]);
});

test("a go while the tab is hidden starts a fresh dwell that waits for the tab to show", (t) => {
	const clock = timers(t);
	const { win, h } = makeEnv(t);
	win.document.setVisibility("hidden");
	h.go("/a");
	clock.tick(60_000);
	assert.equal(h.current.committed, false);
	win.document.setVisibility("visible");
	clock.tick(3000);
	assert.equal(h.current.committed, true);
});
