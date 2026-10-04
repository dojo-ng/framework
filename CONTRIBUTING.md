# Contributing to the Dojo NG framework

Thank you for helping. This file explains how to report a problem and how to send a change to
`@dojo-ng/framework`, the Dojo NG renderer. Everyone who takes part agrees to follow the
[code of conduct](CODE_OF_CONDUCT.md).

Problems with the `dj-*` elements themselves belong in the
[components repository](https://foss.heptapod.net/dojo-ng/components) instead.

## Ask a question

Chat happens on [Discord](https://discord.gg/nReZF9QrjS). Ask there before starting anything
large, so nobody does the same work twice.

## Report a problem

Open an issue in this repository on
[Heptapod](https://foss.heptapod.net/dojo-ng/framework/-/issues). Include:

- the package version
- the browser and its version
- the smallest example that shows the problem

The GitHub mirror at `github.com/dojo-ng` is read-only. Issues and merge requests opened there
are not tracked.

## Send a change

1. Pick an issue. Issues labeled
   [good first issue](https://foss.heptapod.net/dojo-ng/framework/-/issues/?label_name%5B%5D=good%20first%20issue)
   are small and well scoped.
2. Clone with Mercurial and build:

   ```bash
   hg clone https://foss.heptapod.net/dojo-ng/framework
   cd framework
   npm install
   npm run build
   ```

3. Work on a topic. Heptapod uses Mercurial topics where Git uses branches:

   ```bash
   hg topics fix-event-binding
   ```

4. Run the checks before you push:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run test:browser
   ```

5. If the change should be released, add a changeset with `npx changeset` and commit it with
   your change.
6. Push the topic. Heptapod prints a link to open the merge request:

   ```bash
   hg push --topic fix-event-binding
   ```

   If you cannot push to this project, fork it on Heptapod and open the merge request from your
   fork.

## License

Dojo NG is BSD-3-Clause. By contributing, you agree that your contribution is released under
the same license. See [LICENSE](LICENSE).
