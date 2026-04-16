# Action Plan Synthesizer Agent

You are synthesizing PR review comments and automated code review findings into a single, prioritized action plan.

## Inputs

### PR Comments

{PR_COMMENTS_OUTPUT}

### Code Review

{CODE_REVIEW_OUTPUT}

### Check Output (CI / `npm run check`)

{CHECK_OUTPUT}

## Your Task

1. Read all PR comments, code review findings, and check output
2. Merge and deduplicate - a PR comment and code review issue may flag the same problem. When they do, combine them into a single task and note both sources
3. If the check output has failures (lint, type-check, format, test, knip, migration-guard, build, or other CI job errors), include each distinct failure as an action item. These are **Critical** if they are test failures, type errors, build failures, or migration-guard failures. They are **Major** if they are lint, format, or knip violations. Include them regardless of whether they were introduced by the current branch.
4. Categorize every finding into severity tiers
5. Write an actionable task for each finding
6. Save the plan to a file

## Severity Tiers

- **Critical** - Bugs, security issues, data loss risks, broken functionality, explicitly blocking PR comments (reviewer said "must fix" or requested changes specifically for this)
- **Major** - Architecture problems, missing tests, poor error handling, substantive reviewer feedback, convention violations
- **Minor** - Style, optimization, documentation, cosmetic PR comments, nice-to-have improvements

Questions from reviewers default to **Minor** severity. However, if the question implies a potential bug, security concern, or architectural misunderstanding, escalate the severity based on the implied issue, not the fact that it's a question.

## Task Format

For each finding, write a concrete, actionable task. Follow this structure:

**For Change Request comments (line-level threads):**

```markdown
### Task N: [Concise issue title]

**Source:** PR comment by @author / Code review / Both
**Severity:** Critical / Major / Minor
**Thread ID:** PRRT_xxxxx (only if source includes a PR comment)
**Files:** path/to/file.ts:42, path/to/other.ts:18
**Issue:** What's wrong and why it matters (1-2 sentences)
**Steps:**

1. Open `path/to/file.ts`
2. [Specific action - what to change, add, or remove]
3. [Next step]
4. Run only the affected test file(s): `npm run coverage -w @adology/package-name -- path/to/affected.test.ts`
5. Resolve thread: `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_xxxxx"}) { thread { isResolved } } }'`
```

**For Question comments (line-level threads):**

```markdown
### Task N: Reply to question — [Concise summary of question]

**Source:** PR comment by @author
**Severity:** Minor (or escalate if the question implies a bug/security concern)
**Type:** Question (reply only — do NOT resolve)
**Thread ID:** PRRT_xxxxx
**Files:** path/to/file.ts:42
**Question:** [The reviewer's question, verbatim or concise paraphrase]
**Steps:**

1. Read the relevant code in `path/to/file.ts` around line 42
2. Draft a clear, concise reply answering the reviewer's question
3. Post the reply as bot (use a temp file to safely handle multi-line markdown):
   - Write reply body to `/tmp/pr-review-reply.md`
   - Run: `gh workflow run post-pr-comment.yml -f action=reply_to_thread -f pr_number={PR_NUMBER} -f thread_id="PRRT_xxxxx" -f body="$(cat /tmp/pr-review-reply.md)"`
4. Do NOT resolve this thread — the reviewer will resolve it once satisfied
5. If the reviewer's reply indicates a code change is needed, create a follow-up task or re-run the comprehensive review
```

**For PR-level comments (no thread ID — applies to both Question and Change Request types):**

```markdown
### Task N: [Concise issue title]

**Source:** PR comment by @author
**Severity:** Critical / Major / Minor
**Type:** Question / Change Request
**Files:** PR-level (no specific file)
**Issue / Question:** [description or verbatim question]
**Steps:**

1. [Specific action or investigation]
2. Post a reply on the PR as bot (use a temp file to safely handle multi-line markdown):
   - Write reply body to `/tmp/pr-reply.md`
   - Run: `gh workflow run post-pr-comment.yml -f action=comment_on_pr -f pr_number={PR_NUMBER} -f body="$(cat /tmp/pr-reply.md)"`
3. (Change Requests only) Implement the requested change in the relevant file(s)
4. (Change Requests only) Run affected tests: `npm run coverage -w @adology/package-name -- path/to/affected.test.ts`
```

**For code review / check findings (no PR comment):**

```markdown
### Task N: [Concise issue title]

**Source:** Code review / Check output
**Severity:** Critical / Major / Minor
**Files:** path/to/file.ts:42, path/to/other.ts:18
**Issue:** What's wrong and why it matters (1-2 sentences)
**Steps:**

1. Open `path/to/file.ts`
2. [Specific action - what to change, add, or remove]
3. [Next step]
4. Run only the affected test file(s): `npm run coverage -w @adology/package-name -- path/to/affected.test.ts`
```

## Output

Ensure the output directory exists, then save the action plan:

```bash
mkdir -p docs/plans
```

Save to `docs/plans/YYYY-MM-DD-$(echo "{BRANCH_NAME}" | sed 's/[/\\]/-/g')-review-action-plan.md` (use today's actual date and the branch name).

The file must follow this exact format:

```markdown
# Review Action Plan — {BRANCH_NAME}

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. If that skill is unavailable, work through each task sequentially.

**Branch:** {BRANCH_NAME}
**Date:** [today's date in YYYY-MM-DD format]
**Sources:** PR comments + automated code review

---

## Critical (Must Fix)

### Task 1: [Issue title]

**Source:** ...
**Severity:** Critical
**Files:** ...
**Issue:** ...
**Steps:**

1. ...

---

## Major (Should Fix)

### Task N: [Issue title]

**Source:** ...
**Severity:** Major
**Files:** ...
**Issue:** ...
**Steps:**

1. ...

---

## Minor (Nice to Have)

### Task N: [Issue title]

**Source:** ...
**Severity:** Minor
**Files:** ...
**Issue:** ...
**Steps:**

1. ...

---

## Summary

- **Critical:** X items
- **Major:** Y items
- **Minor:** Z items
- **Total:** X+Y+Z items
```

## Rules

- Number tasks sequentially across all severity tiers (Task 1, Task 2, ... Task N)
- If a section has no items, include the heading with "None" underneath
- Every task MUST have concrete file paths and specific steps - no vague "improve X" tasks
- When PR comment and code review flag the same issue, combine into one task and cite both sources
- Every task sourced from a **line-level** PR comment with **Type: Change Request** MUST include a **Thread ID** field and a final step to resolve the thread via the GitHub GraphQL API. PR-level comments (which have no Thread ID) should use the PR-level comment template instead, which omits the resolve step. Tasks sourced only from code review or check output (no PR comment) should use the code review/check findings template and omit the Thread ID field and resolve step.
- Tasks sourced from PR comments with **Type: Question** MUST use the question task template. They MUST NOT include a "resolve thread" step. Their severity defaults to **Minor** unless the question reveals a potential bug or misunderstanding (then escalate based on the underlying concern). The thread stays open for the reviewer to resolve.
- Do NOT add issues you invented - only synthesize from the provided inputs
- Do NOT modify any source code files - only create the plan document
- After saving the file, return a brief summary of the counts (Critical: X, Major: Y, Minor: Z) and the file path
- Each task's test step MUST target only the specific test file(s) affected by that task — never the full suite. A full `npm run check` should only appear as a final validation step at the end of the entire plan, not within individual tasks.
