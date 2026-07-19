import { playwrightLauncher } from "@web/test-runner-playwright";

// Real-browser smoke layer for the renderer (framework-browser-smoke-spec.md, closes
// the last piece of #127). The golden suite (test/vdom.test.mjs + factories.test.mjs)
// is the authoritative behavior spec, run against a mock DOM; this layer catches only
// the mock-vs-real-DOM gaps a mock cannot fake (real events, real focus, real rAF,
// real CSSStyleDeclaration, a real custom element). Same toolchain as the components
// QA harness (qa-harness-spec.md), so there is one browser-testing stack across
// Dojo NG. Tests import the built `../../dist/core/vdom.js` by relative path (the
// framework has zero runtime deps), so no nodeResolve plugin is needed.
export default {
	files: ["test/browser/**/*.test.mjs"],
	browsers: [
		playwrightLauncher({ product: "chromium" }),
		playwrightLauncher({ product: "firefox" }),
		playwrightLauncher({ product: "webkit" }),
	],
	testFramework: {
		config: { ui: "bdd", timeout: 5000 },
	},
};
