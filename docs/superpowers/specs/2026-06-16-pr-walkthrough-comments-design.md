# PR Walkthrough — in-viewer commenting + post-to-GitHub — Design

**Date:** 2026-06-16
**Status:** Approved for planning
**Builds on:** the pr-walkthrough HTML viewer (`docs/superpowers/specs/2026-06-16-pr-walkthrough-html-design.md`)

## Goal

Let a reader of a pr-walkthrough HTML page leave **GitHub-style review comments** — select a range of lines in the split diff (via the line-number gutter) to comment on, or comment on a whole file — then get those comments onto the **real GitHub PR**.

The walkthrough is a self-contained, offline file with no backend. So comments are **authored offline** in the viewer, **exported** as JSON, **pasted to Claude**, and posted to the PR by a **new `post-pr-review` skill** that uses the user's existing `gh` auth. No credential ever lives in the browser.

## Non-goals

- Live in-browser posting via a pasted GitHub token (rejected: a credential in a static file is a security liability).
- Replying to / resolving *other people's* existing PR comments (reading those is `review-pr-comments`'s job; this authors new comments only).
- GitHub "suggested change" blocks, threaded replies, or review approval/request-changes states (this posts a plain `COMMENT` review).

## Decisions log (with rejected alternatives)

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Where comments go | **The real GitHub PR** | Local-only notes; export-only | User intent: real PR review comments. |
| Auth / posting path | **Author offline → export → paste to Claude → post via `gh`** | Browser posts live via a pasted token | No credential in the browser; reuses the `gh` auth the skill already depends on. |
| Posting trigger | **A new Claude-callable skill (`post-pr-review`)** | User runs a script by hand; viewer copies raw `gh` commands | Fits the agent ecosystem; reproducible and testable; one paste → posted. |
| Line selection | **GitHub-style gutter** (hover `+`, drag the gutter for a range) | Drag across the code rows | GitHub-exact; doesn't fight native text-selection; makes the old/new side unambiguous. |
| Comment display | **Inline threads under the line + 💬 gutter marker + Review panel** | Gutter markers + panel only | The GitHub feel the user asked for; comment stays next to its code. |
| Batching | **One batched review** (`event=COMMENT`) for line comments | Individual comments posted live | Forced by the offline author-then-post model; one review, one notification. |

## Architecture & components

Three components plus the JSON contract between the viewer's export and the posting skill.

```
skills/pr-walkthrough/                      # MODIFIED
  assets/viewer.js                          # + commenting UI (authoring, threads, Review panel, export)
  assets/styles.css                         # + comment/thread/panel styles
  scripts/build-walkthrough.mjs             # + carry pr.commit (head SHA) through; validate it
  walkthrough-prompt.md                     # + pr.commit in the JSON shape
  SKILL.md                                  # (pr.commit already available as {HEAD_SHA})

skills/post-pr-review/                      # NEW SKILL
  SKILL.md                                  # controller: take pasted review JSON → post via the script
  scripts/post-review.mjs                   # Node + gh: create one batched review + file-level comments
  scripts/post-review.test.mjs              # node:test with an injected fake `gh`
  test/fixture.json                         # sample review JSON (optional; or inline in tests)
```

**Data contract — the review JSON** (viewer export ⇄ posting skill input):

```jsonc
{
  "repo": "owner/name",
  "pr": 5,
  "commit": "<head commit sha>",
  "body": "optional overall review note",
  "comments": [
    { "path": "src/a.ts", "side": "RIGHT", "line": 12, "startLine": 11, "body": "markdown" }
  ],
  "fileComments": [
    { "path": "src/a.ts", "body": "markdown" }
  ]
}
```

- `side` is `"LEFT"` (old/base) or `"RIGHT"` (new/head).
- `line` is the line number on that side; `startLine` (optional) makes it a multi-line comment (`startLine`..`line`, same side, within one hunk).
- `fileComments` carry no line — they attach to the whole file.

## Component 1 — Viewer commenting (`viewer.js` + `styles.css`)

**Selection → anchor.** The split view has two line-number gutters. Hovering a gutter cell shows a **+**; clicking comments on that single line; pressing and dragging **down the same gutter** selects a contiguous range. The **left** gutter anchors to `side: LEFT` (base line numbers), the **right** gutter to `side: RIGHT` (head line numbers). The viewer already renders both line numbers per row, so the anchor is read directly off the cells. A range is clamped to a single hunk (GitHub requires single-hunk multi-line comments).

**Composer.** Selecting opens an inline composer (a `<tr>` with a `colspan` cell, or a block inserted after the anchor row): a `textarea` + **Add comment** / **Cancel**. File-level: a **💬 Comment on file** button in the sticky file header opens the same composer, producing a `fileComments` entry.

