# pr-walkthrough Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new skill at `skills/pr-walkthrough/` that generates a structured tour of a GitHub PR, organized by the *final state* of the code (chapters → file sections → optional sub-sections), with all diffs embedded inline.

**Architecture:** Two files (`SKILL.md` + `walkthrough-prompt.md`) following the same controller-dispatches-prompted-subagent pattern as the existing `review-pr-comments` and `comprehensive-review` skills. No new code — just markdown content. The repo's build pipeline (`packages/hal-agent-skills`) auto-discovers any new skill directory and packages it into `skills/<name>.zip`.

**Tech Stack:** Markdown skill files, `gh` CLI (used inside the skill), `npm`/`tsx` build pipeline (already in repo), `zip` CLI (already required by build pipeline).

**Reference:** Approved design at `docs/superpowers/specs/2026-05-02-pr-walkthrough-design.md` (commit `aff7f82`).

---

## Pre-flight context

Read these existing files before Task 1 — they are the convention you will be matching:

- `skills/review-pr-comments/SKILL.md` — the closest structural analog (single-agent dispatch). Note its `## Controller Steps`, numbered `### Step N: ...` subsections, and final `## Red Flags` section.
- `skills/review-pr-comments/pr-comments-prompt.md` — the analog for the prompt file. Note: it starts with a top-level `# {Role} Agent` heading, has a `## Provided Context` section listing pre-resolved values, then `## Your Task`, then `## Steps`, then `## Output Format`, then `## Important`.
- `skills/comprehensive-review/SKILL.md` — for reference on more complex orchestration; pr-walkthrough is simpler (single agent, no parallel dispatch).
- `packages/hal-agent-skills/src/validate-skills.ts` — what the validator checks: frontmatter must have `name` (matching directory) and `description`, all sibling files referenced from SKILL.md (e.g., `walkthrough-prompt.md`) must exist, SKILL.md should stay under 500 lines.

---

## File Structure

Files this plan creates:

