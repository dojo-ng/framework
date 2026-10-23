/**
 * Hash mode (H9): the route lives after `#`. The fake window pushes a null-state entry and fires
 * popstate then hashchange when the user edits the hash, as a browser does.
 *
 * Run: node --test test/hash.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./fixtures/env.mjs";

const hashEnv = (t, options = {}) => makeEnv(t, { dwellMs: 0, mode: "hash", ...options });
const noWarn = (t) => t.mock.method(console, "warn", () => {});

test("landing on #/a/b?x=1 publishes /a/b?x=1 as load", (t) => {
	const { locations } = hashEnv(t, { window: { url: "http://example.test/app.html#/a/b?x=1" } });
	assert.deepEqual(locations.map((l) => [l.path, l.source]), [["/a/b?x=1", "load"]]);
});

test("an empty hash gives /", (t) => {
	assert.equal(hashEnv(t, { window: { url: "http://example.test/app.html" } }).h.current.path, "/");
});

test("a bare # gives /", (t) => {
	assert.equal(hashEnv(t, { window: { url: "http://example.test/app.html#" } }).h.current.path, "/");
});

test("go writes #/path with the page's own path untouched, and publishes the bare route", (t) => {
	const { win, h, locations } = hashEnv(t, { window: { url: "http://example.test/app.html" } });
	h.go("/orders/7");
	assert.equal(win.calls.at(-1).type, "push");
	assert.equal(win.calls.at(-1).url, "#/orders/7");
	assert.equal(win.location.pathname, "/app.html");
	assert.equal(win.location.hash, "#/orders/7");
	assert.equal(locations.at(-1).path, "/orders/7");
});

test("href(path) is # plus the path", (t) => {
	const { h } = hashEnv(t);
	assert.equal(h.href("/x"), "#/x");
});

test("a hash without a leading slash is read as a rooted route", (t) => {
	const { h } = hashEnv(t, { window: { url: "http://example.test/app.html#foo" } });
	assert.equal(h.current.path, "/foo");
});

test("an address-bar hash edit is published once, as a go, stamped through the writer, with no warning", (t) => {
	const warn = noWarn(t);
	const { win, h, locations } = hashEnv(t);
	h.go("/a");
	const callsBefore = win.calls.length;
	const published = locations.length;

	win.editHash("#/typed");

	assert.equal(locations.length, published + 1, "published once");
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source, locations.at(-1).index, locations.at(-1).committed], ["/typed", "go", 2, true]);
	assert.equal(win.calls.length, callsBefore + 1);
	assert.equal(win.calls.at(-1).type, "replace", "the browser's entry is stamped in place");
	assert.equal(win.history.length, 3, "no extra entry");
	assert.equal(win.history.state.__djnav.index, 2);
	assert.equal(warn.mock.callCount(), 0);
});

test("Back and Forward across hash entries publish a pop once each (the hashchange is ignored)", (t) => {
	const warn = noWarn(t);
	const { win, h, locations } = hashEnv(t);
	h.go("/a");
	h.go("/b");
	const callsBefore = win.calls.length;
	const published = locations.length;
	h.back();
	h.forward();
	assert.deepEqual(locations.slice(published).map((l) => [l.path, l.source]), [["/a", "pop"], ["/b", "pop"]]);
	assert.equal(win.calls.length, callsBefore);
	assert.equal(warn.mock.callCount(), 0);
});

test("base is ignored in hash mode, with one warning", (t) => {
	const warn = noWarn(t);
	const { win, h } = hashEnv(t, { base: "/acme", window: { url: "http://example.test/app.html#/a" } });
	assert.equal(h.current.path, "/a");
	h.go("/b");
	assert.equal(win.location.hash, "#/b");
	assert.equal(warn.mock.callCount(), 1);
	assert.match(warn.mock.calls[0].arguments[0], /ignored in hash mode/);
});

test("app3 regression in hash mode: a pop never writes, and Forward still reaches the entry after it", (t) => {
	const { win, locations, h } = hashEnv(t);
	h.go("/a");
	h.go("/b");
	assert.equal(win.history.length, 3);
	const callsBefore = win.calls.length;
	h.back();
	assert.equal(win.history.length, 3);
	assert.equal(win.calls.length, callsBefore);
	assert.equal(locations.at(-1).path, "/a");
	h.forward();
	assert.equal(win.calls.length, callsBefore);
	assert.deepEqual([locations.at(-1).path, locations.at(-1).source], ["/b", "pop"]);
});

test("destroy removes the hashchange listener", (t) => {
	const { win, h } = hashEnv(t);
	assert.equal(win.listenerCount("hashchange"), 1);
	h.destroy();
	assert.equal(win.listenerCount("hashchange"), 0);
});
