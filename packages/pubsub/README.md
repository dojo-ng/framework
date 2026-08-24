# @dojo-ng/pubsub

Dojo NG publish/subscribe facade backed by an external store.

Part of the [Dojo NG framework](../../README.md) monorepo (the non-Lit runtime that complements
`components`). BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/pubsub
```

## Usage

`createPubSub()` returns a `publish`/`subscribe` facade: it retains the last payload per topic and
replays it to late subscribers by default, and every `publish` notifies current subscribers even
when the payload is unchanged. The state backing it is exposed as a `store` property
(`ReadableStore<T>` — `getState()`/`subscribe()`), so the same data is also readable through
`components`' `StoreController` and context registry with no adapter: `ReadableStore` is a
structural shape, not a class, and `components/packages/store/src/types.ts` defines the same shape
independently — there is no dependency edge across the repo boundary in either direction.

See `components/docs/state-and-framework-analysis.md` for the full store/pub-sub/context design
writeup; its pub/sub section notes that this package now lives here.
