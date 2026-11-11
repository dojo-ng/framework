# @dojo-ng/pubsub

## 0.1.5

### Patch Changes

- A publish made from inside a handler is now delivered in order. Before, it reached the remaining subscribers ahead of the publish that was still being delivered, so a later subscriber could see `2` and then `1` while `getLast` returned `2`. It is now queued and delivered once the current publish has reached every subscriber.

  Each `subscribe` call is now its own subscription. Before, subscribing the same handler twice and calling one of the returned unsubscribe functions removed both. A subscription removed by an earlier handler during a publish is no longer called for that publish.

## 0.1.4

### Patch Changes

- Fix a handler that publishes from inside a handler. The delivery loop used to compare against the state from before the outer publish, so a publish made by a handler made the outer topic look changed again, and it was delivered to its handlers a second time, without end if they published every time. Each publish is now delivered once.

## 0.1.3

### Patch Changes

- Rewrite the README for npm readers: what the package does, a working example, and short sections of bullets, with links that work on npmjs.com. The package.json description is now in plain language. No behavior changes.

## 0.1.2

### Patch Changes

- Publish freshly built `dist/` files. 0.1.1 was published from an older build, so its JavaScript and type declarations still had the comments that 0.1.1 meant to remove. No behavior changes.

## 0.1.1

### Patch Changes

- Remove references to internal planning documents and earlier code from the READMEs, the envelope schema description, and the doc comments in the published type declarations. No behavior changes.
