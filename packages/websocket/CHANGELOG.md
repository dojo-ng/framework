# @dojo-ng/websocket

## 0.3.0

### Minor Changes

- `WSDispatcher.close()` now stops the client for good. Before, a `close()` made while a reconnect was waiting, or after the server had sent a ping, was undone up to 40 seconds later and the client opened again (calling a URL provider once more).

  `call()` can now fail instead of waiting forever. It rejects with the new `WSCallError` when its timeout passes (`callTimeout` option, or `call(data, { timeout, signal })`), when its signal aborts, when the connection drops after the request went out, or on `dispose()`. A request still in the offline queue survives a drop and is sent on the next connect.

  Also new: `dispose()` ends a dispatcher for good; reconnect delays get random jitter (up to 25% longer, set with `reconnectJitter`, 0 turns it off); a message from the server that is not valid JSON or not an envelope is ignored instead of throwing; and an event from the server on the outbound topic is no longer sent back to the server.

### Patch Changes

- Updated dependencies
  - @dojo-ng/pubsub@0.1.5

## 0.2.0

### Minor Changes

- `WSDispatcher` can now reconnect to a URL that changes between attempts, so a socket that authenticates with a single-use ticket in the query string works. `url` accepts a function (sync or async) that is called before every open, and `reconnectBase` (seconds, default 15) sets the constant added to each reconnect delay. `WSocket.open()` takes an optional URL. A string `url` behaves exactly as before.

## 0.1.3

### Patch Changes

- Rewrite the README for npm readers: what the package does, a working example, and short sections of bullets, with links that work on npmjs.com. The package.json description is now in plain language. No behavior changes.
- Updated dependencies
  - @dojo-ng/pubsub@0.1.3

## 0.1.2

### Patch Changes

- Publish freshly built `dist/` files. 0.1.1 was published from an older build, so its JavaScript and type declarations still had the comments that 0.1.1 meant to remove. No behavior changes.
- Updated dependencies
  - @dojo-ng/pubsub@0.1.2

## 0.1.1

### Patch Changes

- Remove references to internal planning documents and earlier code from the READMEs, the envelope schema description, and the doc comments in the published type declarations. No behavior changes.
- Updated dependencies
  - @dojo-ng/pubsub@0.1.1
