# PR Walkthrough Commenting + Post-to-GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader of a pr-walkthrough HTML page leave GitHub-style line/file review comments (gutter selection, inline threads, a Review panel), export them as a review JSON, and post them to the real PR via a new `post-pr-review` skill that uses `gh`.

**Architecture:** Two components joined by a JSON contract. (1) The viewer gains a `comments.js` layer (inlined like `viewer.js`) that authors comments, persists them in `localStorage`, and exports a **review JSON**. (2) A new `post-pr-review` skill reads that JSON and posts one batched review (+ file-level comments) through `gh api`. The build carries the head commit SHA into the viewer data so the export is self-describing.

**Tech Stack:** Node ≥20 (stdlib + `gh` CLI; `node:test`), vanilla browser JS + `localStorage`, headless Chrome (chrome-devtools MCP) for viewer verification. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-pr-walkthrough-comments-design.md`

**Conventions:**
- Run from repo root: `/Users/haldunanil/Development/agent-skills`. Work on branch `feat/pr-walkthrough-comments` (already created).
- Node tests: `node --test skills/<skill>/scripts/<file>.test.mjs`
- Commit messages use Conventional Commits + the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The **review JSON contract** (viewer export ⇄ posting skill input):
  ```jsonc
  { "repo": "owner/name", "pr": 5, "commit": "<head sha>", "body": "",
    "comments": [ { "path": "src/a.ts", "side": "RIGHT", "line": 12, "startLine": 11, "body": "md" } ],
    "fileComments": [ { "path": "src/a.ts", "body": "md" } ] }
  ```
  `side` ∈ `LEFT`(base)/`RIGHT`(head); `startLine` optional (multi-line, same side, ≤ `line`).

---

## File Structure

**Modified — `skills/pr-walkthrough/`:**
- `scripts/build-walkthrough.mjs` — require `pr.commit`; inline `comments.js` into a new template slot.
- `scripts/build-walkthrough.test.mjs` — tests for `pr.commit` + the comments slot.
- `assets/template.html` — new `<!--PR_WALKTHROUGH_COMMENTS_JS-->` slot.
- `assets/viewer.js` — tag each file section with `data-path` (one line).
- `assets/styles.css` — comment UI styles.
- `assets/comments.js` — **new**: the commenting layer (store, selection, threads, Review panel, export).
- `walkthrough-prompt.md` — `pr.commit` in the JSON shape.

**New — `skills/post-pr-review/`:**
- `SKILL.md` — controller: take a pasted review JSON → validate → post via the script → report.
- `scripts/post-review.mjs` — validate + build `gh api` calls + post one batched review + file comments.
- `scripts/post-review.test.mjs` — `node:test` with an injected fake `gh`.

**Other:**
- `.github/workflows/hal-agent-skills-ci.yml` — run the new test file in the `test` job.

---

## Task 1: Carry the head commit SHA into the viewer data

The GitHub review API needs `commit_id`. The controller already resolves `HEAD_SHA`; thread it into `pr.commit`.

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md`

- [ ] **Step 1: Update `validData()` and add a failing test**

In `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`, find `validData()` and add `commit` to the `pr` object (so existing tests still pass once `commit` is required):

```js
    pr: { number: 482, repo: 'acme/widgets', commit: 'deadbeef', title: 'Add auth', author: 'me',
          headBranch: 'feat', baseBranch: 'main', url: 'https://x', filesCount: 2, commitsCount: 1 },
```

Then append this test near the other `validateShape` tests:

