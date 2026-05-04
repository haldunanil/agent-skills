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

### pr-walkthrough

Generates a structured tour of a GitHub PR — a single markdown document that walks through the final state of the changed code in a digestible order, with every diff embedded inline. Pure exploration (use `comprehensive-review` for evaluation).

**Use when:**

- Onboarding to a PR you didn't write — getting a digestible overview of what's there
- Coming back to a PR weeks later to remember what it did
- Reading along during a PR review to build understanding before judging quality
- Any time `gh pr diff` alone would be too much to skim

## Installation

**Claude Code:**

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

## License

MIT
