# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
Each pending change gets a markdown file here describing the bump (patch/minor/
major) and a one-line summary; `changeset version` consumes them to bump the
version and prepend to `CHANGELOG.md`, and `changeset publish` releases to npm.

Workflow:

- `npm run changeset` — add a changeset for your change (pick the bump level).
- `npm run version-packages` — apply pending changesets: bump version + update CHANGELOG.
- `npm run release` — build (via `prepublishOnly`) and publish to npm.

Note: changesets is git-native, but this repo is Mercurial/Heptapod. We work
around it the same way the components repo does: `commit: false` (commit with hg),
a changelog formatter that needs no Git, and `baseBranch: "default"` (the Mercurial
branch). The one unsupported feature is `changeset status --since=<git-ref>`, which
the normal flow doesn't use.
