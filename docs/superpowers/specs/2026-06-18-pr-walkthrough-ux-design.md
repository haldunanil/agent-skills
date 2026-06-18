# pr-walkthrough UX overhaul — design

**Date:** 2026-06-18
**Status:** Approved (brainstorm), pending implementation plan
**Skills touched:** `pr-walkthrough` (PR 1), `post-pr-review` (PR 2)

## Context

`pr-walkthrough` generates a single self-contained HTML page that tours a GitHub PR:
the build step (`build-walkthrough.mjs`) resolves `gh pr diff` into per-file/per-unit
sections and inlines `viewer.js` / `comments.js` / `styles.css` into the page. The page is
**fully offline** — it never calls GitHub at runtime. Review comments are authored in the page
and exported as JSON (the "Copy review" button); `post-pr-review` later posts them with `gh`.

Eight pieces of reviewer feedback motivate this overhaul. They cluster into four page-side
changes (sidebar, collapse/viewed model, sticky headers, comment composer) plus one cross-skill
addition (syncing "viewed" state to GitHub). Because the page is offline, "mark a file viewed on
GitHub" cannot happen live from the page — it is exported and applied by a `gh` step.

## Decisions (from brainstorm)

- **Viewed sync mechanism:** page tracks viewed state locally → exports `viewedFiles` → a `gh`
  step calls GitHub's `markFileAsViewed`. No token in the browser; page stays offline.
- **Comment editor:** GitHub-style Markdown editor (toolbar + Write/Preview tabs), Markdown under
  the hood so the export shape is unchanged. Not WYSIWYG.
- **Test grouping:** auto-detected by filename heuristic, rendered as sidebar nesting only (main
  content order unchanged).
- **Sidebar look:** Variant A (information-rich) with the directory path as a dimmed sub-line
  under the basename (from Variant B).
- **Viewed is a per-path roll-up**, computed across all chapters — a file's hunks may be scattered
  across the narrative.
- **Sync home + shipping:** extend `post-pr-review`; ship as **two PRs** (page first, sync second).

## Glossary

