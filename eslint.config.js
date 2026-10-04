// Flat ESLint config for the Dojo NG framework (the renderer). Same shape as the components
// config, minus the Lit / web-component plugins (this package has no custom elements).
//
// Correctness only: no formatting rules and no Prettier. Tabs and the existing house style stay;
// `tsc --noEmit` (npm run typecheck) already owns type errors, so the type-checked
// typescript-eslint variants are deliberately NOT used.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Intentionally-unused bindings are prefixed with `_` (override/callback params, ignored catch
// bindings). Honor that convention instead of forcing dead-looking signature edits.
const unusedVarsOptions = {
	argsIgnorePattern: "^_",
	varsIgnorePattern: "^_",
	caughtErrorsIgnorePattern: "^_",
};

export default tseslint.config(
	{
		ignores: ["packages/*/dist/", "node_modules/"],
	},
	js.configs.recommended,
	{
		// TypeScript source, every package.
		files: ["packages/*/src/**/*.ts"],
		extends: [tseslint.configs.recommended],
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],
		},
	},
	{
		// The v()-only renderer coerces heterogeneous VNode/DOM shapes (child nodes, prop values,
		// DOM node handles) where `any` is the pragmatic, intentional type. `tsc --noEmit` (strict)
		// already owns type safety, and every other package stays fully typed — so ban `any`
		// everywhere except this low-level renderer core. (52 uses, all in the reconciler.) Scoped to
		// packages/framework/src/** specifically since websocket landed — do not widen this back to packages/*/src/**.
		files: ["packages/framework/src/**/*.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		// Node test/smoke scripts: run under `node --test` / `node`, not type-checked here, so
		// no-undef would false-positive on Node globals — turn it off (mirrors the components config).
		files: ["packages/*/test/**/*.mjs", "packages/*/smoke/**/*.mjs"],
		rules: {
			"no-undef": "off",
			"no-unused-vars": ["error", unusedVarsOptions],
		},
	},
);
