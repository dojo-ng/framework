/**
 * Golden behavior + op-sequence tests for the renderer (core/vdom.js), #126.
 *
 * Covers mount, non-keyed update, keyed reconciliation (op traces + minimality
 * invariants), and the dom() lifecycle (onAttach/onUpdate/onDetach, unmount).
 * Asserts both the resulting DOM and the exact DOM-mutation sequence.
 *
 * Run: node --test test/vdom.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountApp, mountWith, createMockDom, renderer, v, domVNode } from "./harness.mjs";
import has from "../dist/core/has.js";

// --- mount: structure -------------------------------------------------------

test("mount: nested elements, text, and string attributes", () => {
	const app = mountApp(() => v("div", { id: "a" }, [v("span", {}, ["hi"]), v("em", {}, ["x"])]));
	assert.equal(app.html(), '<div id="a"><span>hi</span><em>x</em></div>');
});

test("mount: deeply nested tree", () => {
	const app = mountApp(() => v("ul", {}, [v("li", {}, [v("a", { href: "/x" }, ["link"])])]));
	assert.equal(app.html(), '<ul><li><a href="/x">link</a></li></ul>');
});

// --- attribute vs property --------------------------------------------------

test("native element: string prop → attribute, non-string prop → property", () => {
	const app = mountApp(() => v("input", { type: "text", tabindex: 2, disabled: true }, []));
	const html = app.html();
	assert.match(html, /type="text"/);
	assert.match(html, /\.tabindex=2/);
	assert.match(html, /\.disabled=true/);
});

test("property-first: custom-element supported string prop → property, unsupported → attribute", () => {
	const app = mountApp(() => v("dj-button", { kind: "outlined", "data-x": "y" }, ["Save"]), {
		defineProps: { "dj-button": ["kind"] }
	});
	const html = app.html();
	assert.match(html, /\.kind="outlined"/);
	assert.match(html, /data-x="y"/);
});

// --- events -----------------------------------------------------------------

test("events: on<name> registers a listener that fires", () => {
	let clicks = 0;
	const app = mountApp(() => v("button", { onclick: () => clicks++ }, ["ok"]));
	const btn = app.childrenOf(app.root)[0];
	assert.deepEqual(app.dom.eventsOf(btn), ["click"]);
	app.fireEvent(btn, "click");
	assert.equal(clicks, 1);
});

test("events: a new inline handler each render swaps with zero DOM ops and fires the latest", () => {
	let tag = "a";
	let fired = null;
	const app = mountApp(() => {
		const t = tag;
		return v("button", { onclick: () => { fired = t; } }, ["ok"]);
	});
	const btn = app.childrenOf(app.root)[0];
	app.fireEvent(btn, "click");
	assert.equal(fired, "a");
	app.clearOps();
	tag = "b"; // fresh closure identity next render
	app.update();
	assert.equal(app.counts().addEvent || 0, 0, "no re-registration on handler identity change");
	assert.equal(app.counts().removeEvent || 0, 0);
	app.fireEvent(btn, "click");
	assert.equal(fired, "b", "the latest handler fires through the stable dispatcher");
});

test("events: a handler changing from a function to a non-function removes the listener", () => {
	let clicks = 0;
	let mode = "fn";
	const app = mountApp(() => v("button", mode === "fn" ? { onclick: () => { clicks++; } } : { onclick: "x" }, ["ok"]));
	const btn = app.childrenOf(app.root)[0];
	app.fireEvent(btn, "click");
	assert.equal(clicks, 1);
	app.clearOps();
	mode = "str"; // onclick becomes a non-function
	app.update();
	assert.equal(app.counts().removeEvent || 0, 1, "listener torn down on function → non-function");
	app.fireEvent(btn, "click");
	assert.equal(clicks, 1, "the removed handler no longer fires");
});

// --- virtual / deferred -----------------------------------------------------

test("virtual node renders its children with no wrapper element", () => {
	const app = mountApp(() =>
		v("div", {}, [v("virtual", {}, [v("span", {}, ["a"]), v("span", {}, ["b"])])])
	);
	assert.equal(app.html(), "<div><span>a</span><span>b</span></div>");
});

test("deferred properties (function form) resolve onto the node", () => {
	const app = mountApp(() => v("div", () => ({ id: "deferred" }), ["x"]));
	assert.match(app.html(), /id="deferred"/);
});

test("deferred properties resolve once per render; the diff uses the stored baseline", () => {
	// A non-idempotent callback: a different value every time it is invoked.
	let calls = 0;
	const cb = () => ({ "data-x": String(++calls) });
	const app = mountApp(() => v("div", cb, []));
	assert.equal(calls, 1, "resolved once on mount");
	assert.match(app.html(), /data-x="1"/);

	app.clearOps();
	app.update();
	// The update resolves the NEW vnode once (calls → 2) and diffs against the
	// STORED old resolution {data-x:"1"} — it must NOT re-invoke the old callback.
	assert.equal(calls, 2, "one more resolve for the new render, not a re-resolve of the old baseline");
	assert.equal(app.counts().setAttribute, 1, "exactly one setAttribute (1 → 2)");
	assert.equal(app.counts().removeAttribute || 0, 0, "no spurious remove from a corrupted baseline");
	assert.match(app.html(), /data-x="2"/);
});

// --- controlled native inputs (value / checked) -----------------------------

test("controlled input value is a property and re-render overrides a user edit", () => {
	let value = "a";
	const app = mountApp(() => v("input", { value }, []));
	const input = app.childrenOf(app.root)[0];
	assert.equal(input.value, "a", "value applied as a DOM property on mount, not just an attribute");
	input.value = "typed"; // simulate the user typing (dirties the live value)
	value = "b";
	app.update();
	assert.equal(input.value, "b", "re-render sets the intended value even over the user edit");
});

test("controlled checked is reasserted after a user toggle even when the render value is unchanged", () => {
	const checked = true; // render always wants checked=true
	const app = mountApp(() => v("input", { type: "checkbox", checked }, []));
	const box = app.childrenOf(app.root)[0];
	assert.equal(box.checked, true);
	box.checked = false; // user unticks
	app.update(); // same vnode value (true); old code skipped this (value===prev) and left it false
	assert.equal(box.checked, true, "controlled checked reasserted against the live DOM state");
});

// --- dom() + onAttach -------------------------------------------------------

test("dom(): adopts the wrapped existing node (identity + attrs) and appends children", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	dom.nodeApi.setAttribute(ext, "data-ext", "1");
	const app = mountWith(dom, () => v("div", {}, [domVNode({ node: ext }, ["hi"])]));
	assert.equal(app.html(), '<div><section data-ext="1">hi</section></div>');
	assert.equal(dom.childrenOf(dom.childrenOf(dom.root)[0])[0], ext);
});

test("dom(): onAttach fires once on mount", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	let attached = 0;
	mountWith(dom, () => v("div", {}, [domVNode({ node: ext, onAttach: () => attached++ }, [])]));
	assert.equal(attached, 1);
});

test("dom(): nested wrapped nodes attach parent→child", () => {
	const dom = createMockDom();
	const outer = dom.createElement("section");
	const inner = dom.createElement("article");
	const order = [];
	mountWith(dom, () =>
		v("div", {}, [
			domVNode({ node: outer, onAttach: () => order.push("outer") }, [
				domVNode({ node: inner, onAttach: () => order.push("inner") }, ["x"])
			])
		])
	);
	assert.deepEqual(order, ["outer", "inner"]);
});

// ===========================================================================
// Chunk C — non-keyed update (invalidate → re-render → position diff)
// ===========================================================================
//
// Drive an update by mutating closed-over state between renders, then calling
// app.update() (the new renderer's native invalidate()).

/** Mount render(state), clear ops, set state=next, update. Returns the app. */
function run(render, initial, next, opts) {
	let state = initial;
	const app = mountApp(() => render(state), opts);
	app.clearOps();
	state = next;
	app.update();
	return app;
}

