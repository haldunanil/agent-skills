# `pr-walkthrough` Skill — Design

**Date:** 2026-05-02
**Status:** Approved (brainstorming)
**Repo:** `agent-skills`

## Purpose

Generate a structured "tour" of a GitHub PR — a single markdown document that walks a reader through the final state of the changed code in an order that makes sense, so the reader can:

1. Form an opinion on whether the PR should be merged and what changes (if any) are warranted.
2. Retain a durable understanding of what was changed and why, even months after the PR has shipped.

The walkthrough is organized by the **final state** of the code (chapters → file sections → optional sub-sections), not by commit history. Commits are incidental — they appear only in an appendix for traceability.

This skill is **pure exploration**, not review. It explains *what the code is and why it's there*. It does not propose changes, score severity, or recommend fixes. The existing `comprehensive-review` skill handles review; the two are intended to be run independently and iteratively.

## Skill metadata

- **Name:** `pr-walkthrough`
- **Description:** "Use when you want a structured tour of a GitHub PR — generates a single document that walks through the final state of the changed code in a digestible order, with all diffs embedded inline. For exploration and understanding, not review (use `comprehensive-review` for review)."
- **Argument:** optional PR number (defaults to the current branch's open PR)

## Skill structure

```
skills/pr-walkthrough/
  SKILL.md                  # Controller: arg parsing, PR resolution, agent dispatch
  walkthrough-prompt.md     # Agent prompt template (the substantive instructions)
```

Two files, mirroring the shape of `review-pr-comments`. The controller is small; the agent prompt holds the bulk of the design.

## Controller flow (`SKILL.md`)

The controller follows these steps in order. No skipping or reordering.

### Step 1: Resolve target PR

- If the user passed an argument, treat it as the PR number.
- Otherwise, look up the current branch's open PR:
  ```bash
  gh pr view --json number,url,baseRefName,headRefName,title,body,author 2>/dev/null
  ```
- If neither resolves, fail with: `"No PR found for branch '{name}', and no PR number provided. Pass a PR number as an argument."`

### Step 2: Fetch PR metadata

Run a single `gh` call to get everything the agent needs as a "table of contents":

```bash
gh pr view {PR} --json number,title,body,baseRefName,headRefName,author,url,commits,files
gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"'
```

Store: `PR_NUMBER`, `PR_TITLE`, `PR_BODY`, `BASE_BRANCH`, `HEAD_BRANCH`, `AUTHOR`, `URL`, `OWNER_REPO`, `COMMITS_LIST` (sha + headline), `FILES_LIST` (paths only).

The full diff is **not** pre-fetched — the agent fetches per-file diffs as it walks through them.

### Step 3: Compute output path and slug

- Slugify `PR_TITLE`: lowercase, replace non-alphanumerics with `-`, collapse repeats, trim, cap at 60 chars. If the slug is empty, use `untitled`.
- Output path: `/tmp/pr-walkthroughs/PR-{PR_NUMBER}-{slug}.md`
- Ensure `/tmp/pr-walkthroughs/` exists.
- If the file already exists, overwrite it (re-runs reflect current PR state).

### Step 4: Dispatch the agent

- **Tool:** `Agent` with `subagent_type: "general-purpose"` (matches other skills in this repo; `Explore` is read-only and cannot `Write` the output document)
- **Prompt:** the template from `walkthrough-prompt.md` with placeholders substituted: `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_BODY}`, `{BASE_BRANCH}`, `{HEAD_BRANCH}`, `{AUTHOR}`, `{URL}`, `{OWNER_REPO}`, `{COMMITS_LIST}`, `{FILES_LIST}`, `{OUTPUT_PATH}`
- The read-only contract (no source edits, no PR writes) is enforced via the prompt itself, not via subagent type — see prompt section 9 below.

### Step 5: Present result

Once the agent finishes, report only:

> "Walkthrough saved to `/tmp/pr-walkthroughs/PR-{PR_NUMBER}-{slug}.md`"

Nothing else. No counts, no preview, no orientation summary — the document speaks for itself.

### Announce at start

`"I'm using the pr-walkthrough skill to generate a structured tour of this PR."`

## Agent prompt design (`walkthrough-prompt.md`)

The prompt has these sections, in order:

### 1. Role & framing

> "You are walking a reader through PR #{PR_NUMBER} so they can (a) form an opinion on whether the PR should be merged and what changes (if any) are warranted, and (b) retain a durable understanding of what was changed and why, even months after the PR has shipped. The walkthrough is organized by the *final state* of the code — commits are incidental — so the reader builds a mental model of the resulting system."

### 2. Provided context

PR metadata (title, body, base/head branches, author, URL, owner/repo) plus `COMMITS_LIST` and `FILES_LIST`. Tell the agent: "Use this as your table of contents. Fetch per-file diffs as you go using `gh pr diff {PR_NUMBER} -- <file>` or `git diff {BASE_BRANCH}...{HEAD_BRANCH} -- <file>`."

### 3. Hard constraint: every diff appears (with exceptions)

> "Every chapter and section MUST contain both:
>
> - A **summary** explaining what the code does and why it's there (this is the value-add — diffs alone don't teach), AND
> - The **full final-state diff** for the relevant code, with file paths and line numbers preserved.
>
> Embed the raw `git diff` output in a fenced ` ```diff ` block. Do NOT strip the `--- a/...`, `+++ b/...`, or `@@ -X,Y +A,B @@` headers — these are how the reader navigates back to the source.
>
> Before saving the document, verify every file path in `{FILES_LIST}` appears in the document, either inside a diff block or as a summarized exception (see below)."

**Excused from full-diff embedding — summarize only:**

- **Lockfiles** — always. `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `poetry.lock`, etc. Note the churn ("12 deps added, 3 updated") but do not embed the diff.
- **Generated files derived from another file in the PR.** When one file in the PR mechanically derives from another (e.g., drizzle `schema.ts` → `migration.sql` → `meta/NNNN_snapshot.json` + `meta/_journal.json`), the human-authored source gets the full diff treatment and the generated artifact(s) get a one-line summary noting the derivation. Common patterns: drizzle `meta/*.json`, GraphQL/OpenAPI codegen outputs, `*.gen.ts` / `*.generated.ts`, build artifacts in `dist/` / `build/` / `__generated__/`. **Principle:** *if reading the source tells you everything the generated file conveys, the generated file's diff is noise.*
- **Binary files** — images, fonts, compiled blobs. Note the change exists, skip the body.

