# @dojo-ng/framework changelog

## 0.3.5

### Patch Changes

- Rewrite the README for npm readers: what the package does, a working example, and short sections of bullets, with links that work on npmjs.com. The package.json description is now in plain language. No behavior changes.

## 0.3.4

### Patch Changes

- Removed the CI `release` job — it can never succeed. The package's npm
  security setting ("require 2FA, disallow bypass-2FA tokens") blocks every
  token, including bypass-2FA-capable ones, from publishing without a live
  OTP, so every CI publish attempt failed with EOTP by design, not by bug.
  OIDC Trusted Publishing (tried as an alternative) doesn't work either: npm
  doesn't support self-hosted GitLab instances yet, and Heptapod is one.

  Publishing is now local: whoever cuts a release runs `npm run release`
  themselves, authenticating with their own live 2FA. Added a `pack` CI job
  (`npm run build && npm pack --dry-run`) so CI still verifies the package is
  actually publishable — the one part of a release CI can still check.

## 0.3.3

### Patch Changes

- Reverted the release job from npm Trusted Publishing (OIDC) back to
  `NPM_TOKEN`. Confirmed npm's OIDC support doesn't cover self-hosted GitLab
  instances yet ("self-hosted runners are not currently supported" per npm's
  own docs) — Heptapod is self-hosted, not gitlab.com, so `npm publish` never
  even attempted the OIDC handshake regardless of how the Trusted Publisher was
  configured on npmjs.com. Revisit once npm extends support to self-hosted
  GitLab, or move to npm's staged-publish model ahead of the January 2027
  bypass-2FA-token direct-publish cutover.

## 0.3.2

### Patch Changes

- Fixed `npm ci` failing under npm 11 with `EUSAGE`, listing every rollup native
  platform variant as "missing from lock file". The lockfile only recorded the
  two platforms (`darwin-arm64`, `linux-x64-gnu`) we'd hand-pinned as an earlier
  workaround for npm 9's cross-platform optional-deps pruning bug — npm 11's
  `npm ci` validates against rollup's full declared optionalDependencies list
  (all ~24 platforms) and rejects a lockfile missing the rest, deterministically,
  every time. Removed the hand-picked `optionalDependencies` override and
  regenerated the lockfile with npm 11 from scratch: modern npm resolves and
  records all platform variants correctly on its own, so the workaround is both
  obsolete and actively harmful now. Verified `npm ci` clean 3/3 on a Linux
  container matching the CI runner.

## 0.3.1

### Patch Changes

- CI release job now publishes via npm Trusted Publishing (OIDC) instead of a long-lived
  bypass-2FA token. npm is restricting bypass-2FA tokens to staged-publish-only starting
  January 2027; OIDC has no token to expire or rotate and needs no account-security
  workaround. The `release` job requests a GitLab CI OIDC token audienced to
  `npm:registry.npmjs.org`, and npm's publish flow picks it up automatically.

## Unreleased

- **Real-browser smoke test layer** (closes the last piece of #127). The golden
  suite (`test/vdom.test.mjs` + `test/factories.test.mjs`) drives the renderer over
  a mock DOM and stays the authoritative behavior spec; a new `test/browser/`
  layer (`@web/test-runner` + Playwright, Chromium/Firefox/WebKit) runs it against
  a real `document` instead, catching mock-vs-real gaps a mock can't fake: real
  `click` events, focus surviving a keyed reorder, a real custom element's
  property-first upgrade semantics, real `CSSStyleDeclaration`, and real microtask
  batching. `npm run test:browser` runs it; `README.md` documents all three test
  layers and their commands.
- **Fix:** removing a node from the tree now also removes its event listener(s).
  `removeRNode` previously detached the DOM node (`removeChild`) but never called
  `removeEvent`, so a removed node kept a live `addEventListener` registration
  indefinitely (harmless once garbage collected, but a real bug: dispatching
  directly on the detached node reference still ran the old handler). Found by the
  browser smoke layer above, which a mock DOM's op-log had no way to catch.

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