// --- patch in place ---------------------------------------------------------

test("update: text and attribute changes patch in place", () => {
	const app = run((s) => v("div", { class: s.cls }, [s.label]), { cls: "x", label: "a" }, { cls: "y", label: "b" });
	assert.equal(app.html(), '<div class="y">b</div>');
});

test("update: nested subtree patches without rebuilding the parent", () => {
	const app = run(
		(s) => v("div", { id: "root" }, [v("span", {}, [s])]),
		"a",
		"b"
	);
	assert.equal(app.html(), '<div id="root"><span>b</span></div>');
	// only the text node changed → no structural ops, no element creation
	assert.deepEqual(app.trace(), []);
	assert.equal((app.counts().create || 0), 0);
});

// --- GATE: no-op = zero ops -------------------------------------------------

test("GATE no-op: re-rendering an identical tree makes zero DOM mutations", () => {
	const app = run(
		() => v("div", { id: "a" }, [v("span", {}, ["hi"]), v("em", {}, ["x"])]),
		0,
		1 // state changes but the produced tree is identical
	);
	assert.deepEqual(app.counts(), {}, "no DOM ops at all for an unchanged tree");
});

// --- GATE: attr / prop change = exactly one op ------------------------------

test("GATE attr change: patches only that attribute (1 op)", () => {
	const app = run((cls) => v("div", { class: cls }, ["t"]), "x", "y");
	assert.equal(app.html(), '<div class="y">t</div>');
	assert.deepEqual(app.trace(), [], "no structural ops");
	assert.equal(app.counts().setAttribute, 1);
	assert.equal(app.counts().create || 0, 0);
});

