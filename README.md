# Dojo NG framework

A workspace monorepo of the non-UI runtime packages an app composes with — VDOM rendering, a
socket client, a message bus. The Lit `dj-*` element library lives in a separate repo,
[`components`](https://foss.heptapod.net/dojo-ng/components); this repo has no Lit dependency
anywhere in it, and nothing here registers a custom element.

## Packages

| Package | Description |
|---|---|
| [`@dojo-ng/framework`](packages/framework/README.md) | Clean-room v()-only VDOM renderer — ESM, property-first for custom elements, O(n) keyed reconciliation |

Each package's own README has its build/test instructions and API.

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
