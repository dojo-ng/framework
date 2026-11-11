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
  successful connect resets the delay. Each delay is stretched by a random amount, up to 25%
  longer and never shorter, so tabs dropped by one server restart don't all come back in the
  same second. `reconnectJitter` sets that fraction; 0 turns it off.
- After `close()`, it does not reconnect until you call `open()` again. That holds even when
  `close()` lands while a reconnect is waiting or the heartbeat check is counting down.
- `dispose()` ends the client for good: it closes, rejects every pending `call()`, drops the
  queue, and stops listening to the bus. `open()` does nothing afterwards.
- `reconnectBase` (seconds, default 15) is added to every reconnect delay. Lower it when the
  server is on the same machine, where a disconnect is usually a quick restart. Keep it high for
  a public site, so a server restart is not met by every tab at once.
- `url` can be a function (sync or async) instead of a string. It is called before every open,
  the first connect and each reconnect, and what it returns is the URL for that attempt only.
  Use it when the URL carries a single-use credential, such as a ticket in the query string
  (a browser cannot set a header on a WebSocket). If the function throws or rejects, that counts
  as a failed attempt and is retried through the backoff. To stop for good, call `close()` and
  then throw. A string `url` works exactly as before.

```js
const server = new WSDispatcher({
  reconnectBase: 2,
  url: async () => {
    const res = await fetch("/api/ws-ticket", { method: "POST" });
    if (res.status === 401) {
      server.close(); // the credential was refused; do not retry
      throw new Error("not authorized");
    }
    const { ticket } = await res.json();
    return `wss://example.com/ws?ticket=${ticket}`;
  },
});
```
- When the server sends `ping` messages, the client expects one at least every 40 seconds. If
  none arrives, it closes and reconnects through the same backoff. A server that never sends a
  ping turns this check off.
- `call()` rejects with a `WSCallError` when it can no longer get an answer. Its `reason` is
  `"timeout"`, `"aborted"`, `"closed"` (the connection dropped after the request went out), or
  `"disposed"`. A request still waiting in the queue survives a dropped connection and goes out on
  the next connect. Set a limit for every call with `callTimeout` (milliseconds), or per call with
  `call(data, { timeout, signal })`. Without one, a call on a connection that stays up but never
  answers still waits forever.

```js
import { WSCallError } from "@dojo-ng/websocket";

try {
  const user = await server.call({ method: "getUser", args: [7] }, { timeout: 5000 });
} catch (err) {
  if (err instanceof WSCallError && err.reason === "timeout") showRetry();
}
```
- Publishing to `outboundTopic` sends an event to the server. The default topic is
  `"notify:event"`. An event from the server that lands on that topic still reaches your
  subscribers, but it is not sent back to the server.
- A message from the server that is not JSON, or not in the format below, is ignored.
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
