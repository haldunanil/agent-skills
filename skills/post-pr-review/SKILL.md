---
name: post-pr-review
description: Use when the user pastes an exported pr-walkthrough review JSON (an object with `comments`/`fileComments`, a `repo`, `pr`, and `commit`) and wants those comments posted to the GitHub PR. Triggers like "post my walkthrough review", "post these PR comments", "submit this review to the PR".
---

# Post PR Review

Takes a review JSON exported from a pr-walkthrough HTML page (via its **Copy review** button) and posts it to the GitHub PR as **one batched review** plus any file-level comments, using `gh`.

**Announce at start:** "I'm using the post-pr-review skill to post your walkthrough comments to the PR."

## Controller Steps

### Step 1: Capture the review JSON

The user has pasted a JSON object that looks like:

```jsonc
{ "repo": "owner/name", "pr": 5, "commit": "<sha>", "body": "",
  "comments": [ { "path": "...", "side": "RIGHT", "line": 12, "body": "..." } ],
  "fileComments": [ { "path": "...", "body": "..." } ] }
```

Write it **verbatim** to a temp file using the `Write` tool:

```
/tmp/pr-reviews/review.json
```

(Create `/tmp/pr-reviews/` first with `mkdir -p /tmp/pr-reviews`.) Do not edit the user's comment text.

### Step 2: Post it

```bash
node /mnt/skills/user/post-pr-review/scripts/post-review.mjs /tmp/pr-reviews/review.json
```

(From this repo rather than an installed skill, use `skills/post-pr-review/scripts/post-review.mjs`.)

- On success the script prints `{ "ok": true, "posted": [...] }` with the created review/comment URLs. Report the review URL to the user.
- On a **validation error** it exits non-zero and prints what's wrong with the JSON — relay it and stop (do not guess fixes to the user's comments).
- On a **`gh` error** (not authenticated, no network, PR not found) it prints the error and any comments already posted — relay both so the user can re-auth and retry. **If "Already posted" includes a `review`**, warn the user that re-running posts a *duplicate* review (GitHub reviews are not idempotent); they should re-auth and post only the remaining file comments individually rather than re-running the whole review.

### Step 3: Report

Tell the user how many comments posted and link the review. Nothing else.

## Red Flags

**Never:**
- Merge, close, approve, or request-changes on the PR — this skill only **creates comment**s (`event=COMMENT`).
- Edit, reword, or "improve" the user's comment text — post it verbatim.
- Invent comments that weren't in the pasted JSON.
- Retry automatically on a `gh` auth failure — surface it and let the user re-auth.
