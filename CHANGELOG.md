# agent-skills

## 0.1.0

### Minor Changes

- [#3](https://github.com/haldunanil/agent-skills/pull/3) [`791e57d`](https://github.com/haldunanil/agent-skills/commit/791e57d1d0e7ef1f20ecb207c39d1c6bdcf3d187) Thanks [@haldunanil](https://github.com/haldunanil)! - Initial plugin + marketplace packaging.

  Adds `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` so the repo can be installed via Claude Code's plugin marketplace. Uses the URL-source object form (`{ "source": "url", "url": "..." }`) for the plugin entry — the dotted-path `"./"` form does not work for remote `/plugin install`.

  Adds release automation via [changesets](https://github.com/changesets/changesets): contributors drop a `.changeset/*.md` describing the bump type, and merging to `main` triggers a workflow that bumps versions, syncs all three manifest files, tags `v<version>`, and cuts a GitHub Release.
