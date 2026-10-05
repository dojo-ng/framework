# @dojo-ng/websocket

A WebSocket client that reconnects, queues messages while offline, and matches each response to
its request. Events flow through a [`@dojo-ng/pubsub`](https://www.npmjs.com/package/@dojo-ng/pubsub)
bus in both directions.

Part of the [Dojo NG framework](https://foss.heptapod.net/dojo-ng/framework) packages: plain ESM
and no Lit. BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/websocket
```

## Usage

```js
import { createPubSub } from "@dojo-ng/pubsub";
import { WSDispatcher } from "@dojo-ng/websocket";

const bus = createPubSub();
const server = new WSDispatcher({
  url: "wss://example.com/ws",
  pubsub: bus,                   // share the app's bus; without this you get a private one
  onConnect: () => [{ action: "event", id: 0, data: { event: "hello", params: { user: 7 } } }],
});

server.open();

// Request and response. Sent now if the socket is open, otherwise queued.
const user = await server.call({ method: "getUser", args: [7] });

// Events from the server arrive on the bus under their own name.
bus.subscribe("chat:message", (msg) => console.log(msg), { replay: false });

// Publishing to the outbound topic sends an event to the server.
bus.publish("notify:event", { event: "chat:message", params: { text: "Hi" } });
```

## What WSDispatcher handles

- `onConnect` returns messages to send first on every connect and reconnect, before the queue.
  Use it to tell the server who the user is.
- Messages sent while the connection is down wait in a queue. A message leaves the queue only
  after it is sent, so a failed send does not lose it.
- After a lost connection, the client waits longer before each new try (Fibonacci backoff). A
  successful connect resets the delay. After `close()`, it does not reconnect.
- When the server sends `ping` messages, the client expects one at least every 40 seconds. If
  none arrives, it closes and reconnects through the same backoff. A server that never sends a
  ping turns this check off.
- `call()` has no timeout. If the server never answers, the promise never settles. Use
  `Promise.race` with a timer if you need a limit.
- Publishing to `outboundTopic` sends an event to the server. The default topic is
  `"notify:event"`.
- `simulate("disconnect")` and `simulate("connect")` let you test your reconnect handling without
  a real outage.

## The wire format

Every message is one JSON object with `action`, `id`, and `data`. A `call` response sends back the
same `id`, and its `data` becomes the value of the promise. An `event` carries the topic name and
the payload.

```json
{ "action": "call",  "id": 12, "data": { "method": "getUser", "args": [7] } }
{ "action": "event", "id": 0,  "data": { "event": "chat:message", "params": { "text": "Hi" } } }
{ "action": "ping",  "id": 0,  "data": null }
```

The full rules are in
[the JSON Schema](https://foss.heptapod.net/dojo-ng/framework/-/blob/branch/default/packages/websocket/schema/envelope.schema.json).
The object form was chosen after measuring: with compression, a typical session is only about
3% larger than with a positional array.

## WSocket, the thinner layer

Most apps want `WSDispatcher`. If you only want a thin wrapper, the package also exports `WSocket`.

- It smooths over differences between WebSocket implementations.
- `send()` returns a `SendState`: `OKAY`, `NOT_READY`, `BUFFERING`, or `SEND_ERROR`. It reports
  `BUFFERING` instead of sending while the browser still has unsent data.
- It removes its listeners before closing, so a reconnect does not stack old handlers.

```js
import { WSocket, SendState } from "@dojo-ng/websocket";

const ws = new WSocket("wss://example.com");
ws.addEventListener("open", () => console.log("open"));
ws.addEventListener("message", (e) => console.log(e.detail.data));
ws.open();

const state = ws.send("hello"); // SendState.OKAY, NOT_READY, BUFFERING, or SEND_ERROR
```

## Learn more

The [framework runtime guide](https://dojo-ng.com/docs/framework/) shows the client together with
[`@dojo-ng/framework`](https://www.npmjs.com/package/@dojo-ng/framework) and
[`@dojo-ng/pubsub`](https://www.npmjs.com/package/@dojo-ng/pubsub).

## Development

- `npm test` runs the unit tests with `node --test`, against a fake socket and fake timers. No
  test uses the network.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run playground` starts a local echo server and a demo page at
  `http://localhost:8901/packages/websocket/playground/index.html`. Its buttons show the offline
  queue, a real reconnect with backoff, and the heartbeat check.

## License

BSD-3-Clause. See [LICENSE](https://foss.heptapod.net/dojo-ng/framework/-/blob/branch/default/LICENSE).
