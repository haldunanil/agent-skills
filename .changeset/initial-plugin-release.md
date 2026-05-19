---
"agent-skills": minor
---

Initial plugin + marketplace packaging.

Adds `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` so the repo can be installed via Claude Code's plugin marketplace. Uses the URL-source object form (`{ "source": "url", "url": "..." }`) for the plugin entry — the dotted-path `"./"` form does not work for remote `/plugin install`.

Adds release automation via [changesets](https://github.com/changesets/changesets): contributors drop a `.changeset/*.md` describing the bump type, and merging to `main` triggers a workflow that bumps versions, syncs all three manifest files, tags `v<version>`, and cuts a GitHub Release.
