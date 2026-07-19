// Small shared helpers for the framework's real-browser smoke suite. No external
// assertion library — throwing is all @web/test-runner's mocha needs, which keeps
// this layer's dependency surface to WTR + Playwright, same as the components suite
// (tests/browser/helpers.js there is the model for this file).
import { renderer } from "../../dist/core/vdom.js";

/** Create a fresh container appended to the document body. */
export function makeContainer() {
	const el = document.createElement("div");
	document.body.append(el);
	return el;
}

/** Remove everything appended to the body during a test. Call in afterEach. */
export function cleanup() {
	document.body.innerHTML = "";
}

/**
 * Mount `renderFn` into a fresh container WITHOUT passing `nodeApi`, so
 * `mount()` falls back to `createDomApi(document)` (decision 1 — this is the
 * default path every test in this suite exercises, not a special case).
 * Defaults to `sync: true` so `update()` is synchronous unless a test asks
 * for batched (microtask) mode to exercise that directly.
 */
export function mountApp(renderFn, { sync = true } = {}) {
	const container = makeContainer();
	const r = renderer(renderFn);
	r.mount({ domNode: container, sync });
	return {
		r,
		container,
		update: () => r.invalidate(),
	};
}

export function assert(condition, message) {
	if (!condition) throw new Error(message || "assertion failed");
}

export function assertEqual(actual, expected, message) {
	if (actual !== expected) {
		throw new Error(`${message ? message + ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

/** Resolve after one real animation frame. */
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Resolve after a microtask turn (enough for a batched invalidate() to flush). */
export const nextMicrotask = () => Promise.resolve();
