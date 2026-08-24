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

### Namespaced topics

Topics nest on a configured separator (`createPubSub({ separator })`, default `":"`). Publishing
`a:b:c` notifies subscribers of `a:b:c`, then `a:b`, then `a` — most-specific first — so a
subscriber to `a` hears everything under it without knowing the full topic tree in advance. The
handler's second argument is the topic actually published, not the one subscribed to, since a
namespace subscriber otherwise has no way to tell descendants apart:

```ts
const ps = createPubSub();
ps.subscribe("chat", (payload, topic) => console.log(topic, payload)); // hears chat, chat:room-1, chat:room-1:typing, ...
ps.publish("chat:room-1:typing", { user: "ana" });
```

`seq` (visible through `getLast`, and through the exposed `store`) is a single counter shared
across every topic in an instance, not per-topic — ordering across topics is exactly what a
namespace subscriber needs, and a per-topic counter can't provide it. Replay for a namespace
subscriber, and `getLast` on one, both resolve to the single most recent entry anywhere at or
under that topic (by that shared `seq`), not one value per descendant — flooding a subscriber
with every child's last value on every subscribe would defeat the point of a quiet "start me off
with the current state" default. A throwing subscriber never stops delivery to the others; the
error is rethrown asynchronously instead of swallowed or left to break the topic for everyone
else.

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