test("GATE prop change: custom-element property patches only that property (1 op)", () => {
	const app = run((kind) => v("dj-x", { kind }, []), "a", "b", { defineProps: { "dj-x": ["kind"] } });
	assert.deepEqual(app.trace(), [], "no structural ops");
	assert.equal(app.counts().setProperty, 1);
	assert.equal(app.counts().setAttribute || 0, 0, "supported string prop on a custom element is a property");
});

// --- GATE: append / remove trailing children --------------------------------

test("GATE append: appending a trailing child creates one element, removes none", () => {
	let items = ["a", "b"];
	const app = mountApp(() => v("ul", {}, items.map((t) => v("li", {}, [t]))));
	app.clearOps();
	items = ["a", "b", "c"];
	app.update();
	assert.equal(app.html(), "<ul><li>a</li><li>b</li><li>c</li></ul>");
	assert.equal(app.counts().create, 1, "exactly one new <li>");
	assert.equal(app.counts().removeChild || 0, 0, "appending removes nothing");
});

test("GATE remove: dropping trailing children removes them, creates nothing", () => {
	let items = ["a", "b", "c"];
	const app = mountApp(() => v("ul", {}, items.map((t) => v("li", {}, [t]))));
	app.clearOps();
	items = ["a"];
	app.update();
	assert.equal(app.html(), "<ul><li>a</li></ul>");
	assert.equal(app.counts().removeChild, 2, "removed the two trailing <li>");
	assert.equal(app.counts().create || 0, 0, "removing creates nothing");
});

// --- GATE: tag replace ------------------------------------------------------

test("GATE tag-replace: changing the tag builds a new element and removes the old", () => {
	const app = run((tag) => v("div", {}, [v(tag, {}, ["x"])]), "span", "em");
	assert.equal(app.html(), "<div><em>x</em></div>");
	assert.equal(app.counts().create, 1, "one new element");
	assert.equal(app.counts().removeChild, 1, "old element removed");
	// new subtree inserted before the old node, then the old node removed
	assert.deepEqual(app.trace(), [
		'insertBefore em: #text"x" before (end)',
		'insertBefore div: em"x" before span"x"',
		'removeChild div: span"x"'
	]);
});

// --- removed property -------------------------------------------------------

test("update: a property dropped between renders is removed from the DOM", () => {
	const app = run((s) => v("div", s.props, ["t"]), { props: { id: "a", title: "hi" } }, { props: { id: "a" } });
	assert.equal(app.html(), '<div id="a">t</div>', "title attribute gone, id kept");
	assert.equal(app.counts().removeAttribute, 1);
});

// --- conditional (falsy) child slot -----------------------------------------

test("update: a child toggling false→present inserts at the right position", () => {
	const app = run(
		(on) => v("ul", {}, [v("li", {}, ["a"]), on && v("li", {}, ["b"]), v("li", {}, ["c"])]),
		false,
		true
	);
	assert.equal(app.html(), "<ul><li>a</li><li>b</li><li>c</li></ul>");
	assert.equal(app.counts().create, 1, "one new <li> inserted, others untouched");
});

test("update: a child toggling present→false is removed in place", () => {
	const app = run(
		(on) => v("ul", {}, [v("li", {}, ["a"]), on && v("li", {}, ["b"]), v("li", {}, ["c"])]),
		true,
		false
	);
	assert.equal(app.html(), "<ul><li>a</li><li>c</li></ul>");
	assert.equal(app.counts().removeChild, 1);
	assert.equal(app.counts().create || 0, 0);
});

