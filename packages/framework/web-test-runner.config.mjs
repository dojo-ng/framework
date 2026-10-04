import { playwrightLauncher } from "@web/test-runner-playwright";

// Real-browser smoke layer for the renderer (framework-browser-smoke-spec.md, closes
// the last piece of #127). The golden suite (test/vdom.test.mjs + factories.test.mjs)
// is the authoritative behavior spec, run against a mock DOM; this layer catches only
// the mock-vs-real-DOM gaps a mock cannot fake (real events, real focus, real rAF,
// real CSSStyleDeclaration, a real custom element). Same toolchain as the components
// QA harness (qa-harness-spec.md), so there is one browser-testing stack across
// Dojo NG. Tests import the built `../../dist/core/vdom.js` by relative path (the
// framework has zero runtime deps), so no nodeResolve plugin is needed.
// On CI only (GitLab sets CI=true): run one browser engine at a time and give each one 2 minutes
// to start a page instead of the default 30 seconds. The shared Heptapod runner often cannot
// start Firefox and WebKit pages in time when engines run side by side ("unable to create and
// start a test page after 30000ms"), which fails the job with no test failure underneath; see
// ground-rules.md. Local runs keep the defaults (2 engines at once, 30 seconds).
const onCI = Boolean(process.env.CI);

export default {
	files: ["test/browser/**/*.test.mjs"],
	browsers: [
		playwrightLauncher({ product: "chromium" }),
		playwrightLauncher({ product: "firefox" }),
		playwrightLauncher({ product: "webkit" }),
	],
	...(onCI ? { concurrentBrowsers: 1, browserStartTimeout: 120000 } : {}),
	testFramework: {
		config: { ui: "bdd", timeout: 5000 },
	},
};