- **Create:** `skills/pr-walkthrough/SKILL.md` — controller (PR resolution, metadata fetch, output path, agent dispatch, present result)
- **Create:** `skills/pr-walkthrough/walkthrough-prompt.md` — the agent prompt template (filled in by the controller and dispatched as the agent's instructions)
- **Create (build artifact):** `skills/pr-walkthrough.zip` — produced by `npm --prefix packages/hal-agent-skills run build`

No existing files are modified. No code/test files. The validator and packager auto-discover the new directory.

---

## Task 1: Scaffold the skill directory with placeholder prompt file

The validator will fail if `SKILL.md` references `walkthrough-prompt.md` and the file doesn't exist. Create both up front so we can validate incrementally.

**Files:**
- Create: `skills/pr-walkthrough/walkthrough-prompt.md` (placeholder — will be filled in Tasks 5–8)

- [ ] **Step 1: Create the skill directory**

Run from repo root:

```bash
mkdir -p skills/pr-walkthrough
```

- [ ] **Step 2: Create the placeholder prompt file**

Write `skills/pr-walkthrough/walkthrough-prompt.md` with placeholder content so the file exists for validation:

```markdown
# PR Walkthrough Agent

(This file will be filled in during Tasks 5–8 of the implementation plan.)
```

- [ ] **Step 3: Verify the directory was created**

Run:

```bash
ls -la skills/pr-walkthrough/
```

Expected: directory listing showing `walkthrough-prompt.md`.

---

## Task 2: Write SKILL.md (frontmatter, intro, announce)

**Files:**
- Create: `skills/pr-walkthrough/SKILL.md`

- [ ] **Step 1: Write frontmatter, title, and announce line**

Write the file (this is just the opening — Tasks 3 and 4 append the controller steps and red flags). Full file content for this step:

````markdown
---
name: pr-walkthrough
description: Use when you want a structured tour of a GitHub PR — generates a single document that walks through the final state of the changed code in a digestible order, with all diffs embedded inline. For exploration and understanding, not review (use comprehensive-review for review).
---

# PR Walkthrough

Generates a structured "tour" of a GitHub PR — a single markdown document that walks the reader through the final state of the changed code in an order that makes sense, with every diff embedded inline. The reader leaves with (a) enough context to form an opinion on whether the PR should be merged and (b) a durable mental model of what changed and why.

This skill is **pure exploration**, not review. It explains *what the code is and why it's there*; it does not propose changes, score severity, or recommend fixes. For review, use the `comprehensive-review` skill — the two are designed to be run independently and iteratively.

**Announce at start:** "I'm using the pr-walkthrough skill to generate a structured tour of this PR."

## When to Use

- Onboarding to a PR you didn't write — getting a digestible overview of what's there
- Coming back to a PR weeks later to remember what it did
- Reading along during a PR review to build understanding before judging quality
- Any time `gh pr diff` alone would be too much to skim

## Controller Steps

Follow these steps exactly. Do not skip or reorder.
````

- [ ] **Step 2: Verify the file is well-formed so far**

Run:

```bash
head -20 skills/pr-walkthrough/SKILL.md
```

Expected: frontmatter `---` block followed by the `# PR Walkthrough` heading and intro paragraphs.

---

## Task 3: Append SKILL.md Controller Steps 1–3

**Files:**
- Modify: `skills/pr-walkthrough/SKILL.md` (append after `## Controller Steps` intro line)

- [ ] **Step 1: Append Steps 1, 2, and 3 to SKILL.md**

Append this content to the end of `SKILL.md`:

````markdown

### Step 1: Resolve target PR

If the user passed an argument, use it as the PR number. Otherwise, look up the current branch's open PR:

```bash
gh pr view --json number,url,baseRefName,headRefName,title,body,author 2>/dev/null
```

- If the user passed a PR number argument, set `PR_NUMBER` to that argument.
- Otherwise, if the `gh pr view` call succeeds, set `PR_NUMBER` from the `number` field of the JSON.
- If neither succeeds, fail with: `"No PR found for branch '{BRANCH_NAME}', and no PR number provided. Pass a PR number as an argument."` and **stop**.

### Step 2: Fetch PR metadata

Once `PR_NUMBER` is known, fetch the metadata the agent needs as its table of contents:

```bash
gh pr view $PR_NUMBER --json number,title,body,baseRefName,headRefName,author,url,commits,files
gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"'
```

Store these values for the prompt template:

- `PR_NUMBER` — the PR number
- `PR_TITLE` — the title
- `PR_BODY` — the description body (may be empty)
- `BASE_BRANCH` — `baseRefName`
- `HEAD_BRANCH` — `headRefName`
- `AUTHOR` — `author.login`
- `URL` — the PR URL
- `OWNER_REPO` — the `owner/repo` string from `gh repo view`
- `COMMITS_LIST` — the full commits array (each entry has at minimum `oid` and `messageHeadline`)
- `FILES_LIST` — the full files array (each entry has `path`)

The full diff is **not** pre-fetched. The agent fetches per-file diffs as it walks through them — this is intentional, to keep the agent prompt small and to scale to large PRs.

### Step 3: Compute output path and slug

Slugify `PR_TITLE`:

1. Lowercase
2. Replace any character that is not `[a-z0-9]` with `-`
3. Collapse runs of `-` into a single `-`
4. Trim leading and trailing `-`
5. Cap at 60 characters (cut, then re-trim trailing `-`)
6. If the result is empty, use the literal string `untitled`

Then compute the output path:

```bash
mkdir -p /tmp/pr-walkthroughs
OUTPUT_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.md"
```

If the file already exists, it will be overwritten in Step 4. `/tmp` is ephemeral; re-runs reflect the current PR state.
````

- [ ] **Step 2: Verify the file structure is intact**

Run:

```bash
grep -n "^### Step" skills/pr-walkthrough/SKILL.md
```

Expected output:

```
### Step 1: Resolve target PR
### Step 2: Fetch PR metadata
### Step 3: Compute output path and slug
```

(Line numbers will vary.)

---

## Task 4: Append SKILL.md Controller Steps 4–5 + Red Flags

**Files:**
- Modify: `skills/pr-walkthrough/SKILL.md` (append after Step 3)

- [ ] **Step 1: Append Steps 4 and 5**

Append:

````markdown

### Step 4: Dispatch the agent

- **Tool:** `Agent` (or `Task`) with `subagent_type: "general-purpose"`
  - Why `general-purpose` and not `Explore`: the agent must `Write` the output document, and the `Explore` subagent is read-only. The read-only contract for repository files is enforced via the prompt itself, not via subagent capabilities.
- **Prompt:** Fill the template from `walkthrough-prompt.md` (sibling of this file), substituting these placeholders with the values from Steps 1–3:
  - `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_BODY}`, `{BASE_BRANCH}`, `{HEAD_BRANCH}`, `{AUTHOR}`, `{URL}`, `{OWNER_REPO}`, `{COMMITS_LIST}` (formatted as one `sha  headline` per line), `{FILES_LIST}` (formatted as one path per line), `{OUTPUT_PATH}`

### Step 5: Present result

Once the agent returns, report only this single line to the user:

> Walkthrough saved to `/tmp/pr-walkthroughs/PR-{PR_NUMBER}-{SLUG}.md`

Do not include counts, previews, or orientation summaries. The document is the artifact; it speaks for itself.
````

- [ ] **Step 2: Append Red Flags**

Append:

````markdown

## Red Flags

**Never:**

- Modify any source files in the repo — this skill is read-only with respect to the project tree
- Modify the PR in any way — no comments, no resolves, no labels, no merges
- Continue past Step 1 if no PR can be resolved
- Strip diff headers (`--- a/...`, `+++ b/...`, `@@ -X,Y +A,B @@`) when embedding diffs — the reader needs them to navigate
- Summarize or elide diffs for files that are not in the excused list (lockfiles, generated derived files, binary files) — see the prompt for the full exception list
- Replace this skill with `comprehensive-review`. They are independent: this skill explains, that one evaluates

**If the agent fails:**

- Report the failure to the user with the error details. Do not retry automatically.
````

- [ ] **Step 3: Verify the final structure**

Run:

```bash
grep -n "^##\|^###" skills/pr-walkthrough/SKILL.md
```

Expected (line numbers will vary):

```
## When to Use
## Controller Steps
### Step 1: Resolve target PR
### Step 2: Fetch PR metadata
### Step 3: Compute output path and slug
### Step 4: Dispatch the agent
### Step 5: Present result
## Red Flags
```

- [ ] **Step 4: Validate SKILL.md**

Run:

```bash
npm --prefix packages/hal-agent-skills run validate-skills
```

Expected: `✓ pr-walkthrough (0 errors, 0 warnings)` in the output, and the script exits 0.

If validation fails, fix the reported issue inline before proceeding. Common causes: frontmatter missing/malformed, the file `walkthrough-prompt.md` is missing (Task 1 should have created it as a placeholder).

- [ ] **Step 5: Commit SKILL.md scaffolding**

```bash
git add skills/pr-walkthrough/SKILL.md skills/pr-walkthrough/walkthrough-prompt.md
git commit -m "$(cat <<'EOF'
skill: scaffold pr-walkthrough SKILL.md and placeholder prompt

Adds the controller for the new pr-walkthrough skill. The agent prompt
is a placeholder pending Tasks 5–8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write walkthrough-prompt.md sections 1–3 (header, role, context, hard constraint)

**Files:**
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md` (overwrite the placeholder)

- [ ] **Step 1: Replace the placeholder with the prompt header and first three sections**

Overwrite `skills/pr-walkthrough/walkthrough-prompt.md` with:

````markdown
# PR Walkthrough Agent

You are generating a structured tour of PR #{PR_NUMBER}. The output is a single markdown document that walks a reader through the final state of the changed code in a digestible order, with all diffs embedded inline.

## Provided Context

The controller has already resolved this metadata — do **not** re-fetch it:

- **PR Number:** {PR_NUMBER}
- **PR Title:** {PR_TITLE}
- **PR Body:**

```
{PR_BODY}
```

- **Base branch:** {BASE_BRANCH}
- **Head branch:** {HEAD_BRANCH}
- **Author:** @{AUTHOR}
- **URL:** {URL}
- **Owner/Repo:** {OWNER_REPO}
- **Commits (sha — headline, oldest first):**

```
{COMMITS_LIST}
```

- **Files changed:**

```
{FILES_LIST}
```

- **Output path:** `{OUTPUT_PATH}`

Use the commits list and files list as your **table of contents**. Fetch per-file final-state diffs as you go using either:

```bash
gh pr diff {PR_NUMBER} -- <file>
```

or

```bash
git diff {BASE_BRANCH}...{HEAD_BRANCH} -- <file>
```

## 1. Role and framing

You are walking a reader through PR #{PR_NUMBER} so they can:

1. **Form an opinion** on whether the PR should be merged and what changes (if any) are warranted.
2. **Retain a durable understanding** of what was changed and why, even months after the PR has shipped.

The walkthrough is organized by the **final state** of the code — commits are incidental — so the reader builds a mental model of the resulting system, not a chronology of how it was built.

## 2. Hard constraint: every changed file appears in the document

Every chapter and section MUST contain BOTH:

- A **summary** explaining what the code does and why it's there. This is the value-add — diffs alone do not teach.
- The **full final-state diff** for the relevant code, with file paths and line numbers preserved.

Embed the raw `git diff` output in a fenced ` ```diff ` block. **Do NOT** strip the `--- a/...`, `+++ b/...`, or `@@ -X,Y +A,B @@` headers — these are how the reader navigates back to the source.

Before saving the document, verify that **every file path in the files list above appears in the document**, either inside a diff block or in a summarized exception (see below).

### Excused from full-diff embedding — summarize only

These files appear in the document, but only as a one-line summary, not as a full diff. Counting them as "appears in the document" satisfies the constraint above.

- **Lockfiles** — always, regardless of churn size. Examples: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`, `poetry.lock`. Note the churn ("12 deps added, 3 updated") but do not embed the diff.
- **Generated files derived from another file in the PR.** When one file in the PR mechanically derives from another (e.g., drizzle `schema.ts` → `migration.sql` → `meta/NNNN_snapshot.json` + `meta/_journal.json`), the human-authored source gets the full diff treatment and the generated artifact(s) get a one-line summary noting the derivation. Common patterns: drizzle `meta/*.json`, GraphQL/OpenAPI codegen outputs, `*.gen.ts` / `*.generated.ts`, build artifacts under `dist/` / `build/` / `__generated__/`. **Principle:** *if reading the source tells you everything the generated file conveys, the generated file's diff is noise.*
- **Binary files** — images, fonts, compiled blobs. Note the change exists, include a `git diff --stat` line for it, skip the body.

When grouping a generated file under its source, both still get sections — the source gets the full diff, the generated artifact gets a one-line "generated from `path/to/source` — N lines added/removed" note.
````

- [ ] **Step 2: Verify the file is well-formed**

Run:

```bash
grep -n "^##\|^# " skills/pr-walkthrough/walkthrough-prompt.md
```

Expected:

```
# PR Walkthrough Agent
## Provided Context
## 1. Role and framing
## 2. Hard constraint: every changed file appears in the document
### Excused from full-diff embedding — summarize only
```

---

## Task 6: Append walkthrough-prompt.md sections 3–5 (decomposition, external context, exploration boundary)

**Files:**
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md` (append)

- [ ] **Step 1: Append sections 3, 4, and 5**

Append to `walkthrough-prompt.md`:

````markdown

## 3. Decomposition heuristics: chapters, sections, sub-sections

Group changes into **chapters** by *logical connection*, not by module boundaries. Files in the same chapter do **not** need to live in the same package, directory, or layer — what matters is that they tell one coherent story together. A schema change, the backend handler that uses it, and the frontend hook that consumes it can all belong to one chapter even if they live in three different packages.

A few chapters is usually right; many tiny chapters fragments the narrative. Use judgment — let the code's structure dictate the count, not a target number.

Within a chapter, order **sections** so each builds on the previous (foundations first, consumers last). Chapter 1 should be the foundational piece (schema, types, core abstraction); the last chapter should be the outermost layer (UI, integration glue).

Split a single file into **sub-sections** when it contains distinct logical units (e.g., 5 React components in one file, or schema + helpers + handler in one route file). Heuristic: split when distinct readers would care about distinct parts; do not split for cosmetic groupings.

Sub-section headings use the pattern: `` ### `path/to/file` — Unit name `` (backticks around the path, em-dash, then the unit name).

## 4. External context (unchanged code)

When a name in the diff is **opaque** (e.g., `mySuperFancyWorkflow` rather than `formatHumanReadableDate`), or when **surrounding unchanged code** is genuinely needed to understand a change, fetch the relevant lines with `Read` or `Grep` and quote them in a `> Context (unchanged):` callout.

- Do **not** pull context for self-explanatory names.
- Do **not** pull more than needed — a few lines of the relevant function, not the whole file.
- Mark all such code clearly as **unchanged context**, not part of the PR.

Example:

```markdown
> **Context (unchanged):** `path/to/helper.ts:42–58` — `mySuperFancyWorkflow` is invoked below. It coordinates the X/Y/Z lifecycle by calling each subsystem in sequence.
> ```ts
> export function mySuperFancyWorkflow(input: Foo): Bar {
>   // …a few lines of the actual unchanged code…
> }
> ```
```

## 5. Pure exploration, not review

Explain *what the code is and why it's there*. Do **not**:

- Propose changes
- Score severity
- Recommend fixes

If something is genuinely surprising or unusual, you may flag it as **worth understanding** with a brief explanation of *why it might be done this way* — but framed as comprehension, not as a problem to fix.

Code review is handled by a separate skill (`comprehensive-review`). The two skills are run independently and iteratively; do not duplicate that skill's work.
````

- [ ] **Step 2: Verify**

Run:

```bash
grep -n "^## " skills/pr-walkthrough/walkthrough-prompt.md
```

Expected (with sections 1–5 now present):

```
## Provided Context
## 1. Role and framing
## 2. Hard constraint: every changed file appears in the document
## 3. Decomposition heuristics: chapters, sections, sub-sections
## 4. External context (unchanged code)
## 5. Pure exploration, not review
```

---

## Task 7: Append walkthrough-prompt.md section 6 (output document template)

This is the largest section — a literal markdown template the agent fills in.

**Files:**
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md` (append)

- [ ] **Step 1: Append section 6 with the literal template**

Append to `walkthrough-prompt.md`:

`````markdown

## 6. Output document format

Write the document to `{OUTPUT_PATH}` using exactly this structure:

````markdown
# PR #{PR_NUMBER}: {PR_TITLE}

**Author:** @{AUTHOR}  •  **Branch:** `{HEAD_BRANCH}` → `{BASE_BRANCH}`  •  **URL:** {URL}
**Files changed:** N  •  **Commits:** N

> One to three sentences orienting the reader to what this PR is for. Drawn from
> the PR body if useful, but rewritten in your own voice — do not copy-paste.

## Contents

1. [Chapter 1 title](#chapter-1-title)
2. [Chapter 2 title](#chapter-2-title)
   …
- [Cross-cutting concerns](#cross-cutting-concerns)
- [Open questions for the author](#open-questions-for-the-author)
- [Commit map](#commit-map)

---

## Chapter 1: <Concept name>

Two to four sentences explaining what concept this chapter covers and why it
comes first — what foundation it lays for later chapters.

### `path/to/file-a.ts`

Summary: what this file does and why it changed. Reference how it fits the chapter's concept.

> **Context (unchanged):** `path/to/helper.ts:42–58` — `mySuperFancyWorkflow` is invoked below. It does X by Y.
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

Sub-section narrative for one logical unit within file-b.

```diff
… diff slice for the Component A portion …
```

### `path/to/file-b.tsx` — Component B

… and so on …

---

## Chapter 2: <Concept name>

Narrative explaining how this builds on Chapter 1.

… sections and diffs …

---

## Cross-cutting concerns

Bullet list of things the reader should hold in mind across chapters — patterns
that recur, conventions newly introduced, surfaces that touch multiple chapters.
**Observational, not prescriptive — not fix recommendations.**

- …

## Open questions for the author

Bullet list of genuine "I'd want to ask the author about this" items the reader
might raise in review. Framed as questions, not complaints.

- …

## Commit map

| SHA       | Message              | Chapters |
|-----------|----------------------|----------|
| `abc1234` | Add auth schema      | 1        |
| `def5678` | Wire up handler      | 2        |
| …         |                      |          |
````

### Notes on the template

- Diff blocks are raw `git diff` output. Do not reformat them. File paths and `@@` line numbers stay as-is so the reader can jump to the source in their editor.
- "Context (unchanged)" callouts use a blockquote prefix (`> `) and are explicitly labeled **unchanged**. Use them only when external context is genuinely needed (see Section 4).
- Sub-sections within a single file use the heading pattern `` ### `path/to/file` — Unit name ``.
- "Cross-cutting concerns" and "Open questions for the author" are observational, matching the "pure exploration, not review" boundary in Section 5.
- If the PR has zero commits or zero files changed, write a minimal document explaining that the PR is empty, no chapters needed, and stop. Do not fabricate content.

### Edge cases to handle

- **Deleted files** — the diff naturally shows a deletion. The narrative explains why and what (if anything) replaces them.
- **Renamed/moved files** — `git diff` shows rename + content delta. The narrative notes the move and reason.
- **Binary files** — section exists for the file with a note that it is binary, includes a `git diff --stat` line for it, skips the diff body (see Section 2 exception list).
- **Lockfiles** — always summarized, never embedded (see Section 2 exception list).
- **Generated derived files** — grouped under their human-authored source's chapter when the relationship is clear; one-line summary noting the derivation (see Section 2 exception list).
- **Genuinely huge PRs** (100+ files, 50k+ diff lines) — no special chunking. Per-file fetching keeps your context manageable; the output document has no size limit.
`````

- [ ] **Step 2: Verify**

Run:

```bash
grep -n "^## 6" skills/pr-walkthrough/walkthrough-prompt.md
```

Expected: one match for `## 6. Output document format`.

Also confirm the template's nested fences didn't break anything:

```bash
wc -l skills/pr-walkthrough/walkthrough-prompt.md
```

Expected: file size grew significantly (the template is substantial). Roughly 200+ lines total at this point.

---

## Task 8: Append walkthrough-prompt.md sections 7–8 (save & read-only) and final reminders

**Files:**
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md` (append)

- [ ] **Step 1: Append sections 7 and 8**

Append to `walkthrough-prompt.md`:

````markdown

## 7. Save and stop

After composing the document, save it to `{OUTPUT_PATH}` using your `Write` tool. The directory `/tmp/pr-walkthroughs/` has already been created by the controller; you do not need to create it.

If a file already exists at `{OUTPUT_PATH}`, overwrite it.

Once saved, return only a brief confirmation that the file was written. Do not include counts, summaries of what's inside, or any preview of the document. The user will read the file directly.

## 8. Read-only contract

This contract is non-negotiable:

- You **must not modify any source files** in the repo. The only write you perform is the output document at `{OUTPUT_PATH}`.
- You **must not modify the PR** in any way — no comments, no thread resolves, no labels, no review submissions, no merges.
- You **must not run** any build, install, or formatter command. Only `gh` (read-only subcommands), `git` (read-only subcommands like `diff`, `show`, `log`), `Read`, and `Grep` are appropriate.
- You **may** use `Bash` for shell pipelines that combine the above (e.g., `gh pr diff $N -- file | wc -l`), but never to mutate state.

If you find yourself reaching for a tool that mutates anything other than `{OUTPUT_PATH}`, stop and reconsider — you have likely misread the task.

## Final reminders

- Every file in the files-changed list must appear in the document (full diff or summarized per Section 2).
- Diffs are raw `git diff` output. Headers preserved.
- Chapters are organized by *final state*, not commit order.
- Pure exploration. No fix recommendations.
- Save to `{OUTPUT_PATH}` and stop.
````

- [ ] **Step 2: Verify all sections are present and in order**

Run:

```bash
grep -n "^## " skills/pr-walkthrough/walkthrough-prompt.md
```

Expected:

```
## Provided Context
## 1. Role and framing
## 2. Hard constraint: every changed file appears in the document
## 3. Decomposition heuristics: chapters, sections, sub-sections
## 4. External context (unchanged code)
## 5. Pure exploration, not review
## 6. Output document format
## 7. Save and stop
## 8. Read-only contract
## Final reminders
```

---

## Task 9: Validate, build the zip, and commit

**Files:**
- No new files. The build produces `skills/pr-walkthrough.zip` as a side effect.

- [ ] **Step 1: Run the validator**

```bash
npm --prefix packages/hal-agent-skills run validate-skills
```

Expected: every skill (including `pr-walkthrough`) shows `0 errors`. Script exits 0.

If `pr-walkthrough` reports an error:
- "frontmatter.name does not match directory" → check the SKILL.md frontmatter `name:` matches `pr-walkthrough`.
- "Referenced file 'walkthrough-prompt.md' does not exist" → confirm `skills/pr-walkthrough/walkthrough-prompt.md` exists.
- "frontmatter.description is missing" → check the SKILL.md frontmatter has a `description:` field on a single line.

Fix and re-run before continuing.

- [ ] **Step 2: Run the full build (which packages every skill)**

```bash
npm --prefix packages/hal-agent-skills run build
```

Expected output ends with `✓ Packaging complete` and the lines mention `✓ pr-walkthrough.zip`.

- [ ] **Step 3: Confirm the zip was produced**

```bash
ls -la skills/pr-walkthrough.zip
unzip -l skills/pr-walkthrough.zip
```

Expected: `pr-walkthrough.zip` exists in `skills/`. The `unzip -l` listing shows two entries inside the zip:

```
pr-walkthrough/SKILL.md
pr-walkthrough/walkthrough-prompt.md
```

(Order may vary; the directory entry `pr-walkthrough/` may also be listed.)

- [ ] **Step 4: Commit**

```bash
git add skills/pr-walkthrough/walkthrough-prompt.md skills/pr-walkthrough.zip
git commit -m "$(cat <<'EOF'
skill: complete pr-walkthrough agent prompt and package zip

Adds the full walkthrough-prompt.md (sections 1–8 + final reminders)
and the packaged skills/pr-walkthrough.zip produced by the build
pipeline. The skill is now installable via:

  cp -r skills/pr-walkthrough ~/.claude/skills/

or by uploading skills/pr-walkthrough.zip to a claude.ai project.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Confirm a clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean` (or a clean status with only the unrelated docs/superpowers files if those weren't committed yet — that's fine).

---

## Post-implementation: manual verification (not part of the plan tasks)

The implementation plan is complete after Task 9. The skill itself can only be exercised end-to-end by installing it and invoking it from a Claude Code session. To verify functionally:

1. Install: `cp -r skills/pr-walkthrough ~/.claude/skills/`
2. From a Claude Code session inside any repo with an open PR, type `/pr-walkthrough` (resolves the current branch's PR) or `/pr-walkthrough 1234`.
3. Confirm a file appears at `/tmp/pr-walkthroughs/PR-{N}-{slug}.md` with the expected structure (intro + chapters with diffs + cross-cutting concerns + open questions + commit map).
4. Confirm every file in the PR is referenced somewhere in the output (full diff or summarized).
5. Confirm no source files in the repo were modified and no PR-side actions were taken.

If anything in the output is wrong, the fix is in `walkthrough-prompt.md` — re-edit, re-run `npm --prefix packages/hal-agent-skills run build`, re-install, re-test.

---

## Self-review checklist (run after writing the plan, before handoff)

- [x] **Spec coverage:** Every spec section is implemented.
  - Skill structure (spec §"Skill structure") → Task 1, Task 2 (creates the two files in the right paths)
  - Skill metadata (spec §"Skill metadata") → Task 2 (frontmatter)
  - Controller Step 1 (spec §"Step 1: Resolve target PR") → Task 3 Step 1
  - Controller Step 2 (spec §"Step 2: Fetch PR metadata") → Task 3 Step 1
  - Controller Step 3 (spec §"Step 3: Compute output path and slug") → Task 3 Step 1
  - Controller Step 4 (spec §"Step 4: Dispatch the agent") → Task 4 Step 1
  - Controller Step 5 (spec §"Step 5: Present result") → Task 4 Step 1
  - Announce at start (spec §"Announce at start") → Task 2 Step 1
  - Agent prompt sections 1–9 (spec §"Agent prompt design") → Tasks 5–8
  - Output document format (spec §"Output document format") → Task 7 Step 1
  - Edge cases (spec §"Edge cases & failure modes") → Task 7 Step 1 ("Edge cases to handle" subsection inside the prompt) and Task 4 Step 2 (Red Flags in SKILL.md)
  - Out-of-scope items (spec §"Out of scope") → not implemented (correct)
  - Build/zip (spec §"Implementation notes") → Task 9
- [x] **Placeholder scan:** No "TBD", "TODO", or vague "implement appropriate X" instructions in any task. All bash commands, file contents, and expected outputs are concrete.
- [x] **Type/name consistency:** `PR_NUMBER`, `OUTPUT_PATH`, `SLUG`, `BASE_BRANCH`, `HEAD_BRANCH` used consistently across SKILL.md and prompt placeholders. Sub-section heading pattern `` ### `path/to/file` — Unit name `` consistent in spec, plan, and prompt template.