// ===========================================================================
// Chunk D — keyed reconciliation (O(n) reuse-by-key, minimal LIS moves)
// ===========================================================================

const list = (items) => v("ul", {}, items.map((t) => v("li", { key: t }, [t])));
const cnt = (app) => app.counts();

// --- minimality invariants (must hold for any correct keyed reconciler) -----

test("GATE keyed no-op: identical keyed re-render makes zero DOM mutations", () => {
	const app = run(list, ["a", "b"], ["a", "b"]);
	assert.deepEqual(app.trace(), []);
	assert.deepEqual(cnt(app), {}, "no DOM ops at all for an unchanged keyed list");
});

test("GATE keyed reorder a,b,c → c,a,b: pure moves, nothing created or removed", () => {
	const app = run(list, ["a", "b", "c"], ["c", "a", "b"]);
	assert.equal(app.html(), "<ul><li>c</li><li>a</li><li>b</li></ul>");
	// LIS keeps a,b in place; only c moves (one op).
	assert.deepEqual(app.trace(), ['insertBefore ul: li"c" before li"a"']);
	assert.equal(cnt(app).create || 0, 0, "reorder creates nothing");
	assert.equal(cnt(app).removeChild || 0, 0, "reorder removes nothing");
});

test("GATE keyed reverse a,b,c,d → d,c,b,a: O(n) moves, no teardown", () => {
	const app = run(list, ["a", "b", "c", "d"], ["d", "c", "b", "a"]);
	assert.equal(app.html(), "<ul><li>d</li><li>c</li><li>b</li><li>a</li></ul>");
	assert.deepEqual(app.trace(), [
		'insertBefore ul: li"b" before li"a"',
		'insertBefore ul: li"c" before li"b"',
		'insertBefore ul: li"d" before li"c"'
	]);
	assert.equal(cnt(app).create || 0, 0, "reverse creates nothing");
	assert.equal(cnt(app).removeChild || 0, 0, "reverse removes nothing");
});

test("GATE keyed remove middle a,b,c → a,c: single removeChild, no moves/creates", () => {
	const app = run(list, ["a", "b", "c"], ["a", "c"]);
	assert.equal(app.html(), "<ul><li>a</li><li>c</li></ul>");
	assert.deepEqual(app.trace(), ['removeChild ul: li"b"']);
	assert.equal(cnt(app).create || 0, 0);
	assert.equal(cnt(app).insertBefore || 0, 0, "removing a key moves nothing");
	assert.equal(cnt(app).removeChild, 1);
});

test("GATE keyed insert middle a,c → a,b,c: one create, no removes", () => {
	const app = run(list, ["a", "c"], ["a", "b", "c"]);
	assert.equal(app.html(), "<ul><li>a</li><li>b</li><li>c</li></ul>");
	assert.deepEqual(app.trace(), [
		'insertBefore li: #text"b" before (end)',
		'insertBefore ul: li"b" before li"c"'
	]);
	assert.equal(cnt(app).create, 1, "exactly one new element");
	assert.equal(cnt(app).removeChild || 0, 0, "inserting removes nothing");
});

test("GATE keyed prepend b,c → a,b,c: one create at the front, no removes", () => {
	const app = run(list, ["b", "c"], ["a", "b", "c"]);
	assert.equal(app.html(), "<ul><li>a</li><li>b</li><li>c</li></ul>");
	assert.deepEqual(app.trace(), [
		'insertBefore li: #text"a" before (end)',
		'insertBefore ul: li"a" before li"b"'
	]);
	assert.equal(cnt(app).create, 1);
	assert.equal(cnt(app).removeChild || 0, 0);
});

// --- combined reorder + add + remove ----------------------------------------

test("keyed reorder + add + remove a,b,c → c,a,d: reuse c/a, drop b, add d", () => {
	const app = run(list, ["a", "b", "c"], ["c", "a", "d"]);
	assert.equal(app.html(), "<ul><li>c</li><li>a</li><li>d</li></ul>");
	assert.equal(cnt(app).create, 1, "only d is created");
	assert.equal(cnt(app).removeChild, 1, "only b is removed");
});

