// Real-browser smoke: decisions 6, 7, 8, 10 (framework-browser-smoke-spec.md) —
// dom()-adoption identity, deferred-property resolution timing, real microtask
// batching, and style handling against a real CSSStyleDeclaration.
import { v, dom } from "../../dist/core/vdom.js";
import { cleanup, mountApp, assert, assertEqual, nextFrame } from "./helpers.mjs";

describe("dom() adoption (decision 6)", () => {
	afterEach(cleanup);

	it("wraps a pre-existing real node and repeated updates don't clobber untouched state", () => {
		const el = document.createElement("section");
		el.dataset.manual = "untouched"; // state the framework was never told about

		let label = "one";
		const { container, update } = mountApp(() =>
			v("div", {}, [dom({ node: el, attrs: { "data-label": label } }, ["hi"])])
		);

		assert(container.querySelector("section") === el, "the exact pre-existing node is adopted, not cloned");
		assertEqual(el.getAttribute("data-label"), "one");
		assertEqual(el.dataset.manual, "untouched");

		label = "two";
		update();
		assert(container.querySelector("section") === el, "same node identity survives the update");
		assertEqual(el.getAttribute("data-label"), "two", "the attr dom() manages gets updated");
		assertEqual(el.dataset.manual, "untouched", "state dom() was never told about is left alone");
	});
});

describe("deferred properties (decision 7)", () => {
	afterEach(cleanup);

	it("resolve immediately (not deferred to a rAF tick) and stay stable across a real one", async () => {
		// "Deferred" names WHEN the callback runs relative to the render (once per
		// render, resolved fresh each time — see resolveProperties in vdom.ts), not an
		// rAF deferral. This asserts that directly: the value is on the real node
		// before any animation frame has run, and a real rAF tick doesn't re-resolve
		// or clobber it.
		let n = 0;
		const { container } = mountApp(() => v("div", () => ({ "data-n": String(++n) }), ["x"]));
		const div = container.querySelector("div");
		assertEqual(div.getAttribute("data-n"), "1", "resolved synchronously on mount, before any rAF tick");
		await nextFrame();
		assertEqual(div.getAttribute("data-n"), "1", "unchanged after a real requestAnimationFrame tick");
	});
});

describe("microtask batching (decision 8)", () => {
	afterEach(cleanup);

	it("two invalidate() calls in one task produce exactly one render", async () => {
		let renders = 0;
		let n = 0;
		const { r, container } = mountApp(
			() => {
				renders++;
				return v("div", {}, [String(n)]);
			},
			{ sync: false }
		);
		assertEqual(renders, 1, "the initial mount is one render");

		n = 1;
		r.invalidate();
		n = 2;
		r.invalidate(); // second call in the SAME task — must coalesce with the first
		assertEqual(renders, 1, "still just the mount — the batched render hasn't run yet");

		await Promise.resolve(); // let the already-queued microtask flush run
		assertEqual(renders, 2, "both invalidate() calls collapsed into exactly one re-render");
		assertEqual(container.querySelector("div").textContent, "2", "the re-render sees the LATEST state");
	});
});

describe("style handling (decision 10)", () => {
	afterEach(cleanup);

	it("camelCase and kebab-case style names both apply; empty string clears", () => {
		let styles = { backgroundColor: "red", "font-size": "12px" };
		const { container, update } = mountApp(() => v("div", { styles }, ["x"]));
		const div = container.querySelector("div");
		assertEqual(div.style.backgroundColor, "red", "camelCase style name applies");
		assertEqual(div.style.fontSize, "12px", "kebab-case style name applies");

		styles = { backgroundColor: "", "font-size": "" };
		update();
		assertEqual(div.style.backgroundColor, "", "camelCase '' clears the declaration");
		assertEqual(div.style.fontSize, "", "kebab-case '' clears the declaration");
	});
});
