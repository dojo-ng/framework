---
"@dojo-ng/pubsub": patch
---

A publish made from inside a handler is now delivered in order. Before, it reached the remaining subscribers ahead of the publish that was still being delivered, so a later subscriber could see `2` and then `1` while `getLast` returned `2`. It is now queued and delivered once the current publish has reached every subscriber.

Each `subscribe` call is now its own subscription. Before, subscribing the same handler twice and calling one of the returned unsubscribe functions removed both. A subscription removed by an earlier handler during a publish is no longer called for that publish.
