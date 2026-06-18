# post-pr-review viewed-sync Implementation Plan (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on PR 1** (`2026-06-18-pr-walkthrough-viewer-ux.md`): the walkthrough export must emit `viewedFiles`. PR 2 is independently implementable/testable with hand-written JSON, but only useful once PR 1 ships.

**Goal:** Teach `post-pr-review` to honor a `viewedFiles` array in the exported review JSON by marking each file viewed on the GitHub PR via the `markFileAsViewed` GraphQL mutation.

**Architecture:** Extend the existing pure, injectable-runner pattern in `post-review.mjs`. A new `markFilesViewed(r, { graphql })` resolves the PR node id once, then issues one mutation per path. The default GraphQL runner shells out to `gh api graphql`; tests inject a fake. Mark-only (never unmark).

**Tech Stack:** Node ≥20 (stdlib only, `node:test`), `gh` CLI (GraphQL).

## Global Constraints

- **No new dependencies.** Reuse `execFileSync` and the existing injectable-runner style.
- **Mark only, never unmark.** No `unmarkFileAsViewed`.
- **`viewedFiles` is optional and independent of comments:** a payload with only `viewedFiles` (no comments/fileComments) is valid and just marks files viewed.
- Run `node --test skills/post-pr-review/scripts/post-review.test.mjs` after every task; it must stay green.
- This composes with the existing `gh`-error handling (and the 422/`GH_DEBUG` guidance if already merged) — do not remove it.

## File Structure

- `skills/post-pr-review/scripts/post-review.mjs` — add `ghGraphql`, `prNodeIdQuery`, `markViewedMutation`, `markFilesViewed`; extend `validateReview`; call `markFilesViewed` in `main`.
- `skills/post-pr-review/scripts/post-review.test.mjs` — validation + `markFilesViewed` tests with a fake GraphQL runner.
- `skills/post-pr-review/SKILL.md` — document the `viewedFiles` field and marking step.
- Generated: `skills/post-pr-review.zip`; Create: `.changeset/post-pr-review-viewed-sync.md`.

---

## Task 1: Validate `viewedFiles` and allow viewed-only reviews

**Files:**
- Modify: `skills/post-pr-review/scripts/post-review.mjs` (`validateReview` ~11-40)
- Test: `skills/post-pr-review/scripts/post-review.test.mjs`

**Interfaces:**
- Produces: `validateReview` accepts optional `viewedFiles: string[]`; the "nothing to post" error now also accounts for `viewedFiles`.

- [ ] **Step 1: Write failing tests** — append to `post-review.test.mjs`:

```js
test('validateReview accepts a viewed-only review (no comments)', () => {
  const r = { repo: 'acme/widgets', pr: 5, commit: 'abc123', viewedFiles: ['src/a.ts'] }
  assert.deepEqual(validateReview(r), [])
})

test('validateReview rejects non-string viewedFiles entries and a fully empty review', () => {
  assert.ok(validateReview(review({ viewedFiles: [123] })).some((e) => e.startsWith('viewedFiles[0]')))
  const empty = { repo: 'acme/widgets', pr: 5, commit: 'abc123', comments: [], fileComments: [], viewedFiles: [] }
  assert.ok(validateReview(empty).some((e) => e.includes('nothing to post')))
})
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: FAIL — viewed-only review currently reports the old "no comments to post" error.

- [ ] **Step 3: Implement** — in `validateReview`, add `viewedFiles` validation and replace the empty-check. After the `fileComments` validation block (after line 37), insert:

```js
  const viewedFiles = r.viewedFiles ?? []
  if (!Array.isArray(viewedFiles)) err('viewedFiles', 'must be an array')
  else viewedFiles.forEach((v, i) => { if (!isStr(v)) err(`viewedFiles[${i}]`, 'must be a non-empty string') })
```

Then replace line 38:

```js
  if (comments.length === 0 && fileComments.length === 0) err('<root>', 'no comments to post')
```
with:
```js
  if (comments.length === 0 && fileComments.length === 0 && viewedFiles.length === 0) err('<root>', 'nothing to post')
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: PASS (existing tests still green — the old "no comments" assertion in `validateReview rejects bad repo/side/line and empty review` checks `e.includes('no comments')`; update that assertion to `e.includes('nothing to post')`).

- [ ] **Step 5: Commit**

```bash
git add skills/post-pr-review/scripts/post-review.mjs skills/post-pr-review/scripts/post-review.test.mjs
git commit -m "feat(post-pr-review): validate optional viewedFiles, allow viewed-only reviews"
```

---

## Task 2: Mark files viewed via GraphQL

