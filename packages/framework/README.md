# @dojo-ng/framework

A small virtual DOM renderer. You describe the page with `v()`, and it updates the real DOM when
your data changes. It sets properties on custom elements directly, so Dojo NG components need no
wrapper.

Part of the [Dojo NG framework](https://foss.heptapod.net/dojo-ng/framework) packages: plain ESM,
no Lit, and no runtime dependencies. BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/framework
```

## Usage

Write a function that returns the view, and give it to `renderer()`. When your data changes, call
`invalidate()`. The renderer runs your function again, compares the result with the last one, and
changes only what is different.

```js
import { renderer, v } from "@dojo-ng/framework";
import "@dojo-ng/button";

let count = 0;

function view() {
  return v("div", {}, [
    v("p", {}, [`Clicked ${count} times`]),
    v("dj-button", { onclick: () => { count++; app.invalidate(); } }, ["Add one"]),
  ]);
}

const app = renderer(view);
app.mount({ domNode: document.getElementById("app") });
```

There is no component class and no state system. Your data is ordinary variables.

## Describing elements

- `v(tag, properties, children)` describes one element. Children are other `v()` calls or strings.
- `null`, `undefined`, and `false` render nothing, so `open && v(...)` works.
- `v()` does not flatten nested arrays. Spread a mapped list into the children array, or pass the
  mapped array as the whole children argument.
- For JSX, set your compiler's factory to `tsx`. Unlike `v()`, `tsx` flattens nested children.
- To put an element that you created yourself into the tree, wrap it with `dom({ node })`.

## Properties, attributes, and events

The renderer decides how to set each property:

- `on` plus a name, with a function: adds an event listener for the rest of the name. `onclick`
  listens for `click`, and `"ondj-close"` listens for `dj-close`.
- `key`: identifies an item in a list. With keys, the renderer moves elements instead of
  rebuilding them.
- `classes`: a string or an array of strings. Empty values are skipped.
- `styles`: an object of inline styles, such as `{ color: "red" }`.
- A string value: on a custom element that has a property with that name, sets the property.
  Otherwise sets the attribute, so `aria-*` and `data-*` work.
- Any other value: sets the property. Arrays, objects, and booleans reach the element as they are,
  with no conversion to text.

This is why the components need no wrapper. A list of options or a `columns` array goes straight
to the element's property.

```js
import { renderer, v } from "@dojo-ng/framework";
import "@dojo-ng/chip";

let tags = ["design", "docs", "release"];

function view() {
  return v("div", { classes: "tags" }, tags.map((tag) =>
    v("dj-chip", {
      key: tag,                  // keeps each chip with its tag when the list changes
      closeable: true,           // not a string, so it is set as a property
      "ondj-close": () => {      // a custom event, written like any other on* property
        tags = tags.filter((t) => t !== tag);
        app.invalidate();
      },
    }, [tag])
  ));
}

const app = renderer(view);
app.mount({ domNode: document.getElementById("tags") });
```

## Rendering and updates

- Many `invalidate()` calls in the same task cause only one render, on the next microtask.
- `flush()` runs a pending render at once.
- Mount with `sync: true` to render on every `invalidate()` call.
- `unmount()` removes the tree.
- Outside a browser, pass `nodeApi` to `mount()`, for example `createDomApi(doc)` with your own
  document.

## Feature detection

`@dojo-ng/framework/core/has` exports `has()`, `add()`, and `exists()` for named feature tests.
The renderer uses the `dojo-debug` flag for its development-only checks.

## Learn more

The [framework runtime guide](https://dojo-ng.com/docs/framework/) shows the renderer together
with [`@dojo-ng/pubsub`](https://www.npmjs.com/package/@dojo-ng/pubsub) and
[`@dojo-ng/websocket`](https://www.npmjs.com/package/@dojo-ng/websocket).

## Development

The source is a Mercurial repository on foss.heptapod.net:

```bash
hg clone https://foss.heptapod.net/dojo-ng/framework
cd framework
npm install
npm run build
```

Tests come in three layers, from fastest to slowest:

- `npm run smoke`: quick checks of `has()` and `tsx()`, with no dependencies.
- `npm run test:golden`: the renderer's behavior spec, run against a mock DOM. These tests are the
  authority. A renderer bug found anywhere else is fixed together with a new golden test.
- `npm run test:browser`: checks in real Chromium, Firefox, and WebKit for what a mock DOM cannot
  imitate, such as real events, focus, and custom elements. Run `npx playwright install` once first.

`npm test` runs the build, the smoke checks, and the golden tests. After any renderer change, run
`npm run bench` and confirm that reversing a keyed list of 10,000 rows still takes tens of
milliseconds, not seconds.

Hosting is provided at no cost by foss.heptapod.net. Heptapod is published by
[Orbeet](https://orbeet.io/), and the instance runs on infrastructure donated by
[Clever Cloud](https://www.clever-cloud.com/). Our thanks to both for supporting free and open
source projects.

## License

BSD-3-Clause. See [LICENSE](https://foss.heptapod.net/dojo-ng/framework/-/blob/branch/default/LICENSE).