test("keyed: a key whose tag changed is rebuilt, not reused", () => {
	const render = (s) => v("ul", {}, [v(s.tag, { key: "x" }, ["x"]), v("li", { key: "y" }, ["y"])]);
	const app = run(render, { tag: "li" }, { tag: "section" });
	assert.equal(app.html(), "<ul><section>x</section><li>y</li></ul>");
	assert.equal(cnt(app).create, 1, "tag change rebuilds the keyed node");
	assert.equal(cnt(app).removeChild, 1, "old element for that key removed");
});

// --- property patching survives a move --------------------------------------

test("keyed: a moved row still gets its props patched", () => {
	const render = (items) =>
		v("ul", {}, items.map(({ k, cls }) => v("li", { key: k, class: cls }, [k])));
	const app = run(
		render,
		[{ k: "a", cls: "x" }, { k: "b", cls: "x" }],
		[{ k: "b", cls: "y" }, { k: "a", cls: "x" }]
	);
	assert.equal(app.html(), '<ul><li class="y">b</li><li class="x">a</li></ul>');
	assert.equal(cnt(app).create || 0, 0);
	assert.equal(cnt(app).removeChild || 0, 0);
});

// --- nested keyed lists -----------------------------------------------------

test("keyed: nested keyed list reorders within a reordered parent", () => {
	const render = (groups) =>
		v(
			"div",
			{},
			groups.map((g) => v("section", { key: g.id }, [list(g.items)]))
		);
	const app = run(
		render,
		[{ id: "g1", items: ["a", "b"] }, { id: "g2", items: ["c", "d"] }],
		[{ id: "g2", items: ["d", "c"] }, { id: "g1", items: ["a", "b"] }]
	);
	assert.equal(
		app.html(),
		"<div><section><ul><li>d</li><li>c</li></ul></section><section><ul><li>a</li><li>b</li></ul></section></div>"
	);
	assert.equal(cnt(app).create || 0, 0, "everything reused");
	assert.equal(cnt(app).removeChild || 0, 0);
});

// ===========================================================================
// Chunk E — lifecycle + edges (onUpdate / onDetach / unmount)
// ===========================================================================

test("lifecycle: dom() onUpdate fires on re-render while the node stays mounted", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	let updated = 0;
	const app = mountWith(dom, () => v("div", {}, [domVNode({ node: ext, onUpdate: () => updated++ }, [])]));
	assert.equal(updated, 0, "no onUpdate on initial mount");
	app.update();
	assert.equal(updated, 1);
	app.update();
	assert.equal(updated, 2);
});

test("dom(): an unchanged re-render emits no attr or event ops", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	const handler = () => {};
	const app = mountWith(dom, () => v("div", {}, [domVNode({ node: ext, attrs: { "data-x": "1" }, on: { click: handler } }, [])]));
	app.clearOps();
	app.update(); // same attr value, same handler reference
	assert.equal(app.counts().setAttribute || 0, 0, "unchanged attr is not re-set");
	assert.equal(app.counts().addEvent || 0, 0, "same handler reference is not re-registered");
});

test("dom(): a changed handler reference swaps behind the dispatcher with zero DOM ops and fires", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	let fired = null;
	let tag = "a";
	const app = mountWith(dom, () => {
		const t = tag;
		return v("div", {}, [domVNode({ node: ext, on: { click: () => { fired = t; } } }, [])]);
	});
	app.clearOps();
	tag = "b"; // next render's handler is a fresh closure with a new identity
	app.update();
	assert.equal(app.counts().removeEvent || 0, 0, "no listener churn on handler identity change");
	assert.equal(app.counts().addEvent || 0, 0);
	dom.fireEvent(ext, "click");
	assert.equal(fired, "b", "the swapped-in handler fires");
});

test("lifecycle: dom() onDetach fires when the node is removed from the tree", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	let detached = 0;
	let show = true;
	const app = mountWith(dom, () =>
		v("div", {}, show ? [domVNode({ node: ext, onDetach: () => detached++ }, [])] : [])
	);
	assert.equal(detached, 0);
	show = false;
	app.update();
	assert.equal(detached, 1);
	assert.equal(app.html(), "<div></div>");
});

test("lifecycle: dom() onDetach fires on unmount", () => {
	const dom = createMockDom();
	const ext = dom.createElement("section");
	let detached = 0;
	const app = mountWith(dom, () => v("div", {}, [domVNode({ node: ext, onDetach: () => detached++ }, [])]));
	app.unmount();
	assert.equal(detached, 1);
});

