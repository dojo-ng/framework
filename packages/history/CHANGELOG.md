# @dojo-ng/history

## 0.3.0

### Minor Changes

- Add `scrollTarget(key, el)`, so a component can register its own scrolling elements (such as ones in a shadow root) for scroll restoration under a key.

## 0.2.0

### Minor Changes

- Add hash mode (`mode: "hash"`), scroll restoration (`scroll`), focus after a navigation (`focus`), and navigation guards (`block`). Hash mode keeps the route after `#` so a static server can serve every deep link. Scroll restoration returns the window and named scrolling elements to where the user left them on Back, Forward and reload. Focus moves to the new view's heading after a `go`. `block` asks before a `go` or a Back or Forward, and undoes a refused Back with `history.go`, never a write.

## 0.1.0

First release. `installHistory(bus, options)` owns `pushState` and `popstate` for a single-page app and publishes `nav:location` on a `@dojo-ng/pubsub` bus. A `popstate` never writes history, so Back does not add entries. Pages the user leaves within `dwellMs` (default 3000, visible time only) are replaced rather than pushed. Includes the `onCommit` and `resolve` hooks, `match(pattern, path)`, the `dj-navigate` listener, a coexistence warning, and the `@dojo-ng/history/handle` subpath for components.
