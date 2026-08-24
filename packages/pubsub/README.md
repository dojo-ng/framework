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

### Async-iterable subscriptions

`pubsub.subscribeAsync(topic, options?)` is an async-iterable view of `subscribe`: `for await`
receives every value published to `topic` — including namespace descendants, the same match rule as
`subscribe` — in the order they were published. It subscribes immediately when called, not deferred
to the first loop iteration, so nothing published between calling it and starting the loop is missed.
It never replays; a late subscriber only sees future publishes, matching `for await`'s "start
listening now" expectation rather than a cache read.

Ending the iteration also tears down the subscription — via an explicit `AbortSignal` passed as
`options.signal`, or automatically when a `for await` loop exits through `break`, `return`, or a
thrown error (the standard `AsyncIterator.return()` protocol). Either way, nothing is left listening
after the loop stops.

**A slow consumer — one that hasn't called `.next()` yet when new values arrive — buffers up to
`options.bufferSize` values (default 256, `DEFAULT_BUFFER_SIZE`) before the oldest are dropped to
make room for new ones.** This bound exists on purpose: an unbounded buffer here is exactly the
"grew unbounded" bug a real event-driven consumer hit before this had a fixed window (see
`websocket-spec.md` T9's Perry caveat). Pick a larger `bufferSize` for a topic where losing an old
event matters more than memory; the default is a reasonable middle ground for UI-facing streams,
not a value to treat as load-bearing for every use.

```ts
const controller = new AbortController();
for await (const payload of pubsub.subscribeAsync("chat:message", { signal: controller.signal })) {
	render(payload);
}
// elsewhere: controller.abort() ends the loop and unsubscribes.
```
