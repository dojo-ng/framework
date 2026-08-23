# Renderer trim measurement (#116)

Comparison of the trimmed `@dojo-ng/framework` renderer against the full
`@dojo/framework` 8, measured 2026-06-24.

## Method

No bundler/minifier is installable in the build sandbox, so size is measured as
the **transitive `require()` closure** from the renderer entry `core/vdom.js`:
the set of files a bundler would pull in, summed raw and gzipped (level 9) over
the concatenated source. This is a proxy for a real bundle — a minifier would
shrink both sides — but the *relative* reduction is the meaningful figure.
Bare-specifier (external) requires a bundler would also include are counted
separately.

## Result

| Metric | Full `@dojo/framework` | Trimmed `@dojo-ng/framework` | Reduction |
|---|---|---|---|
| Files in renderer closure | 19 | 5 | −14 (−74%) |
| Raw source | 204.5 KB | 113.6 KB | −90.9 KB (−44%) |
| Gzipped | 33.7 KB | 19.8 KB | −13.9 KB (−41%) |
| External runtime deps | `tslib` | none | `tslib` eliminated |

Adding the `icache` middleware to the closure: 6 files, 116.7 KB raw, **20.4 KB
gzipped** (icache itself is ~0.6 KB gzipped).

## What the trim removes

The full renderer closure drags in 14 files that the trimmed one does not:

- The entire `shim/*` polyfill system: `Promise`, `string`, `array`, `Symbol`,
  `WeakMap`, `Map`, `Set`, `iterator`, `object`, `global`, plus
  `shim/support/{queue,util}`. Replaced by native ES2020+.
- `core/Evented` and `core/Destroyable` (pulled in via the shim/registry chain).
- A much larger `core/has` (16.2 KB) — the trimmed faithful port is 6.4 KB,
  having dropped the IE11 static-feature build machinery, the AMD `has!` loader
  plugin, and the legacy ES-detection tests (constants on the evergreen baseline).
- `tslib`: the trimmed build inlines the TypeScript helpers, so `core/vdom.js` is
  marginally larger (102.6 KB vs 99.2 KB) but the external `tslib` dependency is
  gone.

## On Registry

`core/vdom.js` instantiates and uses `Registry` internally (`new Registry`,
`registry.get/has/define` for the `w()`/registry-item resolution path), so
`Registry` + `RegistryHandler` stay in the renderer keep-set — they are not just
imports. App-level Registry usage (e.g. registering Dojo 8 widgets in app3) is
separate and droppable for a web-components-first app, but that does not remove
the renderer's own dependency. Dropping `Registry` entirely would require
patching `vdom` to remove the `w()`/registry resolution path — a deeper,
separate change, not part of this keep-set trim.

## Caveats

- Closure source size gzipped, not a minified bundle (no minifier available);
  treat the ~41% gzipped reduction as the headline.
- Tree-shaking in a real bundler could narrow the gap slightly, mostly on the
  full side's shim modules.

---

# Update — clean-room v()-only renderer (#126, measured 2026-06-26)

#116 trimmed the *interim* renderer but kept the widget machinery (`Registry`,
`RegistryHandler`, the `w()`/registry resolution path in `vdom`) dormant. #126
replaced that renderer with a clean-room **v()-only** reconciler authored in
TypeScript and removed the widget machinery entirely. Same method as above
(gzip -9 over the renderer's import closure; no minifier).

The renderer's import closure is now just two files — `core/vdom.js` imports only
`core/has.js`. `diff` and `icache` are no longer in the renderer closure (`diff`
is a standalone utility; `icache` was deleted), and `Registry`/`RegistryHandler`
are gone.

| Metric | Full `@dojo/framework` | #116 trimmed (interim) | #126 clean-room v()-only | vs #116 |
|---|---|---|---|---|
| Files in renderer closure | 19 | 5 | **2** (`vdom` + `has`) | −3 |
| Raw source | 204.5 KB | 113.6 KB | **30.4 KB** | −83.2 KB (−73%) |
| Gzipped | 33.7 KB | 19.8 KB | **8.2 KB** | −11.6 KB (−59%) |
| External runtime deps | `tslib` | none | none | — |

`core/vdom.js` alone: **25.1 KB raw / 6.6 KB gzipped**, down from the interim
`vdom.js` at 102.6 KB raw / ~20 KB gzipped — roughly a **quarter** of the size
raw, **a third** gzipped. The "#126 roughly halves vdom.js" hypothesis was
conservative: removing the WNode/registry machinery (≈109 `widgetMeta`, 58
`WNode`/`isWNode`, 37 `registry`, the interleaved `isWNodeWrapper` branches) plus
`Registry`/`RegistryHandler` cut more than half.

Net vs the original full `@dojo/framework` renderer: **−85% raw, −76% gzipped**,
zero external deps, ESM (tree-shakeable, so a real bundle is smaller still).

## Performance (mock DOM, Node v22.x, median of 7)

The clean-room keyed diff is O(n); the interim widget renderer's keyed-reverse
was algorithmically O(n²) (measured on the same O(1) mock, so this is the
renderer, not the rig). Baseline figures are the #127 interim measurements.

| rows | mount | update-all | keyed-reverse (new) | keyed-reverse (interim #127) |
|---|---|---|---|---|
| 1,000 | 2.2 ms | 0.9 ms | **1.1 ms** | 56 ms |
| 2,000 | 3.7 ms | 4.6 ms | **4.8 ms** | 209 ms |
| 5,000 | 19.9 ms | 7.6 ms | **6.9 ms** | 1,305 ms (~189×) |
| 10,000 | 41.5 ms | 15.7 ms | **16.0 ms** | did not finish (≈O(n²)) |

Keyed reorder/reverse is now linear and runs 10k rows in ~16 ms — the case the
interim renderer could not complete. This confirms the perf hypothesis (Bill's
"gut" call) with data: the win came from the reconciler, not micro-tuning.
