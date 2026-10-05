# Dojo NG framework

The runtime packages that an app can use with the Dojo NG components, or without them: a
renderer, a message bus, and a WebSocket client. The `dj-*` components live in a separate
repository, [`components`](https://foss.heptapod.net/dojo-ng/components). Nothing in this
repository depends on Lit or registers a custom element.

## Packages

| Package | What it gives you |
|---|---|
| [`@dojo-ng/framework`](packages/framework/README.md) | A virtual DOM renderer that sets properties on custom elements directly |
| [`@dojo-ng/pubsub`](packages/pubsub/README.md) | Publish and subscribe with namespaced topics, replay of the last value, and async iteration |
| [`@dojo-ng/websocket`](packages/websocket/README.md) | A WebSocket client that reconnects, queues messages while offline, and matches each response to its request |

Each package's README has its API and examples. The [framework runtime guide](https://dojo-ng.com/docs/framework/) shows all three together.

## Development

The canonical repository is Mercurial, hosted on foss.heptapod.net:

```
hg clone https://foss.heptapod.net/dojo-ng/framework
cd framework
npm install
npm run build
```

Hosting for this repository is provided at no cost by foss.heptapod.net. Heptapod is
published by [Orbeet](https://orbeet.io/), and the instance runs on infrastructure
donated by [Clever Cloud](https://www.clever-cloud.com/). Our thanks to both for
supporting free and open source projects.

## License

BSD-3-Clause. See [LICENSE](LICENSE).