```js
test('validateShape: pr.commit is required', () => {
  const d = validData(); delete d.pr.commit
  assert.ok(validateShape(d).some((e) => e.startsWith('pr.commit')), 'expected pr.commit error')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `pr.commit is required` fails (commit not yet validated).

- [ ] **Step 3: Require `commit` in `validateShape`**

In `skills/pr-walkthrough/scripts/build-walkthrough.mjs`, find the `pr` string-field loop and add `commit`:

```js
    for (const k of ['title', 'repo', 'commit', 'author', 'headBranch', 'baseBranch', 'url']) {
      if (!isStr(pr[k])) err(`pr.${k}`, 'must be a string')
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — full suite green (the new test + all prior).

- [ ] **Step 5: Add `commit` to the prompt's JSON shape**

In `skills/pr-walkthrough/walkthrough-prompt.md`, find the `pr` object in the Section 6 JSON example and add `commit`:

```jsonc
  "pr": {
    "number": {PR_NUMBER}, "repo": "{OWNER_REPO}", "commit": "{HEAD_SHA}", "title": "{PR_TITLE}",
    "author": "{AUTHOR}", "headBranch": "{HEAD_BRANCH}", "baseBranch": "{BASE_BRANCH}",
    "url": "{URL}", "filesCount": {FILES_COUNT}, "commitsCount": {COMMITS_COUNT}
  },
```

(`{HEAD_SHA}` is already in `SKILL.md`'s Step-4 placeholder list, so no controller change is needed.)

- [ ] **Step 6: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs skills/pr-walkthrough/walkthrough-prompt.md
git commit -m "$(printf 'feat(pr-walkthrough): carry head commit SHA into viewer data\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Inline a `comments.js` layer into the built HTML

Add a second inlined script slot so the commenting layer ships in the output, and tag sections with their path so the layer can anchor comments.

**Files:**
- Create: `skills/pr-walkthrough/assets/comments.js` (stub now; fleshed out in Task 5)
- Modify: `skills/pr-walkthrough/assets/template.html`
- Modify: `skills/pr-walkthrough/assets/viewer.js`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Create the comments.js stub**

Create `skills/pr-walkthrough/assets/comments.js`:

```js
/* PR Walkthrough commenting layer — fleshed out in a later task. */
(function () {
  'use strict'
  // intentionally empty until the commenting layer is implemented
})()
```

- [ ] **Step 2: Add the slot to the template**

In `skills/pr-walkthrough/assets/template.html`, add the comments slot on the line **after** the viewer slot (`<!--PR_WALKTHROUGH_VIEWER_JS-->`):

```html
  <!--PR_WALKTHROUGH_VIEWER_JS-->
  <!--PR_WALKTHROUGH_COMMENTS_JS-->
```

- [ ] **Step 3: Tag sections with their path (viewer.js)**

In `skills/pr-walkthrough/assets/viewer.js`, in `sectionEl(s, id)`, right after `var sec = el('section', 'file'); sec.id = id`, add:

```js
    sec.setAttribute('data-path', s.file)
```

- [ ] **Step 4: Write the failing build test**

In `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`, make `tempAssets()` aware of the comments slot, then append two tests.

1. Add a `SLOT_COMMENTS` import near the top (ESM imports hoist, so placement doesn't matter):

```js
import { SLOT_COMMENTS } from './build-walkthrough.mjs'
```

2. In `tempAssets()`, add the comments slot to the temp template **and** write a fake `comments.js`. The template line must end with `${SLOT_VIEWER}${SLOT_COMMENTS}</body></html>`:

```js
  writeFileSyncT(path2.join(dir, 'template.html'),
    `<!DOCTYPE html><html><head>${SLOT_STYLES}</head><body>` +
    `<script id="walkthrough-data" type="application/json">${SLOT_DATA}</script>${SLOT_VIEWER}${SLOT_COMMENTS}</body></html>`)
  writeFileSyncT(path2.join(dir, 'comments.js'), "console.log('comments')")
```

3. Append two tests:

```js
test('renderHtml inlines comments.js', () => {
  const assetsDir = tempAssets()
  const html = renderHtml({ x: 1 }, { assetsDir })
  assert.ok(html.includes("console.log('comments')"), 'comments.js should be inlined')
})

test('real template.html contains the comments slot', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  assert.ok(tpl.includes(SLOT_COMMENTS), 'template must contain the comments slot token')
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `SLOT_COMMENTS` is not exported and `renderHtml` doesn't inline comments.js yet.

- [ ] **Step 6: Implement the slot + inlining**

In `skills/pr-walkthrough/scripts/build-walkthrough.mjs`, add the constant next to the other slot constants:

```js
export const SLOT_COMMENTS = '<!--PR_WALKTHROUGH_COMMENTS_JS-->'
```

Then in `renderHtml`, read `comments.js` and replace the slot. Update the function so it reads the file and adds the replacement:

```js
export function renderHtml(data, { assetsDir }) {
  const tpl = readFileSync(path.join(assetsDir, 'template.html'), 'utf8')
  const css = readFileSync(path.join(assetsDir, 'styles.css'), 'utf8')
  const js = readFileSync(path.join(assetsDir, 'viewer.js'), 'utf8')
  const comments = readFileSync(path.join(assetsDir, 'comments.js'), 'utf8')
  const json = escapeForScript(JSON.stringify(data))
  return tpl
    .replace(SLOT_STYLES, () => `<style>\n${css}\n</style>`)
    .replace(SLOT_VIEWER, () => `<script>\n${js}\n</script>`)
    .replace(SLOT_COMMENTS, () => `<script>\n${comments}\n</script>`)
    .replace(SLOT_DATA, () => json)
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — full suite green.

- [ ] **Step 8: Commit**

```bash
git add skills/pr-walkthrough/assets/comments.js skills/pr-walkthrough/assets/template.html skills/pr-walkthrough/assets/viewer.js skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): inline a comments.js layer and tag sections by path\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `post-review.mjs` — validate + post the review via gh

The testable core of the new skill. Validates the review JSON and builds the `gh api` calls; `gh` is injected so tests run without network.

**Files:**
- Create: `skills/post-pr-review/scripts/post-review.mjs`
- Create: `skills/post-pr-review/scripts/post-review.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `skills/post-pr-review/scripts/post-review.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReview, reviewApiArgs, fileCommentApiArgs, postReview } from './post-review.mjs'

function review(over = {}) {
  return Object.assign({
    repo: 'acme/widgets', pr: 5, commit: 'abc123', body: 'overall',
    comments: [{ path: 'src/a.ts', side: 'RIGHT', line: 12, body: 'one' }],
    fileComments: [{ path: 'src/a.ts', body: 'whole file' }],
  }, over)
}

function fakeGh() {
  const calls = []
  const gh = (endpoint, body) => { calls.push({ endpoint, body }); return { id: calls.length, html_url: 'https://x/' + calls.length } }
  return { gh, calls }
}

test('validateReview accepts a well-formed review', () => {
  assert.deepEqual(validateReview(review()), [])
})

test('validateReview rejects bad repo/side/line and empty review', () => {
  assert.ok(validateReview(review({ repo: 'nope' })).some((e) => e.startsWith('repo')))
  assert.ok(validateReview(review({ comments: [{ path: 'a', side: 'UP', line: 1, body: 'x' }] })).some((e) => e.includes('.side')))
  assert.ok(validateReview(review({ comments: [{ path: 'a', side: 'RIGHT', line: 1.5, body: 'x' }] })).some((e) => e.includes('.line')))
  assert.ok(validateReview(review({ comments: [], fileComments: [] })).some((e) => e.includes('no comments')))
})

test('validateReview rejects startLine greater than line', () => {
  assert.ok(validateReview(review({ comments: [{ path: 'a', side: 'RIGHT', line: 5, startLine: 9, body: 'x' }] }))
    .some((e) => e.includes('startLine')))
})

test('reviewApiArgs builds a batched COMMENT review with mapped line comments', () => {
  const { endpoint, body } = reviewApiArgs(review({
    comments: [{ path: 'src/a.ts', side: 'RIGHT', line: 12, startLine: 11, body: 'multi' }],
  }))
  assert.equal(endpoint, 'repos/acme/widgets/pulls/5/reviews')
  assert.equal(body.commit_id, 'abc123')
  assert.equal(body.event, 'COMMENT')
  assert.deepEqual(body.comments[0], { path: 'src/a.ts', body: 'multi', line: 12, side: 'RIGHT', start_line: 11, start_side: 'RIGHT' })
})

test('fileCommentApiArgs builds subject_type=file calls', () => {
  const calls = fileCommentApiArgs(review())
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'repos/acme/widgets/pulls/5/comments')
  assert.equal(calls[0].body.subject_type, 'file')
  assert.equal(calls[0].body.path, 'src/a.ts')
})

test('postReview posts the review then each file comment', () => {
  const { gh, calls } = fakeGh()
  const posted = postReview(review(), { gh })
  assert.equal(calls.length, 2)                                  // 1 review + 1 file comment
  assert.equal(calls[0].endpoint, 'repos/acme/widgets/pulls/5/reviews')
  assert.equal(calls[1].body.subject_type, 'file')
  assert.equal(posted.length, 2)
  assert.equal(posted[0].type, 'review')
})

test('postReview reports what already posted on partial failure', () => {
  let n = 0
  const gh = () => { n++; if (n === 2) throw new Error('boom'); return { id: n, html_url: 'u' } }
  assert.throws(() => postReview(review(), { gh }), (e) => {
    assert.ok(Array.isArray(e.posted))
    assert.equal(e.posted.length, 1)                             // the review posted before the file comment failed
    return true
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: FAIL — `post-review.mjs` does not exist.

- [ ] **Step 3: Implement the script**

Create `skills/post-pr-review/scripts/post-review.mjs`:

```js
#!/usr/bin/env node
// Validate an exported pr-walkthrough review and post it to the PR via `gh`.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const SIDES = new Set(['LEFT', 'RIGHT'])
const isStr = (v) => typeof v === 'string' && v.length > 0
const isInt = (v) => Number.isInteger(v)

export function validateReview(r) {
  const errors = []
  const err = (p, m) => errors.push(`${p}: ${m}`)
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return ['<root>: must be an object']
  if (!isStr(r.repo) || !/^[^/\s]+\/[^/\s]+$/.test(r.repo)) err('repo', 'must be "owner/name"')
  if (!isInt(r.pr)) err('pr', 'must be an integer')
  if (!isStr(r.commit)) err('commit', 'must be a commit sha string')
  if (r.body !== undefined && typeof r.body !== 'string') err('body', 'must be a string')

  const comments = r.comments ?? []
  const fileComments = r.fileComments ?? []
  if (!Array.isArray(comments)) err('comments', 'must be an array')
  else comments.forEach((c, i) => {
    const p = `comments[${i}]`
    if (!isStr(c?.path)) err(`${p}.path`, 'must be a string')
    if (!SIDES.has(c?.side)) err(`${p}.side`, 'must be LEFT or RIGHT')
    if (!isInt(c?.line)) err(`${p}.line`, 'must be an integer')
    if (c?.startLine != null && !isInt(c.startLine)) err(`${p}.startLine`, 'must be an integer')
    if (c?.startLine != null && isInt(c.line) && c.startLine > c.line) err(`${p}.startLine`, 'must be <= line')
    if (!isStr(c?.body)) err(`${p}.body`, 'must be a non-empty string')
  })
  if (!Array.isArray(fileComments)) err('fileComments', 'must be an array')
  else fileComments.forEach((c, i) => {
    const p = `fileComments[${i}]`
    if (!isStr(c?.path)) err(`${p}.path`, 'must be a string')
    if (!isStr(c?.body)) err(`${p}.body`, 'must be a non-empty string')
  })
  if (comments.length === 0 && fileComments.length === 0) err('<root>', 'no comments to post')
  return errors
}

export function reviewApiArgs(r) {
  const comments = (r.comments ?? []).map((c) => {
    const item = { path: c.path, body: c.body, line: c.line, side: c.side }
    if (c.startLine != null && c.startLine !== c.line) { item.start_line = c.startLine; item.start_side = c.side }
    return item
  })
  return {
    endpoint: `repos/${r.repo}/pulls/${r.pr}/reviews`,
    body: { commit_id: r.commit, event: 'COMMENT', body: r.body || '', comments },
  }
}

export function fileCommentApiArgs(r) {
  return (r.fileComments ?? []).map((c) => ({
    endpoint: `repos/${r.repo}/pulls/${r.pr}/comments`,
    body: { commit_id: r.commit, path: c.path, body: c.body, subject_type: 'file' },
  }))
}

// Default runner: POST a JSON body via `gh api <endpoint> --method POST --input -`.
function ghPost(endpoint, body) {
  const out = execFileSync('gh', ['api', endpoint, '--method', 'POST', '--input', '-'], {
    input: JSON.stringify(body), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  return out.trim() ? JSON.parse(out) : {}
}

export function postReview(r, { gh = ghPost } = {}) {
  const posted = []
  try {
    if ((r.comments ?? []).length > 0 || r.body) {
      const { endpoint, body } = reviewApiArgs(r)
      const res = gh(endpoint, body)
      posted.push({ type: 'review', id: res.id, url: res.html_url })
    }
    for (const call of fileCommentApiArgs(r)) {
      const res = gh(call.endpoint, call.body)
      posted.push({ type: 'file', path: call.body.path, id: res.id, url: res.html_url })
    }
  } catch (e) {
    const err = new Error('gh post failed: ' + ((e.stderr || e.message || '') + '').trim())
    err.posted = posted
    throw err
  }
  return posted
}

function main(argv) {
  const file = argv[0]
  if (!file) { console.error('usage: post-review.mjs <review.json>'); process.exit(2) }
  let r
  try { r = JSON.parse(readFileSync(file, 'utf8')) }
  catch (e) { console.error('Could not read/parse review JSON: ' + e.message); process.exit(1) }
  const errors = validateReview(r)
  if (errors.length) { console.error('Invalid review JSON:\n' + errors.join('\n')); process.exit(1) }
  let posted
  try { posted = postReview(r) }
  catch (e) {
    console.error(e.message)
    if (e.posted && e.posted.length) console.error('Already posted: ' + JSON.stringify(e.posted))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, posted }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/post-pr-review/scripts/post-review.mjs skills/post-pr-review/scripts/post-review.test.mjs
git commit -m "$(printf 'feat(post-pr-review): post an exported walkthrough review via gh\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: `post-pr-review` skill controller

**Files:**
- Create: `skills/post-pr-review/SKILL.md`

- [ ] **Step 1: Create the SKILL.md**

Create `skills/post-pr-review/SKILL.md`:

````markdown
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
- On a **`gh` error** (not authenticated, no network, PR not found) it prints the error and any comments already posted — relay both so the user can re-auth and retry.

### Step 3: Report

Tell the user how many comments posted and link the review. Nothing else.

## Red Flags

**Never:**
- Merge, close, approve, or request-changes on the PR — this skill only **creates comment**s (`event=COMMENT`).
- Edit, reword, or "improve" the user's comment text — post it verbatim.
- Invent comments that weren't in the pasted JSON.
- Retry automatically on a `gh` auth failure — surface it and let the user re-auth.
````

- [ ] **Step 2: Verify the skill is well-formed**

Run: `grep -n "name: post-pr-review" skills/post-pr-review/SKILL.md && grep -c "post-review.mjs" skills/post-pr-review/SKILL.md`
Expected: the `name:` line is present and `post-review.mjs` is referenced (twice).

- [ ] **Step 3: Commit**

```bash
git add skills/post-pr-review/SKILL.md
git commit -m "$(printf 'feat(post-pr-review): skill controller for posting a pasted review\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: The commenting layer (`comments.js`)

The full browser module: gutter selection, composer, inline threads, markers, file-level button, Review panel, Copy review, persistence, outdated handling. This replaces the Task-2 stub. It is verified in headless Chrome in Task 7.

**Files:**
- Modify (replace contents): `skills/pr-walkthrough/assets/comments.js`

- [ ] **Step 1: Write the full module**

Replace `skills/pr-walkthrough/assets/comments.js` with:

```js
/* PR Walkthrough commenting layer — runs after viewer.js has rendered the DOM.
   Authors GitHub-style line/file review comments, persists them in localStorage,
   and exports a review JSON for the post-pr-review skill. Plain DOM + storage;
   markdown-it (window.markdownit) renders comment bodies if present. */
(function () {
  'use strict'

  var dataEl = document.getElementById('walkthrough-data')
  var data
  try { data = JSON.parse(dataEl.textContent) } catch (e) { data = null }
  if (!data || !data.pr) return
  var pr = data.pr
  var md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: true }) : null
  var KEY = 'pr-walkthrough:' + pr.repo + '#' + pr.number

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  function renderBody(node, text) { if (md) { node.innerHTML = md.render(text) } else { node.textContent = text } }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&') }

  // ---- store ----
  var comments = load()
  var nextId = comments.reduce(function (m, c) { return Math.max(m, c.id || 0) }, 0) + 1
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (e) { return [] } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(comments)) } catch (e) {} }
  function add(c) { c.id = nextId++; comments.push(c); save(); refresh(); return c }
  function update(id, body) { var c = byId(id); if (c) { c.body = body; save(); refresh() } }
  function remove(id) { comments = comments.filter(function (c) { return c.id !== id }); save(); refresh() }
  function byId(id) { for (var i = 0; i < comments.length; i++) if (comments[i].id === id) return comments[i]; return null }

  function exportReview() {
    var out = { repo: pr.repo, pr: pr.number, commit: pr.commit, body: '', comments: [], fileComments: [] }
    comments.forEach(function (c) {
      if (c.kind === 'file') { out.fileComments.push({ path: c.path, body: c.body }) }
      else if (!c.outdated) {
        var o = { path: c.path, side: c.side, line: c.line, body: c.body }
        if (c.startLine && c.startLine !== c.line) o.startLine = c.startLine
        out.comments.push(o)
      }
    })
    return out
  }

  // automation/test hook
  window.__wtc = { all: function () { return comments.slice() }, add: add, remove: remove, exportReview: exportReview, key: KEY }

  // ---- gutter helpers (viewer.js tags sections with data-path; gutters are td.lno/td.rno) ----
  function gutterInfo(cell) {
    if (!cell || cell.tagName !== 'TD') return null
    var left = cell.classList.contains('lno'), right = cell.classList.contains('rno')
    if (!left && !right) return null
    var n = parseInt(cell.textContent, 10)
    if (!n) return null
    var sec = cell.closest('.file')
    if (!sec) return null
    return { path: sec.getAttribute('data-path'), side: left ? 'LEFT' : 'RIGHT', line: n, cell: cell, sec: sec }
  }
  function findGutter(path, side, line) {
    var sec = document.querySelector('.file[data-path="' + cssEsc(path) + '"]')
    if (!sec) return null
    var cells = sec.querySelectorAll(side === 'LEFT' ? 'td.lno' : 'td.rno')
    for (var i = 0; i < cells.length; i++) if (parseInt(cells[i].textContent, 10) === line) return cells[i]
    return null
  }
  // gutter cells of one side within a section, in document order
  function sideCells(sec, side) { return [].slice.call(sec.querySelectorAll(side === 'LEFT' ? 'td.lno' : 'td.rno')) }

  // ---- selection (click / drag down the gutter) ----
  var drag = null
  document.addEventListener('mousedown', function (e) {
    var info = gutterInfo(e.target)
    if (!info) return
    e.preventDefault()
    closeComposer()
    drag = { side: info.side, sec: info.sec, start: info.cell, end: info.cell }
    paint()
  })
  document.addEventListener('mousemove', function (e) {
    if (!drag) return
    var info = gutterInfo(e.target)
    if (!info || info.side !== drag.side || info.sec !== drag.sec) return
    drag.end = info.cell; paint()
  })
  document.addEventListener('mouseup', function () {
    if (!drag) return
    var d = drag; drag = null
    clearPaint()
    var range = selectedCells(d)
    if (!range.length) return
    var lines = range.map(function (c) { return parseInt(c.textContent, 10) })
    var lo = Math.min.apply(null, lines), hi = Math.max.apply(null, lines)
    var anchorRow = range[range.length - 1].parentNode
    openComposer(anchorRow, { kind: 'line', path: d.sec.getAttribute('data-path'), side: d.side, line: hi, startLine: lo === hi ? null : lo })
  })
  // selected cells = contiguous run between start and end on that side, clamped to one hunk (no hunksep between)
  function selectedCells(d) {
    var cells = sideCells(d.sec, d.side)
    var si = cells.indexOf(d.start), ei = cells.indexOf(d.end)
    if (si < 0 || ei < 0) return []
    if (si > ei) { var t = si; si = ei; ei = t }
    var run = []
    for (var i = si; i <= ei; i++) {
      // stop if a hunk separator sits between this row and the previous kept row
      if (run.length && crossesHunksep(run[run.length - 1].parentNode, cells[i].parentNode)) break
      run.push(cells[i])
    }
    return run
  }
  function crossesHunksep(rowA, rowB) {
    var r = rowA
    while (r && r !== rowB) { r = r.nextElementSibling; if (r && r.classList.contains('hunksep')) return true }
    return false
  }
  function paint() { clearPaint(); selectedCells(drag).forEach(function (c) { c.parentNode.classList.add('wt-selecting') }) }
  function clearPaint() { [].slice.call(document.querySelectorAll('.wt-selecting')).forEach(function (r) { r.classList.remove('wt-selecting') }) }

  // ---- composer ----
  var composerRow = null
  function closeComposer() { if (composerRow) { composerRow.remove(); composerRow = null } }
  function openComposer(afterRow, anchor) {
    closeComposer()
    var tr = el('tr', 'wt-composer-row')
    var td = el('td'); td.colSpan = 4
    var box = el('div', 'wt-composer')
    var ta = el('textarea'); ta.placeholder = 'Comment…'
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add comment')
    cancel.addEventListener('click', closeComposer)
    ok.addEventListener('click', function () {
      var body = ta.value.trim(); if (!body) return
      add({ kind: anchor.kind, path: anchor.path, side: anchor.side, line: anchor.line, startLine: anchor.startLine, body: body })
      closeComposer()
    })
    row.appendChild(cancel); row.appendChild(ok)
    box.appendChild(ta); box.appendChild(row); td.appendChild(box); tr.appendChild(td)
    afterRow.parentNode.insertBefore(tr, afterRow.nextSibling)
    composerRow = tr; ta.focus()
  }

  // ---- file-level "comment on file" buttons ----
  function wireFileButtons() {
    [].slice.call(document.querySelectorAll('.file')).forEach(function (sec) {
      var head = sec.querySelector('.file-head'); if (!head || head.querySelector('.wt-file-btn')) return
      var btn = el('button', 'wt-file-btn', '💬 Comment on file')
      btn.addEventListener('click', function (e) {
        e.stopPropagation()  // don't toggle the section collapse
        var body = sec.querySelector('.file-body') || sec
        // open a composer at the top of the file body via a lightweight block (not a table row)
        openBlockComposer(body, { kind: 'file', path: sec.getAttribute('data-path') })
      })
      head.appendChild(btn)
    })
  }
  var blockComposer = null
  function openBlockComposer(container, anchor) {
    if (blockComposer) { blockComposer.remove(); blockComposer = null }
    var box = el('div', 'wt-composer wt-block')
    var ta = el('textarea'); ta.placeholder = 'Comment on this file…'
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add comment')
    cancel.addEventListener('click', function () { box.remove(); blockComposer = null })
    ok.addEventListener('click', function () { var b = ta.value.trim(); if (!b) return; add({ kind: 'file', path: anchor.path, body: b }); box.remove(); blockComposer = null })
    row.appendChild(cancel); row.appendChild(ok); box.appendChild(ta); box.appendChild(row)
    container.insertBefore(box, container.firstChild); blockComposer = box; ta.focus()
  }

  // ---- render threads, markers, file-comment cards ----
  function clearRendered() {
    [].slice.call(document.querySelectorAll('.wt-thread-row, .wt-file-card, .wt-marker')).forEach(function (n) { n.remove() })
    ;[].slice.call(document.querySelectorAll('.wt-has-comment')).forEach(function (c) { c.classList.remove('wt-has-comment') })
  }
  function threadCard(c) {
    var card = el('div', 'wt-thread')
    var h = el('div', 'wt-thread-h')
    h.appendChild(el('b', null, 'You'))
    h.appendChild(document.createTextNode(c.kind === 'file' ? ' · on file' + (c.outdated ? '' : '') : ' · ' + (c.side === 'RIGHT' ? '+' : '-') + (c.startLine && c.startLine !== c.line ? c.startLine + '–' + c.line : c.line)))
    var acts = el('span', 'wt-acts')
    var edit = el('button', 'wt-link', 'edit'); var del = el('button', 'wt-link', 'delete')
    edit.addEventListener('click', function () {        // edit in place (works for both tr-embedded and div cards)
      var ta = el('textarea'); ta.value = c.body
      var actions = el('div', 'wt-actions')
      var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Save')
      cancel.addEventListener('click', refresh)
      ok.addEventListener('click', function () { var b = ta.value.trim(); if (b) update(c.id, b); else refresh() })
      actions.appendChild(cancel); actions.appendChild(ok)
      card.textContent = ''; card.appendChild(ta); card.appendChild(actions); ta.focus()
    })
    del.addEventListener('click', function () { remove(c.id) })
    acts.appendChild(edit); acts.appendChild(del); h.appendChild(acts)
    var body = el('div', 'wt-thread-b'); renderBody(body, c.body)
    card.appendChild(h); card.appendChild(body)
    return card
  }
  function renderLineThreads() {
    comments.filter(function (c) { return c.kind === 'line' }).forEach(function (c) {
      var cell = findGutter(c.path, c.side, c.line)
      if (!cell) { c.outdated = true; return }   // anchor line gone after regeneration
      c.outdated = false
      cell.classList.add('wt-has-comment')
      var marker = el('span', 'wt-marker', '💬'); cell.appendChild(marker)
      var row = cell.parentNode
      var tr = el('tr', 'wt-thread-row'); var td = el('td'); td.colSpan = 4
      td.appendChild(threadCard(c)); tr.appendChild(td)
      row.parentNode.insertBefore(tr, row.nextSibling)
    })
  }
  function renderFileCards() {
    comments.filter(function (c) { return c.kind === 'file' }).forEach(function (c) {
      var sec = document.querySelector('.file[data-path="' + cssEsc(c.path) + '"]'); if (!sec) return
      var body = sec.querySelector('.file-body') || sec
      var card = threadCard(c); card.classList.add('wt-file-card')
      body.insertBefore(card, body.firstChild)
    })
  }

  // ---- review panel ----
  var panel = null
  function renderPanel() {
    if (!panel) { panel = el('div', 'wt-panel'); document.body.appendChild(panel) }
    panel.textContent = ''
    var head = el('div', 'wt-panel-h'); head.appendChild(el('span', null, '📝 Review'))
    head.appendChild(el('span', 'wt-count', comments.length + (comments.length === 1 ? ' comment' : ' comments')))
    panel.appendChild(head)
    comments.forEach(function (c) {
      var it = el('div', 'wt-panel-it')
      var loc = c.kind === 'file' ? c.path + ' (file)' : c.path + ' ' + (c.side === 'RIGHT' ? '+' : '-') + c.line + (c.outdated ? ' (outdated)' : '')
      it.appendChild(el('span', 'wt-loc' + (c.outdated ? ' wt-outdated' : ''), loc))
      it.appendChild(el('span', 'wt-snip', ' · ' + c.body.slice(0, 50)))
      panel.appendChild(it)
    })
    var foot = el('div', 'wt-panel-f')
    var clear = el('button', 'wt-btn', 'Clear')
    var copy = el('button', 'wt-btn wt-primary', 'Copy review')
    copy.disabled = comments.length === 0; clear.disabled = comments.length === 0
    clear.addEventListener('click', function () { if (confirm('Delete all ' + comments.length + ' comments?')) { comments = []; save(); refresh() } })
    copy.addEventListener('click', function () {
      var text = JSON.stringify(exportReview(), null, 2)
      if (navigator.clipboard) navigator.clipboard.writeText(text)
      copy.textContent = 'Copied!'; setTimeout(function () { copy.textContent = 'Copy review' }, 1200)
    })
    foot.appendChild(clear); foot.appendChild(copy); panel.appendChild(foot)
  }

  // ---- refresh everything from the store ----
  function refresh() { clearRendered(); renderLineThreads(); renderFileCards(); renderPanel() }

  wireFileButtons()
  refresh()
})()
```

- [ ] **Step 2: Verify it parses**

Run: `node --check skills/pr-walkthrough/assets/comments.js`
Expected: no output, exit 0. (Behavior is verified in Chrome in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add skills/pr-walkthrough/assets/comments.js
git commit -m "$(printf 'feat(pr-walkthrough): GitHub-style commenting layer (selection, threads, review panel)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Comment UI styles (`styles.css`)

**Files:**
- Modify: `skills/pr-walkthrough/assets/styles.css`

- [ ] **Step 1: Append the comment styles**

Append to `skills/pr-walkthrough/assets/styles.css`:

```css
/* ---- commenting ---- */
table.diff td.lno, table.diff td.rno { position: relative; cursor: pointer; }
table.diff td.lno:hover::after, table.diff td.rno:hover::after {
  content: "+"; position: absolute; left: 2px; top: 0; background: var(--link); color: #fff;
  width: 13px; height: 13px; line-height: 13px; text-align: center; border-radius: 3px; font-size: 11px;
}
table.diff tr.wt-selecting td { background: #243b53 !important; }
table.diff td.wt-has-comment::after { content: none; }
.wt-marker { position: absolute; left: 1px; top: 0; font-size: 9px; }

.wt-composer { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px; margin: 6px 0; }
.wt-composer.wt-block { margin: 8px; }
.wt-composer textarea { width: 100%; box-sizing: border-box; min-height: 56px; background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px; font: inherit; resize: vertical; }
.wt-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.wt-btn { background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.wt-btn:disabled { opacity: .5; cursor: default; }
.wt-primary { background: var(--add-num); border-color: var(--add-num); color: #fff; }
.wt-file-btn { margin-left: 8px; background: var(--bg); color: var(--link); border: 1px solid var(--border); border-radius: 6px; padding: 1px 8px; cursor: pointer; font-size: 11px; }

tr.wt-thread-row > td, .wt-file-card { padding: 0; }
.wt-thread { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin: 6px 10px; padding: 7px 9px; }
.wt-file-card { margin: 8px; }
.wt-thread-h { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.wt-thread-h b { color: var(--fg); }
.wt-acts { float: right; }
.wt-link { background: none; border: none; color: var(--link); cursor: pointer; font-size: 11px; padding: 0 0 0 8px; }
.wt-thread-b { font-size: 13px; }
.wt-thread-b p { margin: 4px 0; } .wt-thread-b code { background: var(--bg); border-radius: 4px; padding: 1px 4px; }

.wt-panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 60vh; overflow: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px; font-size: 12px; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.wt-panel-h { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); font-weight: 600; }
.wt-panel-h .wt-count { margin-left: auto; color: var(--muted); font-weight: 400; }
.wt-panel-it { padding: 5px 12px; border-bottom: 1px solid var(--border); }
.wt-panel-it .wt-loc { color: var(--link); } .wt-panel-it .wt-outdated { color: var(--del-num); }
.wt-panel-it .wt-snip { color: var(--muted); }
.wt-panel-f { display: flex; gap: 6px; justify-content: flex-end; padding: 8px 12px; }
```

- [ ] **Step 2: Verify braces balance**

Run: `node -e "const c=require('fs').readFileSync('skills/pr-walkthrough/assets/styles.css','utf8'); const o=(c.match(/{/g)||[]).length,x=(c.match(/}/g)||[]).length; if(o!==x) throw new Error('brace mismatch '+o+'/'+x); console.log('balanced',o)"`
Expected: `balanced <n>`.

- [ ] **Step 3: Commit**

```bash
git add skills/pr-walkthrough/assets/styles.css
git commit -m "$(printf 'feat(pr-walkthrough): styles for comment threads, composer, and review panel\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Verify the commenting layer in headless Chrome

`comments.js` is DOM code, so its "tests" are headless-Chrome assertions (the pattern this viewer already uses). Build a real walkthrough, open it, and drive the comment layer through its test hook + the DOM.

**Files:** none (verification only)

- [ ] **Step 1: Build a sample walkthrough with a known diff**

Create `/tmp/pr-walkthroughs/comments-fixture.json` (a minimal valid walkthrough — note `pr.commit`):

```bash
mkdir -p /tmp/pr-walkthroughs
cat > /tmp/pr-walkthroughs/comments-fixture.json <<'JSON'
{ "pr": { "number": 1, "repo": "acme/widgets", "commit": "abc123", "title": "Sample",
    "author": "me", "headBranch": "feat", "baseBranch": "main",
    "url": "https://example.com/pr/1", "filesCount": 1, "commitsCount": 1 },
  "summary": "s",
  "chapters": [ { "id": "c", "title": "C", "intro": "i", "sections": [
    { "file": "src/a.ts", "unit": null, "lines": null, "kind": "normal", "narrative": "n",
      "resolvedDiff": "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,3 +10,4 @@\n const a = 1\n-const b = 2\n+const b = 3\n+const c = 4\n" } ] } ],
  "crossCutting": "-", "openQuestions": "-", "commitMap": [] }
JSON
```

Render it directly with `renderHtml` (bypassing validate/resolve, since `resolvedDiff` is already inline):

```bash
node --input-type=module -e '
import { renderHtml } from "./skills/pr-walkthrough/scripts/build-walkthrough.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("/tmp/pr-walkthroughs/comments-fixture.json","utf8"));
writeFileSync("/tmp/pr-walkthroughs/comments-test.html", renderHtml(data, { assetsDir: "skills/pr-walkthrough/assets" }));
console.log("wrote /tmp/pr-walkthroughs/comments-test.html");
'
```
Expected: `wrote …comments-test.html`.

- [ ] **Step 2: Open it in headless Chrome and verify the data layer**

Use the chrome-devtools MCP: `new_page` → `file:///tmp/pr-walkthroughs/comments-test.html`. Then `evaluate_script`:

```js
() => {
  // sanity: sections are tagged with data-path and the review panel exists
  const sec = document.querySelector('.file[data-path="src/a.ts"]');
  const panel = document.querySelector('.wt-panel');
  // add a RIGHT-side line comment on line 12 and a file comment via the hook
  window.__wtc.add({ kind: 'line', path: 'src/a.ts', side: 'RIGHT', line: 12, body: 'inline note' });
  window.__wtc.add({ kind: 'file', path: 'src/a.ts', body: 'file note' });
  const ex = window.__wtc.exportReview();
  return {
    tagged: !!sec, hasPanel: !!panel,
    threadRows: document.querySelectorAll('.wt-thread-row').length,   // expect 1 (line comment)
    fileCards: document.querySelectorAll('.wt-file-card').length,     // expect 1 (file comment)
    marker: document.querySelectorAll('.wt-marker').length >= 1,
    exportComments: ex.comments.length, exportFile: ex.fileComments.length,
    exportShape: ex.comments[0],                                       // {path, side:'RIGHT', line:12, body}
    repo: ex.repo, pr: ex.pr, commit: ex.commit,
  };
}
```
Expected: `tagged:true, hasPanel:true, threadRows:1, fileCards:1, marker:true, exportComments:1, exportFile:1, exportShape={path:'src/a.ts',side:'RIGHT',line:12,body:'inline note'}, repo:'acme/widgets', pr:1, commit:'abc123'`.

- [ ] **Step 3: Verify persistence across reload**

`evaluate_script` to confirm it persisted to localStorage, then `navigate_page` reload, then re-check:

```js
() => ({ stored: JSON.parse(localStorage.getItem('pr-walkthrough:acme/widgets#1') || '[]').length })
```
Expected before reload: `stored:2`. After reload + re-evaluate: `window.__wtc.all().length` is `2` and `document.querySelectorAll('.wt-thread-row').length` is `1` (re-rendered from storage).

- [ ] **Step 4: Verify selection → composer (synthetic drag) and the outdated path**

Dispatch a mousedown/up on the right gutter of line 11 (an existing, un-commented line in the fixture) and confirm a composer row opens; then add via the hook a comment on a line that doesn't exist and confirm it's flagged outdated:

```js
() => {
  const cell = [...document.querySelectorAll('.file[data-path="src/a.ts"] td.rno')].find(c => parseInt(c.textContent, 10) === 11);
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const composerOpened = !!document.querySelector('.wt-composer-row');
  window.__wtc.add({ kind: 'line', path: 'src/a.ts', side: 'RIGHT', line: 9999, body: 'orphan' });
  const outdated = window.__wtc.all().some(c => c.line === 9999 && c.outdated);
  return { composerOpened, outdated };
}
```
Expected: `composerOpened:true, outdated:true`.

- [ ] **Step 5: Visual sanity (screenshot)**

`take_screenshot` (save into `.superpowers/`, which is gitignored) and confirm: inline thread cards render under the commented line, the 💬 marker shows on the gutter, the **Review** panel is bottom-right with **Copy review**, and a **💬 Comment on file** button is in the file header. If anything is off, fix `comments.js`/`styles.css` and re-verify Steps 2–5.

- [ ] **Step 6: Commit any fixes**

```bash
git add skills/pr-walkthrough/assets/comments.js skills/pr-walkthrough/assets/styles.css
git commit -m "$(printf 'fix(pr-walkthrough): comment-layer fixes from headless-Chrome verification\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" || echo "nothing to fix"
```

---

## Task 8: Packaging, CI, and manual end-to-end

**Files:**
- Modify: `.github/workflows/hal-agent-skills-ci.yml`
- Regenerate: `skills/pr-walkthrough.zip`, `skills/post-pr-review.zip`

- [ ] **Step 1: Run the post-pr-review tests in CI**

In `.github/workflows/hal-agent-skills-ci.yml`, add a step after the existing `Run pr-walkthrough tests` step:

```yaml
      - name: Run post-pr-review tests
        working-directory: ${{ github.workspace }}
        run: node --test skills/post-pr-review/scripts/post-review.test.mjs
```

- [ ] **Step 2: Build the skill zips**

Run: `npm --prefix packages/hal-agent-skills run package-skills`
Then restore any unrelated zips that changed and stage only ours:

```bash
git checkout -- skills/comprehensive-review.zip skills/review-pr-comments.zip 2>/dev/null || true
git status --short skills/*.zip
```
Expected: `skills/pr-walkthrough.zip` and `skills/post-pr-review.zip` show as modified/new. Confirm `post-pr-review.zip` exists (the packager zips every `skills/<name>/`).

- [ ] **Step 3: Full Node suite + syntax**

Run:
```bash
node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
node --test skills/post-pr-review/scripts/post-review.test.mjs
node --check skills/pr-walkthrough/assets/comments.js
```
Expected: both suites green; `comments.js` parses.

- [ ] **Step 4: Manual end-to-end (real PR)**

On an open PR you own (the line-comment API needs the lines to exist in the PR diff): generate a walkthrough, open the HTML, add one line comment + one file comment, click **Copy review**, then post it:

```bash
pbpaste > /tmp/pr-reviews/review.json   # the copied review JSON
node skills/post-pr-review/scripts/post-review.mjs /tmp/pr-reviews/review.json
```
Expected: `{ "ok": true, "posted": [...] }`; the comments appear on the PR as one review + a file comment. (Use a throwaway PR.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/hal-agent-skills-ci.yml skills/pr-walkthrough.zip skills/post-pr-review.zip
git commit -m "$(printf 'chore: package post-pr-review skill and run its tests in CI\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

- [ ] **Step 6: Add a changeset**

Create `.changeset/pr-walkthrough-commenting.md`:

```markdown
---
"hal-agent-skills": minor
---

The pr-walkthrough HTML viewer can now leave **GitHub-style review comments**: drag the line-number gutter to comment on a range (or click a single line), or comment on a whole file. Comments render as inline threads, persist in `localStorage`, and **Copy review** exports them as JSON. A new **post-pr-review** skill posts that exported review to the PR via `gh` as one batched review.
```

```bash
git add .changeset/pr-walkthrough-commenting.md
git commit -m "$(printf 'chore: changeset for pr-walkthrough commenting + post-pr-review\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Notes for the implementer

- **No new runtime dependencies.** `comments.js` is plain DOM + `localStorage`; `post-review.mjs` is stdlib + `gh`.
- **`comments.js` runs after `viewer.js`** (inlined after it) and re-parses `#walkthrough-data`; it depends on `viewer.js` tagging sections with `data-path` (Task 2).
- **The `window.__wtc` hook** is intentional — it's the test/automation seam used in Task 7 (and lets an agent add comments programmatically).
- **Browser tasks are verified in headless Chrome, not `node:test`** — that's this viewer's established pattern (DOM code isn't Node-unit-testable). The rigorous `node:test` coverage is on `post-review.mjs` and `validateShape`.
- **`gh` is injected** into `postReview` so tests never hit the network; the real default uses `gh api … --input -` to send the nested `comments[]` body.