- **Section / block** — one rendered unit in the main column: a file, or a "unit" (a line-range
  subset of a file's hunks). The agent authoring the walkthrough decides sections and may split
  one file's hunks across several sections/chapters.
- **Hunk** — a `@@ … @@` group within a section's resolved diff. New unit of collapse.
- **read** (amber, local) — a hunk/block is collapsed. Per block. localStorage only.
- **Viewed** (green, GitHub) — every hunk of a *path* across all chapters is collapsed **and** the
  walkthrough covers that file's complete diff. Per path. Drives `viewedFiles` export.

---

## PR 1 — pr-walkthrough page

### 1. Sidebar redesign (feedback: "sidebar hard to read", "group files with tests")

Per-chapter list of file rows. Each row is two lines:

```
[✓] basename.ts            +24 −6   💬2
    src/dir/path/            (dimmed, left-truncated)
```

- Bold basename on top; dimmed directory path beneath, truncated from the **left** so the
  meaningful tail stays visible. Exact `+/−` counts retained (tabular).
- Left checkbox shows **read** (amber tick) / **Viewed** (green tick) / empty.
- Comment-count badge (`💬N`) when the path has comments.
- Active row: subtle background + left blue accent bar.
- Larger vertical padding / click targets; hover background.

**Test nesting:** within a chapter, a test file whose source is also present **in the same
chapter** renders indented beneath that source row (tree connector). Detection is a filename
heuristic in the build step:

| Test pattern | Source |
|---|---|
| `X.test.EXT`, `X.spec.EXT` | `X.EXT` |
| `test_X.py` | `X.py` |
| `X_test.go` | `X.go` |
| `__tests__/X.EXT` | sibling `X.EXT` |

Pairing only applies when the source path is also changed in the PR. Cross-chapter pairs are left
as normal rows (no reordering). Grouping is presentation-only — chapters and main order are
untouched. (ponytail: same-chapter-only keeps it a pure sidebar concern; revisit if real PRs need
cross-chapter nesting.)

### 2. Collapse → read → Viewed (feedback: items 2, 3, 4)

- **Per-hunk collapse** (new). Each hunk gets a caret in a hunk sub-header. Collapsing a hunk
  marks it **read**. A section/block header collapse toggles all its hunks.
- **Viewed is computed per path.** The build step emits, per path: the list of all hunk ids the
  walkthrough shows, and a `fullyCovered` boolean (does the union of shown hunks equal the file's
  complete diff?). The viewer marks a path **Viewed** when every shown hunk id for that path is
  read **and** `fullyCovered` is true.
- **Partial-coverage paths** (`fullyCovered === false`) can reach *read* but never *Viewed*; their
  sidebar checkbox tops out at amber, with a tooltip explaining why.
- All sidebar rows for a split path share one Viewed state and flip together.
- Toggling a sidebar Viewed checkbox collapses/expands all of that path's hunks to match.

**Hunk identity:** `\`${path}@${newStart}\`` (new-side start line is unique within a file's diff).
Stable across reloads for localStorage.

**State:** localStorage gains `readHunks` (set of hunk ids) and `viewedPaths` (derived, but cached)
under the existing `pr-walkthrough:<repo>#<pr>` key family, alongside comments.

### 3. Sticky block headers (feedback: "sticky the file name")

Block headers are already `position: sticky`. Make them reliably stick **below the top toolbar**
(account for the toolbar height via a CSS offset / `scroll-margin`) so the filename + collapse
caret stay reachable while scrolling a long block, without overlap or z-index glitches.

### 4. Comment composer (feedback: "rich text full width", "suggest code")

Replace the plain `<textarea>` with a full-width composer:

- **Toolbar:** Bold, Italic, inline Code, Code block, Link, Quote, List — each wraps/insets the
  selection in the textarea (plain DOM, no deps).
- **Write / Preview tabs:** Preview renders the Markdown with the already-loaded `markdown-it`.
- **Suggest button:** inserts a fenced ` ```suggestion ` block prefilled with the exact selected
  source line(s) (multi-line selection → multi-line suggestion), ready to edit.
- Markdown stays the storage + export format. The comment/file-comment export shape is **unchanged**
  — a suggestion is just a comment whose body contains a ` ```suggestion ` block, which GitHub
  renders as a one-click "Commit suggestion" when posted verbatim (no `post-pr-review` change for
  suggestions).

### 5. Export shape addition

`exportReview()` adds one field:

```jsonc
{
  "repo": "...", "pr": 5, "commit": "...", "body": "",
  "comments": [ … ],          // unchanged
  "fileComments": [ … ],      // unchanged
  "viewedFiles": ["src/auth/tokens.ts", …]   // NEW: paths currently Viewed (green)
}
```

`viewedFiles` lists only fully-covered, fully-collapsed paths at export time. Empty array when none.

### Where the logic lives (testability)

Keep pure computation in the **build step** (unit-tested) and keep `viewer.js` as thin DOM glue:

- `build-walkthrough.mjs` computes: test↔source pairing map, per-path hunk-id lists, per-path
  `fullyCovered` flags, and injects them into the page data. (Reuses existing `splitDiff` /
  `selectHunks`.)
- `viewer.js` renders sidebar + blocks, tracks collapse/read, and rolls up read→Viewed using the
  build-provided per-path hunk lists.
- `comments.js` owns the composer + export.

### PR 1 tests

`build-walkthrough.test.mjs` additions (stdlib `node:test`):

- Test-pairing heuristic: a table of `(test path, changed paths) → expected source | none`.
- `fullyCovered`: full-coverage file → true; unit/partial file → false.
- Hunk-id assignment present and stable in the emitted data.
- Pairing map / per-path hunk lists present in the page data; cross-chapter pair not nested.

`node --check` on `viewer.js` and `comments.js` stays in CI. (Browser glue stays thin precisely
because it's not unit-tested.)

---

## PR 2 — post-pr-review: sync viewed files to GitHub

`post-pr-review` already consumes the exported JSON. Extend it to honor `viewedFiles`.

### Behavior

After posting comments (existing flow), if `viewedFiles` is non-empty:

1. Resolve the PR node id once:
   `gh api graphql -f query='query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){id}}}' -F o=<owner> -F n=<name> -F p=<pr>`
2. For each path, call the mutation:
   `mutation($id:ID!,$path:String!){ markFileAsViewed(input:{pullRequestId:$id, path:$path}){ clientMutationId } }`

- **Mark only, never unmark** — collapsing then expanding before export simply omits the path; the
  step does not call `unmarkFileAsViewed`. (ponytail: one direction covers the use case.)
- Reuse `post-review.mjs`'s injectable `gh` runner pattern (`execFileSync`, overridable in tests).
- `viewedFiles` is **independent of comments**: a payload with only `viewedFiles` (no comments)
  just marks files viewed. Report counts of comments posted + files marked.
- Validation: `viewedFiles` (if present) must be an array of non-empty strings; ignore/empty-skip
  otherwise. Path-not-found from GitHub is surfaced like other `gh` errors (relayed, not fatal to
  the whole run beyond that path) and benefits from the existing 422/`GH_DEBUG` retry guidance.

### PR 2 changes

- `post-review.mjs`: accept `viewedFiles`, add `markFilesViewed(r, {gh})` (graphql id fetch + per-
  path mutation), call it after comments; extend `validateReview`.
- `SKILL.md`: document the new field and the marking step.
- `post-review.test.mjs`: validation of `viewedFiles`; `markFilesViewed` issues one id query + one
  mutation per path (fake `gh`); empty/absent array is a no-op; comments-only and viewed-only
  payloads both work.

---

## Build / packaging

Standard: edit `skills/<name>/…`, rerun `npm --prefix packages/hal-agent-skills run build` to
regenerate the affected `.zip`(s). Add a changeset per PR (`hal-agent-skills-build`, `minor` for
PR 1's user-visible features, `minor` for PR 2's new field). Note: `comprehensive-review.zip` is
stale on `main` (pre-existing) — do not touch it here.

## Out of scope (YAGNI)

- True WYSIWYG editing; live GitHub API calls from the page; tokens in HTML.
- `unmarkFileAsViewed` syncing.
- Reordering main content for test grouping (sidebar nesting only).
- Cross-chapter sidebar nesting of tests.
- Rendering a full suggestion diff preview beyond the markdown-it Preview tab.

## Verification

- PR 1: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`;
  `node --check skills/pr-walkthrough/assets/viewer.js assets/comments.js`; build a walkthrough for
  a real PR (including a split file and a source+test pair) and confirm in-browser: sidebar
  readability + nesting, per-hunk collapse, read→Viewed roll-up across chapters, partial-coverage
  never reaching Viewed, sticky headers, composer toolbar/preview/suggest, and that exported JSON
  carries `viewedFiles`.
- PR 2: `node --test skills/post-pr-review/scripts/post-review.test.mjs`; against a scratch PR, run
  `post-review.mjs` on an export with `viewedFiles` and confirm the Files-changed tab shows those
  files checked.
