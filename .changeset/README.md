# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets). Each `*.md` file (other than this README) is a pending version-bump entry for the next release.

## Adding a changeset

```bash
npm run changeset
```

Pick a bump type (`patch`, `minor`, `major`) and write a short summary. Commit the generated file with your PR.

## What happens on merge

The `Release` workflow runs on every push to `main`. If pending changesets are present, it:

1. Runs `npm run version`, which:
   - Consumes the changesets
   - Bumps `package.json#version`
   - Updates `CHANGELOG.md`
   - Runs `scripts/sync-versions.mjs` to propagate the new version to `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
2. Commits the version bump
3. Creates a `v<version>` tag and a GitHub Release

If there are no changesets, the workflow exits without releasing.
