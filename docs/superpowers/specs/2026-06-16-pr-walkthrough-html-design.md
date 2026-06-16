# PR Walkthrough → HTML viewer — Design

**Date:** 2026-06-16
**Status:** Approved for planning
**Skill:** `skills/pr-walkthrough/`

## Goal

Change the `pr-walkthrough` skill so its output is a **self-contained HTML page**
instead of a markdown file. The page presents the PR as digestible chunks with
**GitHub-style side-by-side (split) diffs**, so a reader can reason through the
changes more easily than scanning raw `gh pr diff`.

The HTML appearance must be a **reusable, versioned UI** that lives in the repo.
The walkthrough-generating agent assembles **content only** (narratives plus
*pointers* to where the changed code lives) and never touches markup, styling, or
the diffs themselves. The presentation layer renders that content deterministically.

This skill remains **pure exploration, not review** — unchanged in purpose. Only
the output format and the content/presentation split change.

## Non-goals

- Code review, severity scoring, or fix recommendations (still `comprehensive-review`'s job).
- A unified/inline diff toggle (split only; easy to add later).
- File search/filter, multi-PR views, or any server. The artifact is one file you open.
- Keeping a markdown output path. HTML replaces markdown.

## Decisions log (with rejected alternatives)

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Viewer layout | **A — sticky chapter/file sidebar + one long scroll, split diffs** | B (chapter pager), C (narrative-first, diffs collapsed) | Closest to GitHub "Files changed"; jump-anywhere navigation. |
| Syntax highlighting | **highlight.js via pinned CDN + SRI, as progressive enhancement** | Vendoring hljs; plain (no token colors) | Light repo, trivial upgrades, smaller output files; offline still renders (just uncolored). |
| Content/UI split | **Approach 1: pointer JSON + committed viewer template + deterministic merge** | HTML fragments authored by agent; SPA fetching a JSON sidecar | Only approach that keeps the agent fully out of appearance; `fetch()` is CORS-blocked over `file://`, so a sidecar can't be opened directly. |
| Code in the JSON | **Pointers (file + line range), resolved from git at merge time** | Agent inlines raw diff/code text | Saves output tokens and guarantees git-exact fidelity (no LLM transcription drift). |
| Validation | **Plain Node stdlib, two-layer (shape + referential integrity)** | zod | zod can't be CDN-loaded server-side (Node network-imports are experimental/removed); pointers shrink the schema to a shallow shape check. Bundling zod via esbuild is the documented upgrade path if the schema grows. |
| Rich text in prose | **Agent writes markdown; viewer renders via markdown-it (CDN, pinned + SRI, `html: false`)** | Hand-rolled markdown; a raw-HTML-allowing renderer | "Don't reinvent"; markdown degrades to legible raw text when offline; `html: false` escapes raw HTML, so no XSS from PR-derived text. |

## Architecture

### File layout (`skills/pr-walkthrough/`)

```
SKILL.md                 # controller — updated
walkthrough-prompt.md    # agent prompt — rewritten to emit pointer JSON
assets/
  template.html          # Layout-A skeleton; pinned CDN <script>/<link> for hljs (+SRI); token slots
  viewer.js              # render JSON→DOM; unified→split diff parser; sidebar nav; lazy highlight
  styles.css             # Layout-A theme (sidebar, sticky headers, split diff coloring)
scripts/
  build-walkthrough.mjs  # plain Node: validate + resolve pointers via git + inline → standalone HTML
  test-build.mjs         # tests (see Testing)
test/
  fixture.json           # sample pointer-JSON walkthrough for tests
```

No vendored third-party JS. highlight.js is referenced from a CDN in `template.html`.

### Runtime pipeline

1. **Controller** resolves the PR and metadata (`PR_NUMBER`, `BASE_BRANCH`,
   `HEAD_BRANCH`, title, author, counts, etc.) — essentially as today.
2. **Controller** computes paths under `/tmp/pr-walkthroughs/`:
   - `DATA_PATH = PR-<n>-<slug>.json` (agent's content)
   - `OUTPUT_PATH = PR-<n>-<slug>.html` (final artifact)
3. **Controller dispatches the agent** (`general-purpose`) with the filled
   `walkthrough-prompt.md`. The agent reads diffs to *understand* the PR, writes
   **pointer JSON** to `DATA_PATH`, then self-validates with
   `node scripts/build-walkthrough.mjs --validate DATA_PATH`, fixing until it passes.
4. **Controller runs the resolver/merge:**
   `node scripts/build-walkthrough.mjs --data DATA_PATH --out OUTPUT_PATH --base BASE_BRANCH --head HEAD_BRANCH`
   which validates, resolves every pointer against git, inlines `styles.css` +
   `viewer.js` + the resolved data into `template.html`, and writes `OUTPUT_PATH`.
   On failure: re-dispatch the agent **once** with the validator/resolver errors
   appended; if it still fails, hard-stop and surface the errors.
5. **Controller reports** `OUTPUT_PATH` (and `open`s it on macOS).

Three crisp boundaries: **agent = pointers + prose**, **resolver = git
materialization + validation**, **viewer = render**.

## Content model (the pointer JSON the agent writes)

No `diff` string and no `code` string anywhere — only pointers and prose.

```jsonc
{
  "pr": {
    "number": 482, "repo": "acme/widgets", "title": "...", "author": "...",
    "headBranch": "...", "baseBranch": "...", "url": "...",
    "filesCount": 12, "commitsCount": 4
  },
  "summary": "Markdown — 1–3 sentence orientation, in the agent's voice",
  "chapters": [
    {
      "id": "schema",                  // slug → sidebar anchor
      "title": "Schema",
      "intro": "Markdown — 2–4 sentence chapter narrative",
      "sections": [
        {
          "file": "src/user.ts",
          "unit": null,                // or "Component A" — sub-section within one file
          "lines": null,               // or [start,end] in the NEW file → selects which hunks to show
          "kind": "normal",            // normal | lockfile | generated | binary
          "narrative": "Markdown — what this file does and why it changed",
          "contexts": [                // unchanged-code pointers (optional)
            { "ref": "src/helper.ts", "lines": [42, 58], "note": "Markdown — ..." }
          ],
          "note": "...",               // lockfile / generated / binary only (no diff fetched)
          "derivedFrom": "src/schema.ts" // generated only
        }
      ]
    }
  ],
  "crossCutting": "Markdown — observational notes (bullets, bold, inline code…)",
  "openQuestions": "Markdown — questions for the author (bullets…)",
  "commitMap": [ { "sha": "abc1234", "message": "Add auth schema", "chapters": ["Schema"] } ]
}
```

The viewer derives the table of contents, the +/− counts, and the syntax
highlighting language (from file extension) on its own. The agent provides none
of those.

`pr.repo` is the explicit `owner/repo` string (e.g. `acme/widgets`), populated
from the controller's existing `OWNER_REPO` and carried straight through — the
viewer shows it as `owner/repo #<number>` in the header rather than parsing it
back out of `url`.

**All prose fields are markdown** — `summary`, chapter `intro`, section
`narrative`, context `note`, `crossCutting`, and `openQuestions`. The agent
writes bold/italic, inline code, bullet lists, and sub-headings using ordinary
markdown, matching the texture of Graphite's "tour" prose blocks. Diffs are
*not* markdown — they are resolved from git and drawn by the split-diff renderer.
`crossCutting` and `openQuestions` change from string arrays to single markdown
strings so the agent owns their list formatting.

This is a near-mechanical translation of the current markdown structure (same
chapters → sections → sub-sections; same lockfile/generated/binary exceptions;
same context callouts, cross-cutting, open-questions, commit-map) expressed as
pointer data instead of formatted prose.

## Resolver / merge (`build-walkthrough.mjs`, plain Node)

Modes: `--validate <data>` (shape + referential checks, exit non-zero on failure)
and `--data <data> --out <html> --base <ref> --head <ref>` (validate, resolve, render).

**Per section:**
- `kind: normal` → `git diff <base>...<head> -- <file>`. If `lines` is set, slice
  to the hunks whose **new-file** range overlaps `[start,end]` (this is how
  sub-sections show only their slice). Embed the **git-exact** diff into the data
  the viewer reads.
- `contexts[]` → `git show <base>:<ref>` (or working-tree read), slice to `lines`,
  embed the unchanged code.
- `kind: lockfile | generated | binary` → no fetch; carry the `note`
  (and `derivedFrom` for generated).

**Diff fetching is injected**, not hard-wired: `build-walkthrough.mjs` takes a
`diffProvider` function defaulting to the git implementation. Tests pass a fake
provider with canned diffs so the slicer and renderer are exercised without a live
PR or repo state.

**Inlining into `template.html`:** replace token slots with `<style>styles.css</style>`,
`<script>viewer.js</script>`, and the resolved data as
`<script id="walkthrough-data" type="application/json">…</script>`. The embedded
JSON has `</script` escaped to `<\/script` so diff text can't break out of the slot.

### Two-layer guarantee that the output is well-formed

1. **Shape** — structural validation of the pointer JSON: required keys present,
   `kind` in the enum, `lines` is `null` or `[int,int]` with `start ≤ end`,
   arrays-of-strings where expected. Failures report a JSON-path-style location.
2. **Referential integrity** — every pointer must resolve against git: a `normal`
   section's `file` must produce a non-empty diff; a set `lines` range must overlap
   ≥1 hunk; each context `ref`+`lines` must resolve. A bogus pointer **fails loudly**
   rather than rendering an empty section.

Render is gated on both layers, so a malformed or unresolvable walkthrough can
never silently ship — only a clear error.

## Viewer (`viewer.js` + `styles.css`, Layout A)

- **Top bar:** PR title; meta line (author • `head→base` • files/commits • URL);
  summary paragraph; a **Collapse all / Expand all** control.
- **Left sidebar (sticky, scrollable):** chapters as groups → files as nested
  links, each with derived **+/−** counts. Click → smooth-scroll to the section;
  the active section highlights on scroll (IntersectionObserver). Tail links for
  Cross-cutting / Open questions / Commit map.
- **Main column:**
  - Per chapter: title + intro narrative.
  - Per section: a **sticky file header** (path, +/− counts, `kind` badge for
    non-normal, collapse caret), then narrative, then "Context (unchanged)"
    callouts, then the split diff.
  - **Split diff:** parse the resolved unified diff into hunks → a 2-column table
    (old | new) with per-side line numbers, add/remove/context backgrounds, and
    `@@` separators. highlight.js colorizes each code cell by language (from file
    extension), **lazily when the section first scrolls into view** (perf on huge
    PRs) and **only if `window.hljs` exists**.
  - **Non-normal kinds:** no diff table — show the `note` (and `derivedFrom`).
- **Markdown prose:** every prose field renders through markdown-it (CDN, pinned
  + SRI, `html: false` so raw HTML is escaped, never executed). `styles.css` scopes
  markdown headings/lists so they sit below the viewer's own section headings.
- **Tail:** Cross-cutting and Open-questions render their markdown strings;
  Commit-map stays a table.
- **Empty PR:** a friendly "this PR has no file changes" state from minimal JSON.

**Highlighting is progressive enhancement:** online → token colors; offline or
CDN-blocked → the diff still renders fully, just uncolored. The diff structure and
add/remove coloring come from the inlined `styles.css`, never from the CDN.
**Markdown is the same:** if markdown-it is unavailable, prose falls back to its
raw (still legible) markdown text rather than breaking.

## Output

One self-contained `PR-<n>-<slug>.html`:
- Inlined: `styles.css`, `viewer.js`, the resolved walkthrough data.
- External: two pinned, SRI-protected CDN refs — highlight.js (syntax colors) and
  markdown-it (prose rendering). Both are progressive enhancements; the page
  renders without them.
- Opens by double-click over `file://` (no server). `<script src>`/`<link>` tags
  load fine over `file://`; we use no `fetch()`/module imports.

## Controller (`SKILL.md`) changes

- **Step 3 (paths):** compute both `DATA_PATH` (`.json`) and `OUTPUT_PATH` (`.html`).
- **Step 4 (dispatch):** same `general-purpose` agent, new prompt; agent writes
  `DATA_PATH` and self-validates.
- **New Step 4.5 (build):** run the resolver/merge; on failure re-dispatch once
  with errors appended, then hard-stop.
- **Step 5 (present):** report `OUTPUT_PATH`; `open` on macOS.
- **Red Flags:** add "the agent must not transcribe diffs or code into the JSON —
  pointers only"; keep all read-only / no-PR-mutation constraints.
- **Preflight:** controller checks `node --version`; if missing, fail loudly with
  an install hint.

## Agent prompt (`walkthrough-prompt.md`) changes

- Rewrite the **Output** section: emit the **pointer JSON** above (the document is
  JSON; prose field *values* are markdown); show the schema and an annotated
  example; instruct the agent to **read diffs to understand but never copy them**;
  run `--validate` and fix until it passes; write **only** `DATA_PATH`.
- Specify that **prose values are markdown** (bold/italic, inline code, bullet
  lists, sub-headings) and must **not** contain raw HTML; include an example prose block.
- Keep: decomposition heuristics (chapters/sections/sub-sections), the
  lockfile/generated/binary exception list (now expressed via `kind` + `note`),
  context-as-pointers, cross-cutting / open-questions / commit-map, and the
  read-only contract.
- Remove: the markdown document template.

## Edge cases / error handling

- **Empty PR** → minimal JSON; viewer renders the empty state.
- **Deleted / renamed files** → the git diff encodes these; renames shown as
  `old → new` in the file header; narrative explains.
- **Unknown language** → plain monospace, no error.
- **Markdown library unavailable** → prose shows as raw but legible markdown text.
- **Raw HTML inside a prose field** → escaped by markdown-it (`html: false`); never executed.
- **Huge PR** → no special chunking; pointers keep agent output small;
  collapse-all + lazy highlighting keep the page usable.
- **Invalid or unresolvable pointer** → blocked by the two-layer gate.
- **Missing `node`** at merge → controller preflight fails loudly.
- **`</script>` inside diff text** → escaped at embed time.
- **Refs moved between agent run and merge** → same session, so stable; if a
  pointer no longer resolves, layer-2 catches it rather than rendering wrong code.

## Testing (`test/fixture.json` + `scripts/test-build.mjs`, injected diff provider)

1. `--validate` passes on the good fixture; a deliberately-broken fixture fails
   with the correct error path.
2. **Hunk-slice self-check:** a canned multi-hunk diff + a `lines` range → assert
   the exact hunks selected (the one genuinely non-trivial bit of resolver logic).
3. **Render:** merge produces one self-contained HTML containing doctype, the PR
   title, one anchor per chapter, the CDN hljs tag with SRI, and the embedded data
   — with no unescaped `</script>` breakout.
4. **Referential integrity:** a pointer with no matching diff fails the gate.
5. **Manual (browser):** open the generated HTML; confirm Layout A renders, split
   diffs highlight, prose renders as markdown (bold / bullets / inline code), and a
   prose field containing raw HTML is escaped rather than executed. (Markdown is
   rendered view-time by the browser lib, so it is verified here, not in the Node tests.)

## Future / upgrade paths

- Unified/inline diff toggle; file search/filter in the sidebar.
- If the content schema grows complex, move validation to zod by adding an esbuild
  bundle step to `package-skills` (the deferred "build level").
- Pin/upgrade highlight.js and markdown-it by bumping the version + SRI in `template.html`.
```
