// Real-browser smoke: decisions 1-2 (framework-browser-smoke-spec.md).
// The golden suite drives the renderer over a mock nodeApi and only ever asserts on
// an op log; this file is the first proof the renderer runs unmodified against an
// actual document and that the resulting mutations land on real nodes.
import { v } from "../../dist/core/vdom.js";
import { cleanup, mountApp, assert, assertEqual } from "./helpers.mjs";

describe("mount() with no nodeApi (decision 1)", () => {
	afterEach(cleanup);

	it("defaults to createDomApi(document) and renders into a real div", () => {
		// mountApp (helpers.mjs) never passes `nodeApi` to r.mount() — every test in
		// this suite exercises the default-nodeApi path; this one asserts it directly.
		const { container } = mountApp(() => v("p", { id: "hello" }, ["hi"]));
		assert(container instanceof HTMLDivElement, "the mount target itself is a real element");
		assert(container.isConnected, "the container is attached to the live document");
		const p = container.querySelector("#hello");
		assert(p instanceof HTMLParagraphElement, "should create a real <p> element, not a mock object");
		assertEqual(p.textContent, "hi");
	});
});

describe("real DOM updates land on the node (decision 2)", () => {
	afterEach(cleanup);

	it("text, attribute, and style updates are readable back off the element", () => {
		let state = { text: "a", cls: "one", title: "first", color: "red" };
		const { container, update } = mountApp(() =>
			v("div", { classes: state.cls, title: state.title, styles: { color: state.color } }, [state.text])
		);

		let div = container.querySelector("div");
		assertEqual(div.textContent, "a", "initial text");
		assertEqual(div.className, "one", "initial class");
		assertEqual(div.getAttribute("title"), "first", "title lands as a real attribute (string, native tag)");
		assertEqual(div.style.color, "red", "initial style");

		state = { text: "b", cls: "two", title: "second", color: "blue" };
		update();
		div = container.querySelector("div");
		assertEqual(div.textContent, "b", "updated text");
		assertEqual(div.className, "two", "updated class");
		assertEqual(div.getAttribute("title"), "second", "updated attribute");
		assertEqual(div.style.color, "blue", "updated style");
	});

	it("a non-string value lands as a real DOM property, not an attribute", () => {
		let disabled = false;
		const { container, update } = mountApp(() => v("button", { disabled, type: "button" }, ["go"]));

		let btn = container.querySelector("button");
		assertEqual(btn.disabled, false, "initial property value");

		disabled = true;
		update();
		btn = container.querySelector("button");
		assertEqual(btn.disabled, true, "updated property value reads back off the live element");
	});
});
