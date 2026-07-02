# @dojo-ng/framework changelog

## 0.3.0 — clean-room v()-only renderer + ESM cutover (#126)

**Breaking.** The renderer is a clean-room v()-only reconciler, authored in
TypeScript, and the package is now **ESM**.

- `core/vdom` is the new renderer (compiled from `src/core/vdom.ts`). It builds a
  live node tree, renders property-first for custom elements, supports virtual and
  `dom()` nodes, deferred properties, and the `onAttach`/`onUpdate`/`onDetach`
  lifecycle. Updates use the v()-only model: `invalidate()` re-runs the render
  function and diffs — non-keyed by position, keyed by an O(n) reuse-by-key pass
  with minimal (longest-increasing-subsequence) moves. A pure reorder/reverse
  never creates or removes nodes; keyed reorders are O(n) (the old widget renderer
  was O(n²) on that path).
- **ESM**: `package.json` is `type: "module"`; the renderer loads natively in the
  browser via import maps (no bundler). `exports` resolves `.` and `./core/vdom`
  to `core/vdom.js` + `core/vdom.d.ts` (generated from the TS source).
- **Removed**: the interim widget renderer and the `Registry`, `RegistryHandler`,
  and `core/middleware/icache` modules (dormant since 0.2.0) are gone. App-level
  state belongs in `@dojo-ng/store` + `@dojo-ng/context`.
- `has` and `diff` are also ESM now. `diff` is standalone (no `Registry`).
- **Size**: the renderer import closure (`vdom` + `has`) is 30.4 KB raw / 8.2 KB
  gzipped — down from 113.6 KB / 19.8 KB for the 0.2.0 trimmed-but-dormant
  renderer (−59% gzipped), and −76% gzipped vs the original `@dojo/framework`.
  `vdom.js` alone went from ~102 KB raw to 25 KB. No external deps; ESM.
- **Performance**: keyed reconciliation is O(n). Reversing 10,000 keyed rows runs
  in ~16 ms (the previous widget renderer was O(n²) on that path — ~1.3 s at 5k,
  and could not finish 10k). See `trim-measurement.md`.

## 0.2.0 — v()-only renderer API (#125)

**Breaking.** The renderer now presents a v()-only public API.

- Removed from the public API: `w`, `isWNode`, and the registry-item JSX helpers
  (`REGISTRY_ITEM`, `FromRegistry`, `fromRegistry`). Render DOM and custom
  elements with `v()` / `tsx` using string tags (e.g. `v("dj-button", …)` or
  `<dj-button>`). Widget (`w()`) elements are no longer supported.
- The `tsx` JSX factory is v()-only: string tags route to `v()`, and a non-string
  tag throws a clear error under `dojo-debug` (no per-element check in production).
- Added `core/vdom.d.ts`: public type declarations for the v()-only surface plus
  the `tsx.JSX` namespace base. Per-element `dj-` typings are provided by
  `@dojo-ng/components/types/dojo`, which augments this base.

Not changed: the widget rendering machinery and `Registry`/`RegistryHandler`
modules remain present but dormant (no bundle or performance change). Their
physical removal — and the resulting size/perf win — is tracked as #126, gated on
the renderer test suite + benchmarks (#127).

## 0.2.0 — v()-only renderer API (#125)

**Breaking.** The renderer now presents a v()-only public API.

- Removed from the public API: `w`, `isWNode`, and the registry-item JSX helpers
  (`REGISTRY_ITEM`, `FromRegistry`, `fromRegistry`). Render DOM and custom
  elements with `v()` / `tsx` using string tags (e.g. `v("dj-button", …)` or
  `<dj-button>`). Widget (`w()`) elements are no longer supported.
- The `tsx` JSX factory is v()-only: string tags route to `v()`, and a non-string
  tag throws a clear error under `dojo-debug` (no per-element check in production).
- Added `core/vdom.d.ts`: public type declarations for the v()-only surface plus
  the `tsx.JSX` namespace base. Per-element `dj-` typings are provided by
  `@dojo-ng/components/types/dojo`, which augments this base.

Not changed: the widget rendering machinery and `Registry`/`RegistryHandler`
modules remain present but dormant (no bundle or performance change). Their
physical removal — and the resulting size/perf win — is tracked as #126, gated on
the renderer test suite + benchmarks (#127).