**Inline threads.** A saved comment renders as a card inserted right under its anchor line (full-width row), showing the body (rendered with the page's markdown-it if present, else plain text), and **edit** / **delete** actions. The anchor line's gutter gets a **💬** marker.

**Review panel.** A floating **📝 Review (N)** pill (bottom-right). Expanded, it lists every pending comment (`path` + line/`(file)` + snippet, with edit/delete that jump to the thread), and a footer with **Copy review** (primary) and **Clear**. With zero comments, Copy/Export is disabled.

**Export.** **Copy review** serializes the comments to the review JSON above and writes it to the clipboard (with a download fallback). `repo`, `pr`, and `commit` come from the embedded walkthrough data.

**Persistence.** Comments are stored in `localStorage` under `pr-walkthrough:<repo>#<pr>`, loaded on open, so a reload — or regenerating the walkthrough — keeps them. On load, each comment re-anchors by `path` + `side` + `line`; if that line no longer exists in the (possibly regenerated) diff, the comment is kept and shown in the Review panel flagged **outdated** (never silently dropped; still exportable).

**Progressive enhancement.** Commenting is plain DOM + `localStorage`; it works with or without the CDN libs. (markdown-it, if loaded, renders comment bodies; otherwise they show as text.)

## Component 2 — Build change (carry the head SHA)

The viewer needs `commit` (head SHA) to anchor GitHub comments. The controller already resolves `HEAD_SHA`. Thread it through:

- `walkthrough-prompt.md`: the `pr` object in the JSON shape gains `"commit": "{HEAD_SHA}"`.
- `build-walkthrough.mjs` `validateShape`: `pr.commit` is a required string.

No other build change — `commit` is just another `pr` field embedded in the data the viewer reads.

## Component 3 — Posting skill (`post-pr-review`)

**Trigger.** `SKILL.md`'s description matches when the user pastes an exported review and asks to post it ("post my walkthrough review", "post these PR comments", a pasted blob with `comments`/`fileComments`).

**Controller (`SKILL.md`).** Take the pasted review JSON → validate its shape → write it to a temp file → run `scripts/post-review.mjs <file>` → report what posted (and the review URL).

**`scripts/post-review.mjs`** (Node, stdlib + `gh`):

- Validate the review JSON (shape: required `repo`/`pr`/`commit`, well-formed `comments`/`fileComments`, `side` enum, line ints).
- **Line comments → one batched review:** `gh api repos/{repo}/pulls/{pr}/reviews` with `{ commit_id, event: "COMMENT", body, comments: [{ path, line, side, start_line?, start_side?, body }] }`.
- **File-level comments → `subject_type=file`:** posted via `gh api repos/{repo}/pulls/{pr}/comments` with `{ commit_id, path, body, subject_type: "file" }` each. *(The reviews `comments[]` array may not accept file-level entries — to verify against the API during implementation; fallback is to fold file comments into the review `body` as `**path**: …`.)*
- `gh` is invoked through a small injected runner (default: real `gh` via `execFileSync`) so tests pass a **fake `gh`** and assert the constructed API calls without network.
- **Safety:** only ever *creates* review comments — never merges, closes, approves, or requests changes. On a `gh`/API error it reports which comments posted (if any) so the user can retry the rest.

## Edge cases

- **No comments** → Copy/Export disabled; nothing to post.
- **Multi-line selection crossing a hunk boundary** → clamp to the hunk (GitHub rejects cross-hunk ranges).
- **Comment on a context line** → allowed; the side is whichever gutter was used.
- **Outdated comment after regeneration** (anchor line gone) → flagged in the Review panel, still exportable.
- **`gh` not authenticated / not installed** → the post skill fails loudly with the `gh` error and how to fix it.
- **Empty or malformed pasted JSON** → the post skill's validation rejects it with a clear message.
- **Partial failure mid-post** → report posted vs. remaining; the operation is not silently half-done.

## Testing

- **Viewer (headless Chrome):** add a line comment via the right gutter and a file comment via the header button; assert the inline thread renders, the gutter marker appears, the Review panel count updates, the exported JSON matches the contract (correct `path`/`side`/`line`/`startLine`), and that comments round-trip through `localStorage` on reload.
- **`post-review.mjs` (`node:test`, fake `gh`):** from a sample review JSON, assert it builds the correct `reviews` API payload for line comments, the correct `subject_type=file` calls for file comments, routes line vs. file correctly, validates a malformed review, and reports partial failure. Mirrors the build script's injected-dependency test pattern.
- **Build:** `validateShape` requires `pr.commit`, and the prompt's JSON shape shows it.
- **Manual end-to-end:** author a comment on a real walkthrough, Copy review, paste to Claude, confirm `post-pr-review` creates the review on a throwaway PR.

## Future / out of scope

- Replying to or resolving existing PR comments (see `review-pr-comments`).
- Suggested-change blocks; approve/request-changes review states.
- Live in-browser posting (token model).
