# @dojo-ng/pubsub

Publish and subscribe with namespaced topics. The bus keeps the last value of each topic, so a
late subscriber starts with the current state.

Part of the [Dojo NG framework](https://foss.heptapod.net/dojo-ng/framework) packages: plain ESM,
no Lit, and no runtime dependencies. BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/pubsub
```

## Usage

```js
import { createPubSub } from "@dojo-ng/pubsub";

const bus = createPubSub();

bus.publish("cart:count", 3);

// Late subscribers get the last value at once (replay is on by default).
bus.subscribe("cart:count", (count) => console.log("count", count));      // count 3

// A namespace subscriber hears every topic under it, with the real topic.
bus.subscribe("cart", (payload, topic) => console.log(topic, payload), { replay: false });

bus.publish("cart:total", 42);   // logs "cart:total 42"
bus.getLast("cart");             // 42, the newest value at or under "cart"
```

## Subscribing

- `subscribe(topic, handler, options)` returns a function that removes the subscription.
- The handler receives the payload and the topic that was published.
- Replay is on by default: a new subscriber receives the topic's last value at once. Pass
  `{ replay: false }` when you only want new messages.
- Every `publish` calls the handlers, even when the value is the same as before.
- A handler that throws does not stop delivery to the others. The error is thrown again
  asynchronously, so it still reaches the console.

## Namespaced topics

- Topics nest on `:`. A publish to `chat:room-1:typing` reaches subscribers of
  `chat:room-1:typing`, then `chat:room-1`, then `chat`, most specific first.
- Pass `{ separator: "/" }` to `createPubSub` to use a different separator.
- For a namespace topic, replay and `getLast` return the single newest value at or under that
  topic, not one value for each child topic.
- Each message gets a sequence number (`seq`). One counter is shared by all topics in a bus, so
  messages can be ordered across topics.

## Async iteration

`subscribeAsync(topic, options)` gives the same messages as an async iterable for `for await`.

```js
const stop = new AbortController();

for await (const total of bus.subscribeAsync("cart:total", { signal: stop.signal })) {
  console.log("total is now", total);
  if (total > 100) break;        // break also ends the subscription
}
```

- It starts listening when you call it, not when the loop starts, so no message in between is lost.
- It does not replay the last value.
- The subscription ends when the loop exits by `break`, `return`, or an error, or when the
  `signal` aborts.
- If the loop is slower than the messages, up to 256 messages wait (`DEFAULT_BUFFER_SIZE`). After
  that, the oldest are dropped. Set `bufferSize` higher for a topic where losing an old message
  matters more than memory.

## Using the bus as a store

`bus.store` is a `ReadableStore`: an object with `getState()` and `subscribe()`. It works with
`StoreController` and the context keys from the Dojo NG components
([`@dojo-ng/store`](https://www.npmjs.com/package/@dojo-ng/store) and
[`@dojo-ng/context`](https://www.npmjs.com/package/@dojo-ng/context)) with no adapter. The two
packages share only this shape, not code, so neither depends on the other.

## Learn more

The [framework runtime guide](https://dojo-ng.com/docs/framework/) shows the bus together with
[`@dojo-ng/framework`](https://www.npmjs.com/package/@dojo-ng/framework) and
[`@dojo-ng/websocket`](https://www.npmjs.com/package/@dojo-ng/websocket).

## License

BSD-3-Clause. See [LICENSE](https://foss.heptapod.net/dojo-ng/framework/-/blob/branch/default/LICENSE).
