---
name: pr-walkthrough
description: Use when you want a structured tour of a GitHub PR — generates a single self-contained HTML page that walks through the final state of the changed code in a digestible order, with GitHub-style side-by-side diffs. For exploration and understanding, not review (use comprehensive-review for review).
---

# PR Walkthrough

Generates a structured "tour" of a GitHub PR — a single self-contained HTML page that walks the reader through the final state of the changed code in an order that makes sense, with GitHub-style side-by-side diffs. The reader leaves with (a) enough context to form an opinion on whether the PR should be merged and (b) a durable mental model of what changed and why.

This skill is **pure exploration**, not review. It explains *what the code is and why it's there*; it does not propose changes, score severity, or recommend fixes. For review, use the `comprehensive-review` skill — the two are designed to be run independently and iteratively.

**Announce at start:** "I'm using the pr-walkthrough skill to generate a structured tour of this PR."

## When to Use

- Onboarding to a PR you didn't write — getting a digestible overview of what's there
- Coming back to a PR weeks later to remember what it did
- Reading along during a PR review to build understanding before judging quality
- Any time `gh pr diff` alone would be too much to skim

## Controller Steps

Follow these steps exactly. Do not skip or reorder.

### Step 1: Resolve target PR

First capture the current branch name (used in the failure message and as a fallback PR lookup):

```bash
BRANCH_NAME=$(git branch --show-current)
```

Then resolve `PR_NUMBER`:

- If the user passed a PR number argument, set `PR_NUMBER` to that argument and skip the next step.
- Otherwise, look up the current branch's open PR:

  ```bash
  PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null)
  ```

- If `PR_NUMBER` is still empty after both attempts, fail with: ``"No PR found for branch `${BRANCH_NAME}`, and no PR number provided. Pass a PR number as an argument."`` and **stop**.

### Step 2: Fetch PR metadata

Once `PR_NUMBER` is known, fetch the metadata the agent needs as its table of contents. Capture the JSON once and extract fields with `jq`:

```bash
PR_JSON=$(gh pr view $PR_NUMBER --json number,title,body,baseRefName,headRefName,author,url,commits,files)
OWNER_REPO=$(gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"')

PR_TITLE=$(echo "$PR_JSON" | jq -r '.title')
PR_BODY=$(echo "$PR_JSON" | jq -r '.body')
BASE_BRANCH=$(echo "$PR_JSON" | jq -r '.baseRefName')
HEAD_BRANCH=$(echo "$PR_JSON" | jq -r '.headRefName')
AUTHOR=$(echo "$PR_JSON" | jq -r '.author.login')
URL=$(echo "$PR_JSON" | jq -r '.url')

# Pre-format the lists for the prompt template (one entry per line):
COMMITS_LIST=$(echo "$PR_JSON" | jq -r '.commits[] | "\(.oid[0:7])  \(.messageHeadline)"')
FILES_LIST=$(echo "$PR_JSON" | jq -r '.files[].path')

# Counts for the output document header:
COMMITS_COUNT=$(echo "$PR_JSON" | jq -r '.commits | length')
FILES_COUNT=$(echo "$PR_JSON" | jq -r '.files | length')

# Fetch the PR head commit so its SHA exists locally (handles fork PRs). The diff
# itself comes from `gh pr diff` (correct for open AND merged PRs, unlike
# `git diff base...head` which goes empty once a PR merges); HEAD_SHA is used only
# to resolve unchanged "context" code from the final (head) state.
git fetch --quiet origin "refs/pull/${PR_NUMBER}/head" 2>/dev/null || true
HEAD_SHA=$(git rev-parse FETCH_HEAD 2>/dev/null || echo "$HEAD_BRANCH")
```

The variables you now have for the prompt template:

- `PR_NUMBER` — the PR number (from Step 1)
- `PR_TITLE` — the title
- `PR_BODY` — the description body (may be empty)
- `BASE_BRANCH` — `baseRefName` (display only)
- `HEAD_BRANCH` — `headRefName` (display only)
- `HEAD_SHA` — immutable head commit, fetched (fork-safe); used to resolve context code
- `AUTHOR` — `author.login`
- `URL` — the PR URL
- `OWNER_REPO` — the `owner/repo` string
- `COMMITS_LIST` — short-sha + headline, one commit per line
- `FILES_LIST` — file paths, one per line
- `COMMITS_COUNT` — number of commits
- `FILES_COUNT` — number of changed files

