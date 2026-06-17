# hal-agent-skills

## 0.4.0

### Minor Changes

- [#10](https://github.com/haldunanil/hal-agent-skills/pull/10) [`0c39bb3`](https://github.com/haldunanil/hal-agent-skills/commit/0c39bb39b02f64015cf59c7d477ce78f6a44dcc5) Thanks [@haldunanil](https://github.com/haldunanil)! - The pr-walkthrough HTML viewer can now leave **GitHub-style review comments**: drag the line-number gutter to comment on a range (or click a single line), or comment on a whole file. Comments render as inline threads, persist in `localStorage`, and **Copy review** exports them as JSON. A new **post-pr-review** skill posts that exported review to the PR via `gh` as one batched review.

## 0.3.0

### Minor Changes

- [#9](https://github.com/haldunanil/hal-agent-skills/pull/9) [`904fbcf`](https://github.com/haldunanil/hal-agent-skills/commit/904fbcffeb6655b8918249a6e859ed7deb310a48) Thanks [@haldunanil](https://github.com/haldunanil)! - **pr-walkthrough now generates a self-contained HTML viewer** instead of a markdown file. Each changed file renders as a GitHub-style side-by-side diff with markdown narratives, syntax highlighting, a chapter sidebar, and collapsible sections.

  Under the hood, the walkthrough agent writes a compact pointer JSON (prose + `file`/`lines` pointers, never copied diffs); a stdlib-only Node build step resolves the real diffs from `gh pr diff` — correct for open, merged, and fork PRs — and inlines a reusable, versioned UI (highlight.js + markdown-it via pinned CDNs) into one file you open in a browser. Validation enforces full changed-file coverage, rename/header-only diffs render their metadata, and CI now runs the `node:test` suite.

## 0.2.1

### Patch Changes

- [#6](https://github.com/haldunanil/hal-agent-skills/pull/6) [`7a0651c`](https://github.com/haldunanil/hal-agent-skills/commit/7a0651c0653200a9cfdf3a2cf37209c4604516af) Thanks [@haldunanil](https://github.com/haldunanil)! - Allow the `comprehensive-review` skill to be invoked by models by removing `disable-model-invocation: true` from its frontmatter.

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
