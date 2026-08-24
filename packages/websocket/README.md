# @dojo-ng/websocket

A framework-agnostic WebSocket client: a raw-socket wrapper (`WSocket`) and a convenience
dispatcher on top of it (`WSDispatcher`) with request/response correlation, an offline send
queue, reconnect with backoff, and a heartbeat watchdog. Ported from app3's `core/socket`,
de-Holmesed — see `websocket-spec.md` in the project root for the full task-by-task history and
the reasoning behind every non-obvious decision below.

Part of the [Dojo NG framework](../../README.md) monorepo (the non-Lit runtime that complements
`components`). BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/websocket
```

## `WSocket`

Canonicalizes differences across `WebSocket` implementations: out-of-sync detection (a live
re-check of `socket.readyState` on every send, since the browser's own state can move before its
event fires), backpressure (`bufferedAmount > 0` returns `BUFFERING` instead of sending),
listener teardown before close (the reconnect-storm fix), and `open(force)` semantics.

```ts
import { WSocket, SendState } from "@dojo-ng/websocket";

const ws = new WSocket("wss://example.test");
ws.addEventListener("open", () => console.log("open"));
ws.addEventListener("message", (e) => console.log(e.detail.data));
ws.open();

const state = ws.send("hello"); // SendState.OKAY | NOT_READY | BUFFERING | SEND_ERROR
```

Most apps want `WSDispatcher`, below, rather than `WSocket` directly — it's the layer that
carries the actual value (queueing, correlation, reconnect, heartbeat). `WSocket` is exported
because it's a complete, independently useful primitive on its own, not because most callers need
to reach for it.

## `WSDispatcher`

```ts
import { WSDispatcher } from "@dojo-ng/websocket";

const dispatcher = new WSDispatcher({
	url: "wss://example.test/ws",
	// Sent on every (re)connect, before the offline queue flushes. The app owns what identity
	// means here — this package has no opinion beyond "send these frames first."
	onConnect: () => [{ action: "event", id: 0, data: { event: "identify", params: { sessionId } } }],
});

dispatcher.open();

// A correlated request/response, queued if the socket isn't open yet and flushed on connect.
const result = await dispatcher.call({ method: "getUser", args: [42] });

// Events flow through pub/sub in both directions — dispatcher.pubsub is a @dojo-ng/pubsub
// instance (the caller's own, if one was passed via options.pubsub, otherwise a private one).
// Inbound "event" frames publish under their own name; publishing to options.outboundTopic
// (default "notify:event") sends one outbound. No new subscription concept invented.
dispatcher.pubsub.subscribe("chat:message", (payload) => render(payload));
dispatcher.pubsub.publish("notify:event", { event: "chat:message", params: { text: "hi" } });
```

What it carries, and why each exists, is documented at length in the header comment of
`src/wsdispatcher.ts` — request/response correlation via `Promise.withResolvers()`, an offline
send queue that peeks and dequeues only on a confirmed send, Fibonacci-backoff reconnect (reset
only on a successful open, suppressed entirely by an explicit `close()`), and a heartbeat
watchdog that closes and reopens — through the same backoff path, not a bypass — if the server
goes quiet for 40s. `dispatcher.simulate("disconnect" | "connect")` is a deliberate testing
affordance; the playground (below) uses it.

## The wire format

`schema/envelope.schema.json` (JSON Schema draft-07) specifies the `{action, id, data}` frame
`WSDispatcher` sends and receives, independently of the TypeScript `Envelope` type that binds it
— the schema is the source of truth, the type is one binding of it. Chosen over app3's original
positional-array form by measurement, not argument: compressed (raw DEFLATE, context carried
across a session — the realistic case), the object form is only 3.4% larger than positional over
a representative session. See `websocket-spec.md` T5's dated note for the full byte counts and
methodology.

## Playground

A live connection against a local echo server, demonstrating queued sends while disconnected, a
real reconnect with Fibonacci backoff, and the heartbeat watchdog — each one driven by a control
a real client can't perform on itself (the server dropping the connection with no handshake;
the server going silent without closing the socket), because `simulate("disconnect")` alone
proves the opposite case: an explicit close schedules no reconnect at all.

```bash
npm run playground
# → http://localhost:8901/packages/websocket/playground/index.html
```

See the comment at the top of `playground/index.html` for exactly what each button demonstrates.

## Testing

| Command | What it runs |
|---|---|
| `npm test` | `node --test` over `test/*.test.mjs` — `Queue`, `WSocket`, `WSDispatcher`, and the envelope schema, against fake sockets and (for the reconnect/heartbeat cases) `node:test`'s built-in fake timers |
| `npm run typecheck` | `tsc --noEmit` |

No real network in any test — `test/helpers/fake-websocket.mjs` is a synchronous fake shared
across the `WSocket` and `WSDispatcher` suites.

## License

BSD-3-Clause. See [LICENSE](../../LICENSE).
