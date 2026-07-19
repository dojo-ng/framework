// Real-browser smoke: decision 3 (framework-browser-smoke-spec.md) — events land
// as real addEventListener/removeEventListener calls, not just op-log entries.
import { v } from "../../dist/core/vdom.js";
import { cleanup, mountApp, assert, assertEqual } from "./helpers.mjs";

describe("events (decision 3)", () => {
	afterEach(cleanup);

	it("a real click fires the handler", () => {
		let clicks = 0;
		const { container } = mountApp(() => v("button", { onclick: () => clicks++ }, ["go"]));
		const btn = container.querySelector("button");
		btn.click();
		assertEqual(clicks, 1, "native .click() should dispatch a real click event");
		btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		assertEqual(clicks, 2, "a manually dispatched MouseEvent should also fire it");
	});

	it("replacing the handler function detaches the old listener", () => {
		const calls = [];
		let handler = () => calls.push("first");
		const { container, update } = mountApp(() => v("button", { onclick: handler }, ["go"]));
		const btn = container.querySelector("button");
		btn.click();
		assertEqual(calls.join(","), "first");

		handler = () => calls.push("second"); // fresh closure identity
		update();
		assert(container.querySelector("button") === btn, "same element patched in place, not replaced");
		btn.click();
		assertEqual(calls.join(","), "first,second", "only the new handler should fire, exactly once");
	});

	it("removing the vnode removes the listener (no call after removal)", () => {
		let show = true;
		let clicks = 0;
		const { container, update } = mountApp(() =>
			show ? v("button", { onclick: () => clicks++ }, ["go"]) : v("div", {}, [])
		);
		const btn = container.querySelector("button");
		btn.click();
		assertEqual(clicks, 1);

		show = false;
		update();
		assert(container.querySelector("button") === null, "the button should be gone from the live tree");
		// Dispatch directly on the DETACHED node reference. A real addEventListener
		// keeps firing on a node even after it's removed from the document, so this
		// only stays silent if the renderer actually called removeEventListener.
		btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		assertEqual(clicks, 1, "no call after removal — the listener must be gone, not just unreachable");
	});
});