These exceptions do NOT count as violations of the "every diff appears" rule — they appear in the document, just summarized rather than dumped.

### 4. Decomposition heuristics

> "Group changes into chapters by **logical connection**, not module boundaries. Files in the same chapter don't need to live in the same package, directory, or layer — what matters is that they tell one coherent story together (e.g., a schema change, a backend handler that uses it, and a frontend hook that consumes it can all belong to one chapter even if they live in three different packages).
>
> A few chapters is usually right; many tiny chapters fragments the narrative. Use judgment — let the code's structure dictate the count, not a target number.
>
> Within a chapter, order sections so each builds on the previous (foundations first, consumers last). Chapter 1 should be the foundational piece (schema, types, core abstraction); the last chapter should be the outermost layer (UI, integration glue).
>
> Split a single file into sub-sections when it contains distinct logical units (e.g., 5 React components in one file, or schema + helpers + handler in one route file). Heuristic: split when distinct readers would care about distinct parts; don't split for cosmetic groupings."

### 5. External context fetching

> "When a name in the diff is opaque (e.g., `mySuperFancyWorkflow` rather than `formatHumanReadableDate`), or when surrounding unchanged code is needed to understand a change, fetch it with `Read`/`Grep` and quote the relevant lines in a `> Context (unchanged):` callout. Do NOT pull context for self-explanatory names. Do NOT pull more than needed — a few lines of the relevant function, not the whole file. Mark all such code clearly as **unchanged context**, not part of the PR."

### 6. Pure exploration, not review

> "Explain *what the code is and why it's there*. Do NOT propose changes, score severity, or recommend fixes. If something is genuinely surprising or unusual, you may flag it as 'worth understanding' with a brief explanation of *why it might be done this way* — but framed as comprehension, not as a problem to fix. Code review is handled by a separate skill (`comprehensive-review`)."

### 7. Output document format

A literal template that the agent fills in. (See "Output document format" section below.)

### 8. Save and stop

> "Save the document to `{OUTPUT_PATH}`. Return nothing more than confirmation that the file was saved — no summary, no counts."

### 9. Read-only contract

> "You must not modify any source files in the repo. The only write you perform is the output document at `{OUTPUT_PATH}`. You must not post comments, resolve threads, add labels, or modify the PR in any way."

## Output document format

The document the agent writes follows this structure literally:

````markdown
# PR #{PR_NUMBER}: {PR title}

**Author:** @{author}  •  **Branch:** `{head}` → `{base}`  •  **URL:** {url}
**Files changed:** {FILES_COUNT}  •  **Commits:** {COMMITS_COUNT}