The full diff is **not** pre-fetched. The agent fetches per-file diffs as it walks through them — this is intentional, to keep the agent prompt small and to scale to large PRs.

### Step 3: Compute output path and slug

Slugify `PR_TITLE` and store the result in `SLUG`:

1. Lowercase
2. Replace any character that is not `[a-z0-9]` with `-`
3. Collapse runs of `-` into a single `-`
4. Trim leading and trailing `-`
5. Cap at 60 characters (cut from the right, then re-trim trailing `-`)
6. If the result is empty, set `SLUG` to the literal string `untitled`

A reference one-liner:

```bash
SLUG=$(echo "$PR_TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-60 | sed -E 's/-+$//')
[ -z "$SLUG" ] && SLUG="untitled"
```

Then compute the output path:

```bash
mkdir -p /tmp/pr-walkthroughs
DATA_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.json"
OUTPUT_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.html"
```

The agent writes `DATA_PATH`; the build step (Step 4b) produces `OUTPUT_PATH`. Both are overwritten on re-run. `/tmp` is ephemeral; re-runs reflect the current PR state.

```bash
# Preflight: the build step needs Node.
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to build the HTML walkthrough. Install Node.js (>=20) and retry." >&2
  exit 1
fi
```

### Step 4: Dispatch the agent

- **Tool:** `Agent` (or `Task`) with `subagent_type: "general-purpose"`
  - Why `general-purpose` and not `Explore`: the agent must `Write` the output document, and the `Explore` subagent is read-only. The read-only contract for repository files is enforced via the prompt itself, not via subagent capabilities.
- **Prompt:** Fill the template from `walkthrough-prompt.md` (sibling of this file), substituting these placeholders with the values from Steps 1–3:
  - `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_BODY}`, `{BASE_BRANCH}`, `{HEAD_BRANCH}`, `{HEAD_SHA}`, `{AUTHOR}`, `{URL}`, `{OWNER_REPO}`, `{COMMITS_LIST}` (formatted as one `sha  headline` per line), `{FILES_LIST}` (formatted as one path per line), `{COMMITS_COUNT}`, `{FILES_COUNT}`, `{DATA_PATH}`

### Step 4b: Build the HTML from the agent's JSON

The agent has written pointer JSON to `DATA_PATH`. Resolve it against git and render the self-contained HTML:

```bash
node /mnt/skills/user/pr-walkthrough/scripts/build-walkthrough.mjs \
  --data "$DATA_PATH" --out "$OUTPUT_PATH" \
  --pr "$PR_NUMBER" --head "$HEAD_SHA"
```

(When running from this repo rather than an installed skill, use `skills/pr-walkthrough/scripts/build-walkthrough.mjs`.)

- On success the script prints `OUTPUT_PATH`.
- On a **validation or resolution failure** the script exits non-zero and prints the errors. Re-dispatch the Step 4 agent **once**, appending the printed errors to the prompt with the instruction to fix them and rewrite `DATA_PATH`, then re-run this build. If it fails a second time, **stop** and report the errors to the user — do not hand-edit the JSON.

### Step 5: Present result

Once the build succeeds, open the result (macOS) and report a single line:

```bash
[ "$(uname)" = "Darwin" ] && open "$OUTPUT_PATH" || true
```

> Walkthrough saved to `/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.html` — open it in a browser.

Do not include counts, previews, or orientation summaries. The document is the artifact; it speaks for itself.

## Red Flags

**Never:**

- Modify any source files in the repo — this skill is read-only with respect to the project tree
- Modify the PR in any way — no comments, no resolves, no labels, no merges
- Continue past Step 1 if no PR can be resolved
- Transcribe diffs or source code into the agent's JSON — the agent emits **pointers only** (`file` + `lines`); the build step resolves the real code from git
- Mark a human-authored source file as `lockfile`/`generated`/`binary` to skip its diff — only genuinely excused files (lockfiles, generated derived files, binaries) get a `note` instead of a resolved `normal` diff; see the prompt for the full exception list
- Replace this skill with `comprehensive-review`. They are independent: this skill explains, that one evaluates

**If the agent fails:**

- Report the failure to the user with the error details. Do not retry automatically.
