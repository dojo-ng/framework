---
"@dojo-ng/websocket": minor
---

`WSDispatcher.close()` now stops the client for good. Before, a `close()` made while a reconnect was waiting, or after the server had sent a ping, was undone up to 40 seconds later and the client opened again (calling a URL provider once more).

`call()` can now fail instead of waiting forever. It rejects with the new `WSCallError` when its timeout passes (`callTimeout` option, or `call(data, { timeout, signal })`), when its signal aborts, when the connection drops after the request went out, or on `dispose()`. A request still in the offline queue survives a drop and is sent on the next connect.

Also new: `dispose()` ends a dispatcher for good; reconnect delays get random jitter (up to 25% longer, set with `reconnectJitter`, 0 turns it off); a message from the server that is not valid JSON or not an envelope is ignored instead of throwing; and an event from the server on the outbound topic is no longer sent back to the server.
