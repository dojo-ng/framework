/**
 * Golden-suite harness for the renderer (core/vdom.js), driving it over the mock
 * DOM. The renderer's v()-only update model — `invalidate()` re-runs the render
 * function and diffs — means updates are driven by mutating closed-over state and
 * calling `app.update()` (no widget/create indirection).
 *
 * Exposes html / ops / trace / counts / fireEvent / update / unmount so the
 * behavior and op-sequence goldens can assert on both the resulting DOM and the
 * exact sequence of DOM mutations.
 */
import { createMockDom } from "./mock-dom.mjs";
import { renderer, v, dom as domVNode, isVNode } from "../dist/core/vdom.js";

export { renderer, v, domVNode, isVNode };

/** Mount `buildTree` into a provided mock DOM via the renderer. */
export function mountWith(dom, buildTree) {
	const r = renderer(() => buildTree());
	r.mount({ domNode: dom.root, nodeApi: dom.nodeApi, sync: true });
	dom.flushRaf();

	return {
		dom,
		html: () => dom.childrenOf(dom.root).map((c) => dom.serialize(c)).join(""),
		update: () => { r.invalidate(); r.flush(); dom.flushRaf(); },
		unmount: () => { r.unmount(); dom.flushRaf(); },
		ops: () => dom.opLog.slice(),
		clearOps: () => dom.clearOps(),
		structuralOps: () => dom.opLog.filter((o) => ["insertBefore", "removeChild", "replaceChild"].includes(o[0])),
		trace: () =>
			dom.opLog
				.filter((o) => ["insertBefore", "removeChild", "replaceChild"].includes(o[0]))
				.map((o) =>
					o[0] === "insertBefore"
						? `insertBefore ${o[1]}: ${o[2]} before ${o[3] ?? "(end)"}`
						: o[0] === "removeChild"
						? `removeChild ${o[1]}: ${o[2]}`
						: `replaceChild ${o[1]}: ${o[3]} -> ${o[2]}`
				),
		counts: () => dom.opLog.reduce((acc, o) => ((acc[o[0]] = (acc[o[0]] || 0) + 1), acc), {}),
		fireEvent: (node, type, ev) => dom.fireEvent(node, type, ev),
		childrenOf: (n) => dom.childrenOf(n),
		root: dom.root
	};
}

/** Mount into a fresh mock DOM. */
export function mountApp(buildTree, { defineProps } = {}) {
	const dom = createMockDom();
	if (defineProps) for (const [tag, props] of Object.entries(defineProps)) dom.defineProps(tag, props);
	return mountWith(dom, buildTree);
}

export { createMockDom };
