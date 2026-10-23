# @dojo-ng/history

## 0.1.0

First release. `installHistory(bus, options)` owns `pushState` and `popstate` for a single-page app and publishes `nav:location` on a `@dojo-ng/pubsub` bus. A `popstate` never writes history, so Back does not add entries. Pages the user leaves within `dwellMs` (default 3000, visible time only) are replaced rather than pushed. Includes the `onCommit` and `resolve` hooks, `match(pattern, path)`, the `dj-navigate` listener, a coexistence warning, and the `@dojo-ng/history/handle` subpath for components.