> {1-3 sentence orientation: what this PR is for. Drawn from PR body if useful,
> but rewritten in the agent's voice — not copy-pasted.}

## Contents

1. [Chapter 1 title](#chapter-1-title)
2. [Chapter 2 title](#chapter-2-title)
   …
- [Cross-cutting concerns](#cross-cutting-concerns)
- [Open questions for the author](#open-questions-for-the-author)
- [Commit map](#commit-map)

---

## Chapter 1: {Concept name}

{2-4 sentence narrative explaining the concept this chapter covers and why
it comes first — what foundation it lays for later chapters.}

### `path/to/file-a.ts`

{Summary: what this file does and why it changed. Reference how it fits the chapter's concept.}

> **Context (unchanged):** `path/to/helper.ts:42-58` — `mySuperFancyWorkflow` is invoked below. It does X by Y.
> ```ts
> // …a few lines of unchanged code, quoted only where relevant…
> ```

```diff
--- a/path/to/file-a.ts
+++ b/path/to/file-a.ts
@@ -10,5 +12,7 @@
 …full final-state diff for this file…
```

### `path/to/file-b.tsx` — Component A

{Sub-section narrative for one logical unit within file-b.}

```diff
… diff slice for the Component A portion …
```

### `path/to/file-b.tsx` — Component B

… and so on …

---

## Chapter 2: {Concept name}

{Narrative explaining how this builds on Chapter 1.}

… sections and diffs …

---

## Cross-cutting concerns

{Bullet list of things the reader should hold in mind across chapters —
patterns that recur, conventions newly introduced, surfaces that touch multiple
chapters. Observational, NOT prescriptive — not fix recommendations.}

- …

## Open questions for the author

{Bullet list of genuine "I'd want to ask the author about this" items the
reader might raise in review. Framed as questions, not complaints.}

- …

## Commit map

| SHA | Message | Chapters |
|-----|---------|----------|
| `abc1234` | Add auth schema | 1 |
| `def5678` | Wire up handler | 2 |
| … | | |
````

**Notes on the format:**

- Diff blocks are raw `git diff` output. The agent does not reformat them. File paths and `@@` line numbers are preserved as-is so the reader can jump to the source.
- "Context (unchanged)" callouts use a blockquote prefix and explicitly label the code as **unchanged**. Used only when the agent decides external context is genuinely needed.
- Sub-sections within a single file use the heading pattern `` ### `path/to/file` — Unit name `` so the file path stays prominent (backticks around the path, em-dash, then unit name).
- "Cross-cutting concerns" and "Open questions for the author" are observational, matching the "pure exploration, not review" boundary.

## Edge cases & failure modes

### Controller-side

- **No PR number argument AND no PR for current branch** → fail fast: "No PR found for branch `{name}`, and no PR number provided. Pass a PR number as an argument."
- **PR number argument is invalid / not accessible** (`gh pr view` fails) → report the `gh` error verbatim and stop. Don't try to recover.
- **Existing output file** → overwrite. `/tmp` is ephemeral; re-runs reflect current PR state.
- **Slugification edge cases** → empty slug becomes `untitled`. Cap at 60 chars.

### Agent-side

- **PR has zero commits or zero files changed** → write a minimal doc explaining the PR is empty, no chapters needed, and stop. Do not fabricate content.
- **Binary files** → section exists for the file with a note that it's binary, includes a `git diff --stat` line, skips the diff body.
- **Lockfiles** → always summarized (see exception list above), regardless of churn size.
- **Generated derived files** → grouped under their human-authored source's chapter when the relationship is clear; one-line summary noting the derivation.
- **Deleted files** → diff shown as a deletion (`git diff` handles naturally). Narrative explains why and what (if anything) replaces it.
- **Renamed/moved files** → `git diff` shows rename + content delta. Narrative notes the move and reason.
- **Genuinely huge PRs** (100+ files, 50k+ diff lines) → no special chunking logic. Per-file fetching prevents agent context overload; the output document has no size limit.

### Read-only contract

The agent writes only to `{OUTPUT_PATH}`. It never modifies repo files. It never modifies the PR (no comments, no resolves, no labels). Pure read + one document write.

## Out of scope (v1)

- Cross-repo PR support (e.g., `owner/repo#NNN`). Use the current repo only.
- Verbosity / depth knobs. One default depth, no user controls.
- Inline review or fix suggestions. Use `comprehensive-review` separately.
- Persistent storage of walkthroughs. `/tmp` only — re-run if needed.
- Walking multiple PRs in one invocation.

## Implementation notes for the writing-plans phase

- Mirror the file shape and conventions of `review-pr-comments` and `comprehensive-review` (controller pattern, prompt template in a separate `.md` file, `Announce at start:` line, controller "Steps" with explicit ordering, "Red Flags" section at the bottom).
- The agent dispatch uses `subagent_type: "general-purpose"` to match the other skills in this repo (and because `Explore` cannot `Write` the output document). The read-only contract is enforced via the prompt's "Read-only contract" section, not via subagent capabilities.
- The prompt template uses `{PLACEHOLDER}` substitution — match the existing repo's conventions for how placeholders are documented and replaced.
- After the skill is built, regenerate the zip via `npm --prefix packages/hal-agent-skills run build` (per the repo's CLAUDE.md).
