/**
 * Feature detection for @dojo-ng/framework.
 *
 * TypeScript source, ported from @dojo/framework 8 `core/has` and trimmed for the
 * evergreen baseline (ES2020+, modern DOM):
 *   - DROPPED the upstream `global.DojoHasEnvironment` static-feature build-elision
 *     machinery and the AMD `has!` loader plugin (normalize/load).
 *   - ES2015–ES2018 LANGUAGE features are registered as constant `true` (guaranteed
 *     by the baseline) instead of the old IE11/old-Safari detection tests.
 *   - Environment-variable DOM/host features stay LIVE so they report correctly in a
 *     browser, jsdom, or node.
 *
 * Public API (has / add / exists, lazy test functions, result caching,
 * feature-name lowercasing, strict mode) matches `@dojo/framework/core/has`, so app
 * code keeps working unchanged. An unregistered feature returns `undefined`; strict
 * mode throws.
 */

export type FeatureTestResult = boolean | string | number | undefined | void;
export type FeatureTest = () => FeatureTestResult;

/* Untyped view of the global object: the feature tests below probe a mix of
 * standard and non-standard globals, so a single `any` view avoids per-feature
 * lib wrangling. */
const glob: any =
	typeof globalThis !== "undefined"
		? globalThis
		: typeof self !== "undefined"
		? self
		: typeof window !== "undefined"
		? window
		: {};

export const testCache: { [feature: string]: FeatureTestResult } = {};
export const testFunctions: { [feature: string]: FeatureTest } = {};

/** Whether a feature has been registered. */
export function exists(feature: string): boolean {
	const f = String(feature).toLowerCase();
	return Boolean(f in testCache || testFunctions[f]);
}

/** Register a feature value, or a function evaluated once on first access. */
export function add(feature: string, value: FeatureTest | FeatureTestResult, overwrite = false): void {
	const f = String(feature).toLowerCase();
	if (exists(f) && !overwrite) {
		throw new TypeError(`Feature "${feature}" exists and overwrite not true.`);
	}
	if (typeof value === "function") {
		testFunctions[f] = value as FeatureTest;
	} else {
		testCache[f] = value;
		delete testFunctions[f];
	}
}

/** Return the current value of a named feature (lazy: a test runs once, cached). */
function has(feature: string, strict = false): FeatureTestResult {
	const f = String(feature).toLowerCase();
	let result: FeatureTestResult;
	if (testFunctions[f]) {
		result = testCache[f] = testFunctions[f].call(null);
		delete testFunctions[f];
	} else if (f in testCache) {
		result = testCache[f];
	} else if (strict) {
		throw new TypeError(`Attempt to detect unregistered has feature "${feature}"`);
	}
	return result;
}

/* Some call sites use `has.add(...)` / `has.exists(...)` as well as the named
 * exports; support both. */
has.add = add;
has.exists = exists;

export { has };
export default has;

// ---------------------------------------------------------------------------
// Built-in features
// ---------------------------------------------------------------------------

// Build / debug flags (constants, as upstream).
add("public-path", undefined);
add("dojo-debug", false);
add("build-elide", false);
add("test", false);

// Host / environment — live.
add("host-browser", typeof document !== "undefined" && typeof location !== "undefined");
add(
	"host-jsdom",
	has("host-browser") && typeof navigator !== "undefined" && navigator.userAgent.indexOf("jsdom") !== -1
);
add("host-node", () => {
	const proc = glob.process;
	if (typeof proc === "object" && proc.versions && proc.versions.node) {
		return proc.versions.node;
	}
});
add("global-this", () => typeof glob.globalThis !== "undefined");

// ES2015–ES2018 language features: guaranteed by the evergreen baseline.
[
	"es6-array", "es6-array-fill", "es7-array", "es2019-array",
	"es6-map", "es6-iterator", "es6-set", "es6-weakmap",
	"es6-math", "es6-math-imul",
	"es6-object", "es2017-object",
	"es6-promise", "es2018-promise-finally",
	"es6-string", "es6-string-raw", "es2017-string",
	"es6-symbol"
].forEach((feature) => {
	add(feature, true, true);
});

// Non-standard / proposal globals — live (false on the baseline unless present).
add("es-observable", () => typeof glob.Observable !== "undefined");

// Async / scheduling — live.
add("fetch", "fetch" in glob && typeof glob.fetch === "function", true);
add("raf", () => typeof glob.requestAnimationFrame === "function", true);
add("setimmediate", () => typeof glob.setImmediate !== "undefined", true);
add("postmessage", () => typeof glob.window !== "undefined" && typeof glob.postMessage === "function", true);
add("microtasks", () => has("es6-promise") || has("host-node") || has("dom-mutationobserver"), true);
add("abort-controller", () => typeof glob.AbortController !== "undefined");
add("abort-signal", () => typeof glob.AbortSignal !== "undefined");

// DOM features — live.
add("dom-mutationobserver", () => has("host-browser") && Boolean(glob.MutationObserver), true);
add(
	"dom-webanimation",
	() => has("host-browser") && glob.Animation !== undefined && glob.KeyframeEffect !== undefined,
	true
);
add("dom-intersection-observer", () => has("host-browser") && glob.IntersectionObserver !== undefined, true);
add("dom-resize-observer", () => has("host-browser") && glob.ResizeObserver !== undefined, true);
add("dom-pointer-events", () => has("host-browser") && glob.onpointerdown !== undefined, true);
add(
	"dom-css-variables",
	() =>
		has("host-browser") &&
		!has("host-jsdom") &&
		glob.window.CSS &&
		glob.window.CSS.supports &&
		glob.window.CSS.supports("(--a: 0)"),
	true
);
add("dom-inert", () => has("host-browser") && Element.prototype.hasOwnProperty("inert"), true);
add(
	"dom-passive-event",
	() => {
		let supportsPassive = false;
		if (has("host-browser")) {
			try {
				const opts = Object.defineProperty({}, "passive", {
					get() {
						supportsPassive = true;
					}
				});
				const noop = () => {};
				window.addEventListener("testPassive", noop, opts);
				window.removeEventListener("testPassive", noop, opts as any);
			} catch (e) {}
		}
		return supportsPassive;
	},
	true
);
