# @dojo-ng/history

Navigation history for single-page apps: real paths with `pushState`, Back and Forward that skip
pages the user only skimmed, and hooks for tracking. It publishes the location on a
[`@dojo-ng/pubsub`](https://www.npmjs.com/package/@dojo-ng/pubsub) bus. Your app decides what to show.

Part of the [Dojo NG framework](https://foss.heptapod.net/dojo-ng/framework) packages: plain ESM
and no Lit. BSD-3-Clause.

## Install

```bash
npm install @dojo-ng/history @dojo-ng/pubsub
```

## Usage

```js
import { createPubSub } from "@dojo-ng/pubsub";
import { installHistory, match } from "@dojo-ng/history";

const bus = createPubSub();
const history = installHistory(bus);

// Follow the location. The current one arrives at once, so this also covers a reload.
history.subscribe((location) => {
  const order = match("/orders/:id", location.path);
  if (order) showOrder(order.id);
});

history.go("/orders/7");   // pushes /orders/7 and publishes the new location
history.back();
```

Call `installHistory` once, at startup. A second call logs a warning and returns the first
instance, because there is one history stack.

## Real paths need a server fallback

Every navigation is a real URL. A reload, a pasted link, or a bookmark asks the server for that
path, so the server must answer every route your app uses with the app itself. Without that, a
reload on `/orders/7` is a 404. The app must also be able to render a view from the path alone.
The [playground](playground/server.mjs) has a ten-line example.

## The bus

| Topic | Payload | Meaning |
|---|---|---|
| `nav:go` | `{ path, state?, trail?, replace? }` | Navigate. Anything can publish this. `history.go(path, state)` is a shortcut. |
| `nav:location` | `{ path, state, index, committed, source, trail? }` | The location changed. |

- `path` is the app path: no `base`, but it keeps any `?query` and `#hash` you gave to `go`.
- `source` is `"go"` (a `nav:go`), `"pop"` (Back or Forward), or `"load"` (the page opened).
- `index` is the entry's position in the stack. The entry the app landed on is 0.
- `committed` is `false` while the entry is provisional (see Dwell). When it commits,
  `nav:location` is published again with `committed: true`.
- The bus keeps the last value, so a view that subscribes late still gets the current location.

Only a `nav:go` writes to the browser's history. A `popstate` publishes `nav:location` and does
nothing else, so Back never adds an entry.

## The history object

`installHistory(bus, options)` returns:

- `go(path, state?, { replace?, trail? }?)`, `back()`, `forward()`
- `subscribe(fn)` returns an unsubscribe function
- `current`: the latest `nav:location` payload, or `undefined` before the first one
- `canGoBack`, `canGoForward`: properties. The browser does not say whether Back or Forward has
  somewhere to go, so each entry carries a private `{ id, index }` in `history.state`, and the
  highest index is kept in `sessionStorage`. Without `sessionStorage`, `canGoForward` is `false`.
- `href(path)`: `base` plus `path`, for a link's `href`
- `annotate({ state?, trail? })`: replace those fields on the current entry (with `replaceState`)
  and publish the location again. It sets whichever of the two you pass; it does not merge inside `state`.
- `commit()`: commit the current entry now
- `destroy()`: remove the listeners and unregister. For tests.

## Options

| Option | Default | Meaning |
|---|---|---|
| `base` | `""` | A path prefix such as `/acme`. Added to every URL written and stripped from every path read. |
| `dwellMs` | `3000` | Visible milliseconds before an entry commits. `0` gives plain browser behavior. |
| `onCommit` | none | Called once for each entry that commits. See Hooks. |
| `resolve` | none | Rebuilds the state of a landing entry that has none. See Hooks. |
| `window` | `globalThis.window` | For tests: any object shaped like the parts of `window` this uses. |

## Dwell: skimmed pages stay off the stack

A browser cannot remove an entry from history, but it can replace the current one. So a new entry
is provisional until the user has stayed on it for `dwellMs`. If `go` runs while the current entry
is provisional, the new path replaces it instead of pushing. Open A, read it, then click through B, C
and D quickly and settle on E: the stack holds A and E, and Back from E goes to A.

- The entry the app lands on is committed at once.
- An entry reached by Back or Forward is committed. It already earned its place.
- `commit()` commits early, for when the user clearly engaged (typing in a form, for example).
- Only visible time counts. The timer pauses while the tab is hidden and resumes with the time that was left.
- `go(path, state, { replace: true })` on a provisional entry replaces it and restarts the timer. On
  an entry that has already committed, the replacement commits too and keeps its place.
- `dwellMs: 0` pushes every entry, as a browser does.

## Hooks

`onCommit({ path, state, trail? })` runs once per entry that commits. It never runs for a skimmed
entry or for the landing entry. This is the place to send a location to a server. This package
ships no server code.

`resolve(path)` is async. When the page opens on an entry with no state of ours (a new tab, a
pasted link, a bookmark), it is awaited before the first `nav:location` (`source: "load"`), and its
result becomes the entry's state. If it rejects, the error is logged and the bare path is
published. A reload in the same tab keeps its state, so `resolve` is not called. If the app
navigates before `resolve` settles, the late result is dropped.

## match

```js
import { match } from "@dojo-ng/history";

match("/orders/:id", "/orders/42");          // { id: "42" }
match("/files/*", "/files/a/b");             // { "*": "a/b" }
match("/orders/:id", "/orders");             // null
```

Static segments, `:name` params (decoded with `decodeURIComponent`), and a trailing `*` that takes
the rest, zero or more segments. A trailing slash on either side is ignored. Pass a pathname: a
`?query` or `#hash` is not stripped. Navigation never calls `match`; mapping a path to a view is the app's job.

## For components: the handle subpath

```js
import { getHistory, whenHistory } from "@dojo-ng/history/handle";
```

`getHistory()` returns the installed instance or `undefined`. `whenHistory()` returns a promise
that resolves at install. The subpath also exports the types and imports nothing, so a component
that only reads the location does not pull in the rest of the package. The instance is stored on
`globalThis[Symbol.for("dojo-ng.history")]`, so two copies of the package in one bundle share one.

## The dj-navigate event

A component that has a path does not need the instance. It dispatches a bubbling, composed
`dj-navigate` event, and `installHistory` listens for it on `document`:

```js
this.dispatchEvent(new CustomEvent("dj-navigate", {
  detail: { path: "/orders/7", state: undefined, trail: [{ path: "/orders", label: "Orders" }, { path: "/orders/7", label: "Order 7" }], replace: false },
  bubbles: true,
  composed: true,
}));
```

It becomes a `nav:go`. `trail` is stored in the entry's state, so it comes back on Back, Forward,
and a same-tab reload. Other keys in `detail` (such as `label`) are ignored here.

## Another router on the page

If something else seems to be writing history, one `console.warn` per kind of signal is logged and
the layer carries on: `history.pushState` or `replaceState` is not native; Back or Forward lands
on an entry this layer did not create; or the location changed without a `nav:go`. This package
never patches `pushState`.

## Playground

```bash
cd packages/history
npm run build
npm run playground     # http://localhost:8902/
```
