/**
 * Unit tests for the v()-only factories (v / tsx / dom) and node guards in the
 * renderer (core/vdom.js). Reconciliation behavior is covered by the golden suite
 * (test/vdom.test.mjs); this pins the hyperscript layer.
 *
 * Run: node --test test/factories.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../dist/core/vdom.js";
import has from "../dist/core/has.js";

const { v, tsx, dom, isVNode, isDomVNode } = m;

test("v(tag, properties, children)", () => {
	const n = v("div", { id: "x" }, ["hi"]);
	assert.equal(n.tag, "div");
	assert.deepEqual(n.properties, { id: "x" });
	assert.deepEqual(n.children, ["hi"]);
	assert.ok(isVNode(n));
});

test("v(tag, children) — array second arg is children", () => {
	const n = v("ul", [v("li", {}, ["a"])]);
	assert.deepEqual(n.properties, {});
	assert.equal(n.children.length, 1);
	assert.equal(n.children[0].tag, "li");
});

test("v(tag) — no properties or children", () => {
	const n = v("br");
	assert.equal(n.tag, "br");
	assert.deepEqual(n.properties, {});
	assert.equal(n.children, undefined);
});

test("v deferred properties (function form) stored separately", () => {
	const fn = () => ({ id: "deferred" });
	const n = v("div", fn, ["x"]);
	assert.equal(n.deferredPropertiesCallback, fn);
	assert.deepEqual(n.properties, {});
	assert.deepEqual(n.children, ["x"]);
});

test("v merge form — v(existingVNode, props) merges classes and overrides props", () => {
	const base = v("div", { id: "a", classes: ["x"], styles: { color: "red" } }, ["c"]);
	const merged = v(base, { id: "b", classes: ["y"], styles: { background: "blue" } });
	assert.equal(merged.tag, "div");
	assert.equal(merged.properties.id, "b", "later props override");
	assert.deepEqual(merged.properties.classes, ["x", "y"], "classes concatenated");
	assert.deepEqual(merged.properties.styles, { color: "red", background: "blue" }, "styles merged");
	assert.deepEqual(merged.children, ["c"], "inherits children when none given");
});

test("tsx — string tag, flattens nested children, null props -> {}", () => {
	const n = tsx("span", null, "a", ["b", ["c"]]);
	assert.ok(isVNode(n));
	assert.equal(n.tag, "span");
	assert.deepEqual(n.properties, {});
	assert.deepEqual(n.children, ["a", "b", "c"]);
});

test("tsx — non-string tag throws under dojo-debug (dev guard)", () => {
	has.add("dojo-debug", true, true);
	let threw = false;
	try { tsx(function Widget() {}, {}); } catch (e) { threw = /string tag/.test(e.message); }
	has.add("dojo-debug", false, true);
	assert.ok(threw, "widget tag rejected with a clear error");
	// production path (dojo-debug off): no per-call type check
	assert.doesNotThrow(() => tsx("section", null));
});

test("v — a nested-array child throws under dojo-debug, is silent in production", () => {
	has.add("dojo-debug", true, true);
	let threw = false;
	try { v("div", {}, [["a"]]); } catch (e) { threw = /does not flatten nested child arrays/.test(e.message); }
	has.add("dojo-debug", false, true);
	assert.ok(threw, "nested array child rejected with a clear error");
	// production path (dojo-debug off): no per-call check, v() just builds the node
	assert.doesNotThrow(() => v("div", {}, [["a"]]));
});

test("dom() — wraps an element node (tag lowercased, attrs/props/on/lifecycle preserved)", () => {
	const onAttach = () => {};
	const node = { tagName: "SECTION" };
	const d = dom({ node, attrs: { "data-x": "1" }, props: { foo: 1 }, on: { click: () => {} }, onAttach }, ["k"]);
	assert.ok(isDomVNode(d));
	assert.equal(d.tag, "section");
	assert.equal(d.domNode, node);
	assert.equal(d.attributes["data-x"], "1");
	assert.equal(d.properties.foo, 1);
	assert.equal(typeof d.events.click, "function");
	assert.equal(d.onAttach, onAttach);
	assert.deepEqual(d.children, ["k"]);
});

test("dom() — wraps a text node (empty tag)", () => {
	const d = dom({ node: { data: "hello" } });
	assert.equal(d.tag, "");
	assert.ok(isDomVNode(d));
});

test("guards reject strings, null, and plain objects", () => {
	for (const x of ["text", null, undefined, false, {}, { type: "nope" }]) {
		assert.equal(isVNode(x), false);
		assert.equal(isDomVNode(x), false);
	}
});
