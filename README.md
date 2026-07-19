# @dojo-ng/framework

Clean-room v()-only VDOM renderer — ESM, property-first for custom elements, O(n)
keyed reconciliation. See `CHANGELOG.md` for the design writeup and size/perf numbers.

## Testing

Three layers, in increasing cost:

| Command | What it runs |
|---|---|
| `npm run smoke` | Zero-dependency `has()`/`tsx()` sanity checks (`smoke/has.mjs`, `smoke/tsx.mjs`) |
| `npm run test:golden` | Goldens — the renderer's behavior spec, driven over a mock DOM (`test/vdom.test.mjs`, `test/factories.test.mjs`) |
| `npm run test:browser` | Real-browser smoke — the mock-vs-real-DOM gaps a mock can't fake (real events, real focus, real rAF, real `CSSStyleDeclaration`, a real custom element), on Chromium, Firefox, and WebKit (`test/browser/*.test.mjs`) |

`npm test` runs build + smoke + goldens (not the browser layer, which needs
Playwright's browsers: `npm install && npx playwright install`, once).

`npm run bench` is the performance gate — after any renderer change, confirm
keyed-reverse stays ~O(n) (10k rows in tens of ms, not seconds).

The goldens are the authoritative spec: if a browser-layer test exposes a real
renderer bug, the fix lands with a new golden, not just a browser assertion.

## License

BSD-3-Clause