test("lifecycle: nested wrapped nodes detach parent→child on unmount", () => {
	const dom = createMockDom();
	const outer = dom.createElement("section");
	const inner = dom.createElement("article");
	const order = [];
	const app = mountWith(dom, () =>
		v("div", {}, [
			domVNode({ node: outer, onDetach: () => order.push("outer") }, [
				domVNode({ node: inner, onDetach: () => order.push("inner") }, ["x"])
			])
		])
	);
	app.unmount();
	assert.deepEqual(order, ["outer", "inner"]);
});

test("lifecycle: a dom() node nested in a removed keyed row still detaches", () => {
	const dom = createMockDom();
	const ext = dom.createElement("aside");
	let detached = 0;
	let items = ["a", "b"];
	const app = mountWith(dom, () =>
		v(
			"ul",
			{},
			items.map((t) =>
				v("li", { key: t }, t === "b" ? [domVNode({ node: ext, onDetach: () => detached++ }, [])] : [t])
			)
		)
	);
	items = ["a"]; // drop the row holding the dom() node
	app.update();
	assert.equal(detached, 1, "onDetach fires for a dom() node inside a removed keyed row");
});

test("unmount: removes the mounted tree and is idempotent", () => {
	const app = mountApp(() => v("div", {}, ["x"]));
	assert.equal(app.html(), "<div>x</div>");
	app.unmount();
	assert.equal(app.html(), "");
	app.unmount(); // second call is a no-op, no throw
	assert.equal(app.html(), "");
});

// --- dev guards (dojo-debug) -------------------------------------------------

test("keyed update warns once on a duplicate key under dojo-debug, silent in production", () => {
	let rows = [v("li", { key: "a" }, []), v("li", { key: "b" }, [])];
	const app = mountApp(() => v("ul", {}, rows));
	rows = [v("li", { key: "a" }, []), v("li", { key: "a" }, [])]; // duplicate key

	const origWarn = console.warn;
	// dojo-debug ON → exactly one warning for the repeated key.
	has.add("dojo-debug", true, true);
	let warns = 0;
	console.warn = () => warns++;
	try { app.update(); } finally { console.warn = origWarn; has.add("dojo-debug", false, true); }
	assert.equal(warns, 1, "one warning per render despite the duplicate");

	// dojo-debug OFF → no warning on the same duplicate-key update.
	let warnsOff = 0;
	console.warn = () => warnsOff++;
	try { app.update(); } finally { console.warn = origWarn; }
	assert.equal(warnsOff, 0, "no dev-guard cost in production");
});

// --- invalidate() batching ---------------------------------------------------

test("invalidate() batches: many calls in one tick collapse to one render", async () => {
	const dom = createMockDom();
	let renders = 0;
	const r = renderer(() => { renders++; return v("div", {}, [String(renders)]); });
	r.mount({ domNode: dom.root, nodeApi: dom.nodeApi }); // async (default) — no sync
	assert.equal(renders, 1, "one render on mount");

	r.invalidate();
	r.invalidate();
	r.invalidate();
	assert.equal(renders, 1, "invalidate does not render synchronously");

	await Promise.resolve(); // let the scheduled microtask flush
	assert.equal(renders, 2, "three invalidates coalesced into a single re-render");
});

test("mount({ sync: true }) renders on every invalidate immediately", () => {
	const dom = createMockDom();
	let renders = 0;
	const r = renderer(() => { renders++; return v("div", {}, []); });
	r.mount({ domNode: dom.root, nodeApi: dom.nodeApi, sync: true });
	assert.equal(renders, 1);
	r.invalidate();
	assert.equal(renders, 2, "sync mode renders synchronously");
	r.invalidate();
	assert.equal(renders, 3);
});

test("flush() runs a pending batched render immediately; unmount cancels it", async () => {
	const dom = createMockDom();
	let renders = 0;
	const r = renderer(() => { renders++; return v("div", {}, []); });
	r.mount({ domNode: dom.root, nodeApi: dom.nodeApi });
	r.invalidate();
	r.flush();
	assert.equal(renders, 2, "flush forces the pending render now");
	await Promise.resolve();
	assert.equal(renders, 2, "the scheduled microtask no-ops after flush");

	r.invalidate();
	r.unmount(); // cancels the scheduled render
	await Promise.resolve();
	assert.equal(renders, 2, "no render after unmount");
});