**Files:**
- Modify: `skills/post-pr-review/scripts/post-review.mjs` (add after `postReview` ~87)
- Test: `skills/post-pr-review/scripts/post-review.test.mjs`

**Interfaces:**
- Consumes: a review object with `repo`, `pr`, `viewedFiles`.
- Produces: `markFilesViewed(r, { graphql }): string[]` (paths marked). Default runner `ghGraphql(query, fields)`. On failure throws an `Error` with `.viewed` (paths done before the failure). Helpers `prNodeIdQuery()` and `markViewedMutation()` return the query strings.

- [ ] **Step 1: Write failing tests** — append:

```js
import { markFilesViewed } from './post-review.mjs'

function fakeGraphql() {
  const calls = []
  const graphql = (query, fields) => {
    calls.push({ query, fields })
    if (/pullRequest\(number/.test(query)) return { data: { repository: { pullRequest: { id: 'PR_node_1' } } } }
    return { data: { markFileAsViewed: { clientMutationId: null } } }
  }
  return { graphql, calls }
}

test('markFilesViewed resolves the PR id once then marks each path', () => {
  const { graphql, calls } = fakeGraphql()
  const done = markFilesViewed({ repo: 'acme/widgets', pr: 5, viewedFiles: ['src/a.ts', 'src/b.ts'] }, { graphql })
  assert.deepEqual(done, ['src/a.ts', 'src/b.ts'])
  assert.equal(calls.length, 3)                                  // 1 id query + 2 mutations
  assert.deepEqual(calls[0].fields, { owner: 'acme', name: 'widgets', number: 5 })
  assert.equal(calls[1].fields.id, 'PR_node_1')
  assert.equal(calls[1].fields.path, 'src/a.ts')
})

test('markFilesViewed is a no-op when viewedFiles is empty', () => {
  const { graphql, calls } = fakeGraphql()
  assert.deepEqual(markFilesViewed({ repo: 'a/b', pr: 1, viewedFiles: [] }, { graphql }), [])
  assert.equal(calls.length, 0)
})

test('markFilesViewed reports what was marked when a later mutation fails', () => {
  let n = 0
  const graphql = (query) => {
    if (/pullRequest\(number/.test(query)) return { data: { repository: { pullRequest: { id: 'X' } } } }
    n++; if (n === 2) throw new Error('boom'); return {}
  }
  assert.throws(() => markFilesViewed({ repo: 'a/b', pr: 1, viewedFiles: ['p1', 'p2'] }, { graphql }), (e) => {
    assert.deepEqual(e.viewed, ['p1'])
    return true
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: FAIL — `markFilesViewed is not a function`.

- [ ] **Step 3: Implement** — add to `post-review.mjs` after `postReview` (line 87):

```js
// Default GraphQL runner: `gh api graphql -f query=… (-F int | -f string)…`.
function ghGraphql(query, fields) {
  const args = ['api', 'graphql', '-f', 'query=' + query]
  for (const k of Object.keys(fields)) {
    const v = fields[k]
    args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  }
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return out.trim() ? JSON.parse(out) : {}
}

export function prNodeIdQuery() {
  return 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id}}}'
}
export function markViewedMutation() {
  return 'mutation($id:ID!,$path:String!){markFileAsViewed(input:{pullRequestId:$id,path:$path}){clientMutationId}}'
}

