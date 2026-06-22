# Agent Skills

A collection of skills for AI coding agents. Skills are packaged instructions and scripts that extend agent capabilities.

Skills follow the [Agent Skills](https://agentskills.io/) format.

## Available Skills

### comprehensive-review

Orchestrates unresolved PR comments, automated code review, and CI watching into a single severity-ranked action plan saved to file. Dispatches subagents in parallel, then synthesizes their outputs.

**Use when:**

- Before addressing PR feedback (get the full picture first)
- Before final merge (catch everything in one pass)
- When wanting a consolidated view of all issues across PR comments, code quality, and CI failures

### review-pr-comments

Fetches all unresolved review comments on the current branch's PR, classifies them as Questions or Change Requests, and presents a structured summary.

**Use when:**

- Checking what reviewers said on your PR
- Getting a summary of unresolved feedback before addressing it
- Seeing how many comments are Questions vs Change Requests
- Quick triage of PR feedback without a full code review

## Installation

**Claude Code (recommended — install as a plugin):**

```bash
claude plugin marketplace add haldunanil/hal-agent-skills
claude plugin install hal-agent-skills@hal-agent-skills
```

This registers the repo as a marketplace and installs the `hal-agent-skills` plugin from it. Updates land here on `main` (tagged releases) and can be pulled with `claude plugin update`.

**Claude Code (per-project dependency):**

Add to `.claude/settings.json` in the project that needs the skills:

```jsonc
{
  "extraKnownMarketplaces": {
    "hal-agent-skills": {
      "source": { "source": "github", "repo": "haldunanil/hal-agent-skills" }
    }
  },
  "enabledPlugins": {
    "hal-agent-skills@hal-agent-skills": true
  }
}
```

Anyone who opens the project in Claude Code will be prompted to install.

**Claude Code (manual copy — legacy):**

```bash
cp -r skills/<skill-name> ~/.claude/skills/
```

**claude.ai:**
Upload `skills/<skill-name>.zip` to project knowledge, or paste the `SKILL.md` contents into the conversation.

## Usage

Skills are automatically available once installed. The agent will use them when relevant tasks are detected.

**Examples:**

```
Review my PR comments
```

```
Give me a comprehensive review before I merge
```

## Skill Structure

Each skill contains:

- `SKILL.md` — instructions for the agent (required)
- Reference prompt files (`*.md`) — loaded progressively by the agent (optional)
- `scripts/` — helper scripts for automation (optional)

Rule-based skills (many small best-practice rules generated from a `rules/` directory) can be added via the build pipeline in `packages/hal-agent-skills/`. See `AGENTS.md` for details.

## Releasing

This repo uses [changesets](https://github.com/changesets/changesets) for version bumps. To ship a change:

1. Make your changes in a PR.
2. Run `npm run changeset` and answer the prompts (pick a bump type, write a one-line summary). Commit the generated `.changeset/*.md` with your PR.
3. Merge the PR.

On push to `main`, the `Release` workflow consumes any pending changesets, bumps `package.json` + both manifests via `scripts/sync-versions.mjs`, generates `CHANGELOG.md`, tags `v<version>`, and cuts a GitHub Release. If there are no pending changesets, nothing happens — your PR ships to `main` and waits for the next changeset-bearing PR to trigger a release.

The `Manifest Check` workflow guards against `plugin.json` and `marketplace.json` versions drifting apart.

## License

MIT
