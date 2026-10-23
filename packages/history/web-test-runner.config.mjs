import { playwrightLauncher } from "@web/test-runner-playwright";

// Real-browser check for @dojo-ng/history: the fake window in test/ stands in for History, and this
// is the one place the real History API is checked against H1's regression (a Back must not push).
// Tests import the built ../../dist/index.js; its bare import of @dojo-ng/pubsub is resolved by the
// dev server (nodeResolve), through the workspace link in the root node_modules.
// CI settings match packages/framework/web-test-runner.config.mjs; see ground-rules.md.
const onCI = Boolean(process.env.CI);

export default {
	files: ["test/browser/**/*.test.mjs"],
	nodeResolve: true,
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
