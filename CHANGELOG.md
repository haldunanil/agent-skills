# hal-agent-skills

## 0.2.0

### Minor Changes

- [#5](https://github.com/haldunanil/hal-agent-skills/pull/5) [`ed8f755`](https://github.com/haldunanil/hal-agent-skills/commit/ed8f75596b7cd4a45d74c20dedc4f37197110f26) Thanks [@haldunanil](https://github.com/haldunanil)! - Rename plugin, marketplace, and npm package from `agent-skills` to `hal-agent-skills`.

  The previous name collided with Anthropic's reserved marketplace namespace (`claude plugin marketplace add` rejected it with: "The name 'agent-skills' is reserved for official Anthropic marketplaces"). Existing installs from the old name will need to be removed and reinstalled under the new identifiers:

  ```bash
  claude plugin marketplace add haldunanil/hal-agent-skills
  claude plugin install hal-agent-skills@hal-agent-skills
  ```

## 0.1.0

### Minor Changes

- [#3](https://github.com/haldunanil/hal-agent-skills/pull/3) [`791e57d`](https://github.com/haldunanil/hal-agent-skills/commit/791e57d1d0e7ef1f20ecb207c39d1c6bdcf3d187) Thanks [@haldunanil](https://github.com/haldunanil)! - Initial plugin + marketplace packaging.

  Adds `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` so the repo can be installed via Claude Code's plugin marketplace. Uses the URL-source object form (`{ "source": "url", "url": "..." }`) for the plugin entry — the dotted-path `"./"` form does not work for remote `/plugin install`.

  Adds release automation via [changesets](https://github.com/changesets/changesets): contributors drop a `.changeset/*.md` describing the bump type, and merging to `main` triggers a workflow that bumps versions, syncs all three manifest files, tags `v<version>`, and cuts a GitHub Release.