// Mark each path viewed on the PR (GitHub "Files changed" checkbox). Mark-only.
export function markFilesViewed(r, { graphql = ghGraphql } = {}) {
  const viewed = r.viewedFiles ?? []
  if (!viewed.length) return []
  const [owner, name] = r.repo.split('/')
  const idRes = graphql(prNodeIdQuery(), { owner, name, number: r.pr })
  const id = idRes && idRes.data && idRes.data.repository && idRes.data.repository.pullRequest && idRes.data.repository.pullRequest.id
  if (!id) throw new Error(`could not resolve PR node id for ${r.repo}#${r.pr}`)
  const done = []
  try {
    for (const path of viewed) { graphql(markViewedMutation(), { id, path }); done.push(path) }
  } catch (e) {
    const err = new Error('gh mark-viewed failed: ' + ((e.stderr || e.message || '') + '').trim())
    err.viewed = done
    throw err
  }
  return done
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test skills/post-pr-review/scripts/post-review.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/post-pr-review/scripts/post-review.mjs skills/post-pr-review/scripts/post-review.test.mjs
git commit -m "feat(post-pr-review): markFilesViewed via GraphQL markFileAsViewed"
```

---

## Task 3: Wire marking into `main` and document it

**Files:**
- Modify: `skills/post-pr-review/scripts/post-review.mjs` (`main` ~89-105)
- Modify: `skills/post-pr-review/SKILL.md`

- [ ] **Step 1: Call `markFilesViewed` after posting** — in `main`, replace the success tail (the block from `let posted` through the final `console.log`, lines 97-104) with:

```js
  let posted
  try { posted = postReview(r) }
  catch (e) {
    console.error(e.message)
    if (e.posted && e.posted.length) console.error('Already posted: ' + JSON.stringify(e.posted))
    process.exit(1)
  }
  let viewed = []
  try { viewed = markFilesViewed(r) }
  catch (e) {
    console.error(e.message)
    if (posted.length) console.error('Already posted: ' + JSON.stringify(posted))
    if (e.viewed && e.viewed.length) console.error('Marked viewed: ' + JSON.stringify(e.viewed))
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, posted, viewed }, null, 2))
```

(If the 422 `maybe422Hint` branch is present from the other PR, keep it in the `postReview` catch — it composes fine.)

- [ ] **Step 2: Syntax check + full suite**

Run:
```bash
node --check skills/post-pr-review/scripts/post-review.mjs
node --test skills/post-pr-review/scripts/post-review.test.mjs
```
Expected: exit 0; tests PASS.

- [ ] **Step 3: Document the field in SKILL.md** — in the Step 1 JSON example (the `jsonc` block ~lines 18-22), add the `viewedFiles` line:

```jsonc
{ "repo": "owner/name", "pr": 5, "commit": "<sha>", "body": "",
  "comments": [ { "path": "...", "side": "RIGHT", "line": 12, "body": "..." } ],
  "fileComments": [ { "path": "...", "body": "..." } ],
  "viewedFiles": [ "path/to/fully-reviewed-file" ] }
```

And add a bullet to the Step 2 result list (after the `gh` error bullet):

```markdown
- After posting comments, any `viewedFiles` are marked **viewed** on the PR's "Files changed" tab via GitHub's `markFileAsViewed` mutation (one call per path). A review may contain only `viewedFiles` (no comments) — it then just marks files viewed. The script prints `{ "ok": true, "posted": [...], "viewed": [...] }`; report the viewed count alongside the review URL.
```

- [ ] **Step 4: Commit**

```bash
git add skills/post-pr-review/scripts/post-review.mjs skills/post-pr-review/SKILL.md
git commit -m "feat(post-pr-review): mark viewedFiles after posting; document the field"
```

---

## Task 4: Changeset + rebuilt zip

**Files:**
- Create: `.changeset/post-pr-review-viewed-sync.md`
- Generated: `skills/post-pr-review.zip`

- [ ] **Step 1: Add the changeset** — create `.changeset/post-pr-review-viewed-sync.md`:

```markdown
---
"hal-agent-skills-build": minor
---

post-pr-review now honors a `viewedFiles` array in the exported review: after posting comments it marks each listed file viewed on the PR's "Files changed" tab via GitHub's `markFileAsViewed` mutation. A review may contain only `viewedFiles` (no comments). Mark-only — it never unmarks.
```

- [ ] **Step 2: Rebuild the zip**

Run: `npm --prefix packages/hal-agent-skills run build`
Expected: `✓ post-pr-review.zip`. `git add` only `post-pr-review.zip` (leave unrelated stale zips alone).

- [ ] **Step 3: Live smoke test (human checkpoint)**

Against a scratch PR you own, run `post-review.mjs` on an export containing `viewedFiles` and confirm those files show as checked on the PR's "Files changed" tab. (`gh` must be authenticated.)

- [ ] **Step 4: Commit**

```bash
git add skills/post-pr-review.zip .changeset/post-pr-review-viewed-sync.md
git commit -m "chore(post-pr-review): changeset + rebuilt zip for viewed-sync"
```

---

## Self-Review (completed against the spec)

- **`viewedFiles` validation + viewed-only reviews** → Task 1. ✅
- **`markFileAsViewed` via GraphQL, id resolved once, one mutation per path** → Task 2. ✅
- **Independent of comments; mark-only** → Tasks 1, 2 (no unmark). ✅
- **Wired into the existing post flow; composes with `gh`-error/422 handling** → Task 3. ✅
- **SKILL.md documents the field + behavior** → Task 3. ✅
- **Changeset + zip** → Task 4. ✅
- **Type consistency:** `markFilesViewed`/`prNodeIdQuery`/`markViewedMutation` names match across implementation, tests, and `main`. Output shape `{ ok, posted, viewed }`. ✅
