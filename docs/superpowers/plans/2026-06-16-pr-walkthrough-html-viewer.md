# PR Walkthrough HTML Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the `pr-walkthrough` skill from emitting a markdown file to producing a single self-contained HTML viewer (GitHub-style split diffs, markdown prose) where the agent writes only a pointer-based JSON and a deterministic Node script resolves + renders it.

**Architecture:** The agent writes `walkthrough.json` (prose + *pointers* to changed files/lines — no code inlined). A plain-Node script `build-walkthrough.mjs` validates the JSON (shape), resolves each pointer against git (referential integrity, git-exact diffs), and inlines `styles.css` + `viewer.js` + the resolved data into `template.html`, producing one `PR-<n>-<slug>.html`. The browser-side `viewer.js` renders Layout A (sticky sidebar + long scroll), parses unified diffs into split tables, renders prose via markdown-it, and syntax-highlights via highlight.js — both loaded from pinned CDNs as progressive enhancements.

**Tech Stack:** Node ≥20 (stdlib only: `node:fs`, `node:path`, `node:child_process`, `node:url`, `node:test`), vanilla browser JS, highlight.js + markdown-it via CDN (pinned + SRI). No bundler, no runtime npm dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-pr-walkthrough-html-design.md`

**Conventions:**
- All commands are run from the repo root: `/Users/haldunanil/Development/agent-skills`.
- Run tests with: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
- Commit messages use Conventional Commits and end with the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- Work happens on branch `feat/pr-walkthrough-html-viewer` (already created; the spec is committed there).

---

## File Structure

**New files (`skills/pr-walkthrough/`):**
- `scripts/build-walkthrough.mjs` — validate + resolve pointers via git + inline → standalone HTML. Exports pure functions for testing; `main()` is the CLI.
- `scripts/build-walkthrough.test.mjs` — `node:test` suite for the pure functions and CLI build path (fake diff provider, temp assets).
- `assets/template.html` — HTML skeleton: pinned CDN `<link>`/`<script>` for highlight.js + markdown-it (with SRI), plus three slot tokens.
- `assets/styles.css` — Layout A theme (sidebar, sticky headers, split-diff coloring, markdown prose).
- `assets/viewer.js` — browser renderer: data → DOM, unified→split diff tables, markdown, lazy highlight, sidebar nav, collapse.

**Modified files:**
- `SKILL.md` — controller: compute `.json` + `.html` paths, add the build step, preflight `node`, update Red Flags.
- `walkthrough-prompt.md` — rewrite so the agent emits pointer JSON (prose = markdown), reads diffs but never copies them, and self-validates.

**Responsibilities are split so each file holds one concern:** validation/resolution/inlining (Node) is separate from rendering (browser), which is separate from theme (CSS) and skeleton (HTML).

---

## Task 1: Shape validation (`validateShape`)

**Files:**
- Create: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Create: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateShape } from './build-walkthrough.mjs'

function validData() {
  return {
    pr: { number: 482, repo: 'acme/widgets', title: 'Add auth', author: 'me',
          headBranch: 'feat', baseBranch: 'main', url: 'https://x', filesCount: 2, commitsCount: 1 },
    summary: 'orientation',
    chapters: [{
      id: 'schema', title: 'Schema', intro: 'intro',
      sections: [{
        file: 'src/user.ts', unit: null, lines: null, kind: 'normal',
        narrative: 'what changed',
        contexts: [{ ref: 'src/helper.ts', lines: [42, 58], note: 'ctx' }],
      }],
    }],
    crossCutting: '- a note',
    openQuestions: '- a question',
    commitMap: [{ sha: 'abc1234', message: 'Add auth schema', chapters: ['Schema'] }],
  }
}

test('validateShape: valid document has no errors', () => {
  assert.deepEqual(validateShape(validData()), [])
})

test('validateShape: missing pr.title is reported with a path', () => {
  const d = validData(); delete d.pr.title
  const errors = validateShape(d)
  assert.ok(errors.some((e) => e.startsWith('pr.title')), errors.join('; '))
})

test('validateShape: unknown kind is rejected', () => {
  const d = validData(); d.chapters[0].sections[0].kind = 'weird'
  const errors = validateShape(d)
  assert.ok(errors.some((e) => e.includes('sections[0].kind')), errors.join('; '))
})

test('validateShape: lines must be ordered [start,end]', () => {
  const d = validData(); d.chapters[0].sections[0].lines = [10, 4]
  assert.ok(validateShape(d).some((e) => e.includes('.lines')))
})

test('validateShape: crossCutting/openQuestions must be strings', () => {
  const d = validData(); d.crossCutting = ['no', 'arrays']
  assert.ok(validateShape(d).some((e) => e.startsWith('crossCutting')))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `Cannot find module '.../build-walkthrough.mjs'` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `skills/pr-walkthrough/scripts/build-walkthrough.mjs`:

```js
#!/usr/bin/env node
// Validate + resolve a PR-walkthrough pointer JSON and render a self-contained HTML viewer.

const KINDS = new Set(['normal', 'lockfile', 'generated', 'binary'])

const isStr = (v) => typeof v === 'string'
const isInt = (v) => Number.isInteger(v)
const isArr = Array.isArray
const isLinePair = (v) => isArr(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] <= v[1]

export function validateShape(data) {
  const errors = []
  const err = (p, m) => errors.push(`${p}: ${m}`)

  if (typeof data !== 'object' || data === null || isArr(data)) return ['<root>: must be an object']

  const pr = data.pr
  if (typeof pr !== 'object' || pr === null || isArr(pr)) {
    err('pr', 'must be an object')
  } else {
    for (const k of ['title', 'repo', 'author', 'headBranch', 'baseBranch', 'url']) {
      if (!isStr(pr[k])) err(`pr.${k}`, 'must be a string')
    }
    for (const k of ['number', 'filesCount', 'commitsCount']) {
      if (!isInt(pr[k])) err(`pr.${k}`, 'must be an integer')
    }
  }

  if (!isStr(data.summary)) err('summary', 'must be a markdown string')
  if (!isStr(data.crossCutting)) err('crossCutting', 'must be a markdown string')
  if (!isStr(data.openQuestions)) err('openQuestions', 'must be a markdown string')

  if (!isArr(data.chapters)) {
    err('chapters', 'must be an array')
  } else {
    data.chapters.forEach((ch, ci) => {
      const cp = `chapters[${ci}]`
      for (const k of ['id', 'title', 'intro']) {
        if (!isStr(ch?.[k])) err(`${cp}.${k}`, 'must be a string')
      }
      if (!isArr(ch?.sections)) err(`${cp}.sections`, 'must be an array')
      else ch.sections.forEach((s, si) => validateSection(s, `${cp}.sections[${si}]`, err))
    })
  }

  if (!isArr(data.commitMap)) {
    err('commitMap', 'must be an array')
  } else {
    data.commitMap.forEach((c, i) => {
      const p = `commitMap[${i}]`
      if (!isStr(c?.sha)) err(`${p}.sha`, 'must be a string')
      if (!isStr(c?.message)) err(`${p}.message`, 'must be a string')
      if (!isArr(c?.chapters) || !c.chapters.every(isStr)) err(`${p}.chapters`, 'must be an array of strings')
    })
  }

  return errors
}

function validateSection(s, p, err) {
  if (typeof s !== 'object' || s === null || isArr(s)) { err(p, 'must be an object'); return }
  if (!isStr(s.file)) err(`${p}.file`, 'must be a string')
  if (!(s.unit === null || isStr(s.unit))) err(`${p}.unit`, 'must be null or a string')
  if (!(s.lines === null || isLinePair(s.lines))) err(`${p}.lines`, 'must be null or [start,end] with start<=end')
  if (!KINDS.has(s.kind)) err(`${p}.kind`, `must be one of ${[...KINDS].join('|')}`)
  if (!isStr(s.narrative)) err(`${p}.narrative`, 'must be a markdown string')

  if (s.kind !== 'normal' && !isStr(s.note)) err(`${p}.note`, `must be a string when kind=${s.kind}`)
  if (s.kind === 'generated' && !isStr(s.derivedFrom)) err(`${p}.derivedFrom`, 'must be a string when kind=generated')

  if (s.contexts !== undefined) {
    if (!isArr(s.contexts)) { err(`${p}.contexts`, 'must be an array'); return }
    s.contexts.forEach((c, i) => {
      const cp = `${p}.contexts[${i}]`
      if (!isStr(c?.ref)) err(`${cp}.ref`, 'must be a string')
      if (!isLinePair(c?.lines)) err(`${cp}.lines`, 'must be [start,end] with start<=end')
      if (!isStr(c?.note)) err(`${cp}.note`, 'must be a markdown string')
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): shape validation for walkthrough JSON\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Hunk parsing and line-range slicing (`selectHunks`)

This is the one genuinely non-trivial bit of resolver logic: given a file's unified diff and a `[start,end]` range in the **new** file, keep only the hunks that overlap that range (how sub-sections show a slice).

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`:

```js
import { parseHunkHeader, selectHunks } from './build-walkthrough.mjs'

const TWO_HUNK_DIFF = [
  'diff --git a/src/user.ts b/src/user.ts',
  'index 1111111..2222222 100644',
  '--- a/src/user.ts',
  '+++ b/src/user.ts',
  '@@ -10,3 +10,4 @@ class User {',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
  '@@ -120,2 +130,3 @@ function logout() {',
  ' const x = 1',
  '+const y = 2',
].join('\n')

test('parseHunkHeader extracts old/new starts and lengths', () => {
  assert.deepEqual(parseHunkHeader('@@ -10,3 +10,4 @@ class User {'),
    { oldStart: 10, oldLen: 3, newStart: 10, newLen: 4 })
})

test('parseHunkHeader defaults length to 1 when omitted', () => {
  assert.deepEqual(parseHunkHeader('@@ -5 +6 @@'),
    { oldStart: 5, oldLen: 1, newStart: 6, newLen: 1 })
})

test('selectHunks(null) returns the whole diff unchanged', () => {
  assert.equal(selectHunks(TWO_HUNK_DIFF, null), TWO_HUNK_DIFF)
})

test('selectHunks keeps only the hunk overlapping the new-file range', () => {
  const sliced = selectHunks(TWO_HUNK_DIFF, [10, 13])
  assert.ok(sliced.includes('@@ -10,3 +10,4 @@'))
  assert.ok(!sliced.includes('@@ -120,2 +130,3 @@'))
  // file header is preserved so the slice is still a valid diff
  assert.ok(sliced.includes('--- a/src/user.ts'))
  assert.ok(sliced.includes('+++ b/src/user.ts'))
})

test('selectHunks keeps the second hunk when the range targets it', () => {
  const sliced = selectHunks(TWO_HUNK_DIFF, [130, 132])
  assert.ok(sliced.includes('@@ -120,2 +130,3 @@'))
  assert.ok(!sliced.includes('@@ -10,3 +10,4 @@'))
})

test('selectHunks drops all hunks when a range overlaps nothing', () => {
  assert.ok(!/^@@ /m.test(selectHunks(TWO_HUNK_DIFF, [9999, 10000])))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `parseHunkHeader`/`selectHunks` are not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Add to `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (below `validateSection`):

```js
// ---------- hunk parsing / slicing ----------
export function parseHunkHeader(line) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
  if (!m) return null
  return {
    oldStart: +m[1], oldLen: m[2] === undefined ? 1 : +m[2],
    newStart: +m[3], newLen: m[4] === undefined ? 1 : +m[4],
  }
}

function splitDiff(diffText) {
  const header = []
  const hunks = []
  let cur = null
  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      const h = parseHunkHeader(line)
      cur = { headerLine: line, body: [], newStart: h ? h.newStart : 0, newLen: h ? h.newLen : 0 }
      hunks.push(cur)
    } else if (cur) {
      cur.body.push(line)
    } else {
      header.push(line)
    }
  }
  return { header, hunks }
}

const overlaps = (a, b, c, d) => a <= d && c <= b

export function selectHunks(diffText, lines) {
  if (lines === null || lines === undefined) return diffText
  const [start, end] = lines
  const { header, hunks } = splitDiff(diffText)
  const kept = hunks.filter((h) => {
    // ponytail: a 0-length new side (pure deletion) is treated as a point at newStart
    const last = h.newLen === 0 ? h.newStart : h.newStart + h.newLen - 1
    return overlaps(h.newStart, last, start, end)
  })
  const out = [...header]
  for (const h of kept) out.push(h.headerLine, ...h.body)
  return out.join('\n')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — all Task 1 + Task 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): unified-diff hunk slicing by new-file line range\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Referential resolution (`resolveSections`, `gitDiffProvider`)

Resolve each pointer against a diff provider (injected so tests need no git), embedding git-exact payloads and failing loudly on bogus pointers.

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { resolveSections } from './build-walkthrough.mjs'

function fakeProvider(diffs, codes) {
  return {
    fileDiff: (file) => diffs[file] ?? '',
    showLines: (ref) => codes[ref] ?? '',
  }
}

function docWithSection(over = {}) {
  const d = validData()
  Object.assign(d.chapters[0].sections[0], over)
  return d
}

test('resolveSections embeds the git-exact diff on normal sections', () => {
  const d = docWithSection({ contexts: [] })
  resolveSections(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  assert.equal(d.chapters[0].sections[0].resolvedDiff, TWO_HUNK_DIFF)
})

test('resolveSections slices when lines is set', () => {
  const d = docWithSection({ lines: [10, 13], contexts: [] })
  resolveSections(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  const sliced = d.chapters[0].sections[0].resolvedDiff
  assert.ok(sliced.includes('@@ -10,3 +10,4 @@'))
  assert.ok(!sliced.includes('@@ -120,2 +130,3 @@'))
})

test('resolveSections throws when a normal file has no diff', () => {
  const d = docWithSection({ contexts: [] })
  assert.throws(() => resolveSections(d, fakeProvider({}, {})), /no diff found/)
})

test('resolveSections throws when lines overlap no hunks', () => {
  const d = docWithSection({ lines: [9999, 10000], contexts: [] })
  assert.throws(() => resolveSections(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {})), /overlap no hunks/)
})

test('resolveSections embeds context code and throws when empty', () => {
  const ok = docWithSection({})
  resolveSections(ok, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'function helper() {}' }))
  assert.equal(ok.chapters[0].sections[0].contexts[0].resolvedCode, 'function helper() {}')

  const bad = docWithSection({})
  assert.throws(() => resolveSections(bad, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {})), /resolved to empty/)
})

test('resolveSections does not fetch diffs for lockfile sections', () => {
  const d = docWithSection({ file: 'package-lock.json', kind: 'lockfile', note: '12 deps', contexts: [] })
  // provider would return '' for the lockfile; should not throw because kind!=normal
  resolveSections(d, fakeProvider({}, {}))
  assert.equal(d.chapters[0].sections[0].resolvedDiff, undefined)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `resolveSections` not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Add to `skills/pr-walkthrough/scripts/build-walkthrough.mjs`. First add the imports at the very top of the file (just under the shebang/comment):

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
```

Then add (below `selectHunks`):

```js
// ---------- referential resolution (layer 2) ----------
export function gitDiffProvider(base, head) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  return {
    fileDiff: (file) => execFileSync('git', ['diff', `${base}...${head}`, '--', file], opts),
    showLines: (ref, [a, b]) =>
      execFileSync('git', ['show', `${base}:${ref}`], opts).split('\n').slice(a - 1, b).join('\n'),
  }
}

export function resolveSections(data, provider) {
  for (const ch of data.chapters) {
    for (const s of ch.sections) {
      if (s.kind === 'normal') {
        const raw = provider.fileDiff(s.file)
        if (!raw || !raw.trim()) throw new Error(`${s.file}: kind=normal but no diff found in this PR`)
        const sliced = s.lines ? selectHunks(raw, s.lines) : raw
        // a sliced diff with no `@@ ` hunk header means the range matched nothing
        if (s.lines && !/^@@ /m.test(sliced)) throw new Error(`${s.file}: lines [${s.lines}] overlap no hunks`)
        s.resolvedDiff = sliced
      }
      for (const c of s.contexts || []) {
        const code = provider.showLines(c.ref, c.lines)
        if (!code || !code.trim()) throw new Error(`${s.file}: context ${c.ref} [${c.lines}] resolved to empty`)
        c.resolvedCode = code
      }
    }
  }
  return data
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — all tests through Task 3 pass.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): resolve pointers against git with referential checks\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Inlining and rendering (`escapeForScript`, `renderHtml`)

Inline `styles.css` + `viewer.js` + the resolved JSON into `template.html`, escaping `</script` so diff text can't break out of the data slot. Tests use temporary fake assets so they don't depend on the real ones.

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { mkdtempSync, writeFileSync as writeFileSyncT } from 'node:fs'
import { tmpdir } from 'node:os'
import path2 from 'node:path'
import { escapeForScript, renderHtml, SLOT_STYLES, SLOT_VIEWER, SLOT_DATA } from './build-walkthrough.mjs'

function tempAssets() {
  const dir = mkdtempSync(path2.join(tmpdir(), 'pw-assets-'))
  writeFileSyncT(path2.join(dir, 'template.html'),
    `<!DOCTYPE html><html><head>${SLOT_STYLES}</head><body>` +
    `<script id="walkthrough-data" type="application/json">${SLOT_DATA}</script>${SLOT_VIEWER}</body></html>`)
  writeFileSyncT(path2.join(dir, 'styles.css'), 'body{color:red}')
  writeFileSyncT(path2.join(dir, 'viewer.js'), "console.log('viewer')")
  return dir
}

test('escapeForScript neutralizes closing script tags', () => {
  assert.equal(escapeForScript('a</script>b'), 'a<\\/script>b')
  assert.equal(escapeForScript('x</SCRIPT >y'), 'x<\\/SCRIPT >y')
})

test('renderHtml inlines css, viewer js, and escaped data', () => {
  const assetsDir = tempAssets()
  const data = { hello: 'world', danger: '</script><script>alert(1)</script>' }
  const html = renderHtml(data, { assetsDir })

  assert.ok(html.includes('<style>'))
  assert.ok(html.includes('body{color:red}'))
  assert.ok(html.includes("console.log('viewer')"))
  assert.ok(html.includes('"hello":"world"'))
  // the raw closing tag must NOT survive inside the data slot
  assert.ok(!html.includes('</script><script>alert(1)'))
  assert.ok(html.includes('<\\/script>'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `escapeForScript`/`renderHtml`/slot constants not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (below the imports, near the top with the other constants):

```js
// Template slot tokens — template.html MUST contain these exact comments.
export const SLOT_STYLES = '<!--PR_WALKTHROUGH_STYLES-->'
export const SLOT_VIEWER = '<!--PR_WALKTHROUGH_VIEWER_JS-->'
export const SLOT_DATA = '<!--PR_WALKTHROUGH_DATA-->'
```

And add (below `resolveSections`):

```js
// ---------- inlining / rendering ----------
export function escapeForScript(s) {
  return s.replace(/<\/script/gi, '<\\/script')
}

export function renderHtml(data, { assetsDir }) {
  const tpl = readFileSync(path.join(assetsDir, 'template.html'), 'utf8')
  const css = readFileSync(path.join(assetsDir, 'styles.css'), 'utf8')
  const js = readFileSync(path.join(assetsDir, 'viewer.js'), 'utf8')
  const json = escapeForScript(JSON.stringify(data))
  // Function replacers avoid `$`-pattern interpretation in css/js/json content.
  return tpl
    .replace(SLOT_STYLES, () => `<style>\n${css}\n</style>`)
    .replace(SLOT_VIEWER, () => `<script>\n${js}\n</script>`)
    .replace(SLOT_DATA, () => json)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): inline assets and data into the HTML template\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Orchestration and CLI (`buildDocument`, `main`)

Wire validation → resolution → render into one function, plus a CLI with `--validate` and build modes.

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { buildDocument } from './build-walkthrough.mjs'

test('buildDocument validates, resolves, and renders to HTML', () => {
  const assetsDir = tempAssets()
  const data = validData()
  const html = buildDocument(data, {
    assetsDir,
    provider: fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'function helper(){}' }),
  })
  assert.ok(html.includes('<!DOCTYPE html>'))
  assert.ok(html.includes('"resolvedDiff"'))
})

test('buildDocument throws with all validation errors when shape is bad', () => {
  const assetsDir = tempAssets()
  const data = validData(); delete data.pr.title; data.summary = 5
  assert.throws(() => buildDocument(data, { assetsDir, provider: fakeProvider({}, {}) }), (e) => {
    assert.ok(Array.isArray(e.validation))
    assert.ok(e.validation.some((m) => m.startsWith('pr.title')))
    assert.ok(e.validation.some((m) => m.startsWith('summary')))
    return true
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `buildDocument` not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (below `renderHtml`):

```js
// ---------- orchestration + CLI ----------
export function buildDocument(data, { provider, assetsDir }) {
  const errors = validateShape(data)
  if (errors.length) {
    const e = new Error('Validation failed:\n' + errors.join('\n'))
    e.validation = errors
    throw e
  }
  resolveSections(data, provider)
  return renderHtml(data, { assetsDir })
}

function assetsDirFromScript() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
}

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++ }
  }
  return a
}

function main(argv) {
  const args = parseArgs(argv)

  if (args.validate) {
    const data = JSON.parse(readFileSync(args.validate, 'utf8'))
    const errors = validateShape(data)
    if (args.base && args.head && errors.length === 0) {
      try { resolveSections(data, gitDiffProvider(args.base, args.head)) }
      catch (e) { errors.push(e.message) }
    }
    if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
    console.log('ok')
    return
  }

  if (args.data && args.out && args.base && args.head) {
    const data = JSON.parse(readFileSync(args.data, 'utf8'))
    let html
    try {
      html = buildDocument(data, { provider: gitDiffProvider(args.base, args.head), assetsDir: assetsDirFromScript() })
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }
    writeFileSync(args.out, html)
    console.log(args.out)
    return
  }

  console.error('usage:')
  console.error('  build-walkthrough.mjs --validate <data.json> [--base <ref> --head <ref>]')
  console.error('  build-walkthrough.mjs --data <data.json> --out <out.html> --base <ref> --head <ref>')
  process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — full suite green.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): buildDocument orchestration and CLI entrypoint\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: HTML template with pinned CDN libraries (`assets/template.html`)

**Files:**
- Create: `skills/pr-walkthrough/assets/template.html`
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Compute the SRI hashes for the pinned CDN URLs**

These hashes are environment-derived (the bytes at each pinned URL); they cannot be hard-coded blindly. Run this to produce the exact `integrity` values, then paste each into the template in Step 3:

```bash
for url in \
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" \
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" \
  "https://cdnjs.cloudflare.com/ajax/libs/markdown-it/14.1.0/markdown-it.min.js"; do
  printf '%s\n  integrity="sha384-%s"\n' "$url" \
    "$(curl -sS "$url" | openssl dgst -sha384 -binary | openssl base64 -A)"
done
```

Expected: three lines each printing a URL and a `integrity="sha384-..."` string. Keep them for Step 3.

- [ ] **Step 2: Write the failing test**

Append to `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`:

```js
import { readFileSync as readFileSyncT } from 'node:fs'
import { fileURLToPath as f2u } from 'node:url'

const REAL_ASSETS = path2.join(path2.dirname(f2u(import.meta.url)), '..', 'assets')

test('real template.html contains all three slot tokens', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  for (const slot of [SLOT_STYLES, SLOT_VIEWER, SLOT_DATA]) {
    assert.ok(tpl.includes(slot), `missing ${slot}`)
  }
})

test('real template.html loads CDN libs with SRI on every CDN tag', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  // every CDN <script>/<link> must carry a non-empty sha384 integrity attribute
  const cdnTags = tpl.match(/<(script|link)[^>]*cdnjs[^>]*>/g) || []
  assert.ok(cdnTags.length >= 3, 'expected at least 3 CDN tags (hljs css + hljs js + markdown-it)')
  for (const tag of cdnTags) assert.ok(/integrity="sha384-.+?"/.test(tag), `no SRI on: ${tag}`)
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `template.html` does not exist (`ENOENT`).

- [ ] **Step 4: Create the template**

Create `skills/pr-walkthrough/assets/template.html`, replacing the three `integrity="sha384-..."` values with the matching outputs from Step 1 (each `integrity` line goes on the tag for its URL):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PR Walkthrough</title>
  <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"
        integrity="sha384-PASTE_HLJS_CSS_HASH"
        crossorigin="anonymous" referrerpolicy="no-referrer">
  <!--PR_WALKTHROUGH_STYLES-->
</head>
<body>
  <div id="app">
    <noscript>This walkthrough needs JavaScript to render. The data is in the script tag below.</noscript>
  </div>

  <script id="walkthrough-data" type="application/json"><!--PR_WALKTHROUGH_DATA--></script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"
          integrity="sha384-PASTE_HLJS_JS_HASH"
          crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/markdown-it/14.1.0/markdown-it.min.js"
          integrity="sha384-PASTE_MARKDOWN_IT_HASH"
          crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <!--PR_WALKTHROUGH_VIEWER_JS-->
</body>
</html>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — both new template tests pass (the SRI test fails if any `integrity` is still the literal `PASTE_...`, because `sha384-.+` requires real content — re-run Step 1/Step 4 if so).

- [ ] **Step 6: Commit**

```bash
git add skills/pr-walkthrough/assets/template.html skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'feat(pr-walkthrough): HTML template with pinned CDN libs and SRI\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: Layout A theme (`assets/styles.css`)

Visual asset — verified in the browser in Task 12, no unit test.

**Files:**
- Create: `skills/pr-walkthrough/assets/styles.css`

- [ ] **Step 1: Create the stylesheet**

Create `skills/pr-walkthrough/assets/styles.css`:

```css
:root {
  --bg: #0d1117; --panel: #161b22; --border: #30363d; --fg: #c9d1d9; --muted: #8b949e;
  --link: #58a6ff; --add-bg: #12261e; --add-num: #2ea043; --del-bg: #25171c; --del-num: #f85149;
  --sidebar-w: 300px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
code, pre, .diff code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }

.topbar { padding: 20px 28px; border-bottom: 1px solid var(--border); background: var(--panel); }
.topbar h1 { margin: 0 0 6px; font-size: 20px; }
.topbar .meta { color: var(--muted); font-size: 13px; }
.topbar .meta a { color: var(--link); }
.topbar .summary { margin-top: 12px; max-width: 80ch; }
.topbar .controls { margin-top: 12px; }
.topbar button {
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.topbar button:hover { border-color: var(--link); }

.layout { display: flex; align-items: flex-start; }
.sidebar {
  width: var(--sidebar-w); flex: 0 0 var(--sidebar-w); position: sticky; top: 0;
  max-height: 100vh; overflow: auto; padding: 16px; border-right: 1px solid var(--border);
}
.sidebar .chap { margin-bottom: 10px; }
.sidebar .chap > .chap-title { font-weight: 600; display: block; margin-bottom: 4px; }
.sidebar .file-link { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0 2px 12px; color: var(--fg); }
.sidebar .file-link:hover { color: var(--link); }
.sidebar .file-link.active { color: var(--link); font-weight: 600; }
.sidebar .counts { color: var(--muted); white-space: nowrap; }
.sidebar .counts .add { color: var(--add-num); }
.sidebar .counts .del { color: var(--del-num); }
.sidebar .tail-link { display: block; padding: 2px 0; margin-top: 4px; }

.main { flex: 1 1 auto; min-width: 0; padding: 8px 28px 120px; }
.chapter > h2 { font-size: 18px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }

.file { border: 1px solid var(--border); border-radius: 8px; margin: 18px 0; overflow: hidden; }
.file > .file-head {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px;
  background: var(--panel); padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer;
}
.file > .file-head .path { font-family: ui-monospace, monospace; font-weight: 600; }
.file > .file-head .badge {
  font-size: 11px; text-transform: uppercase; color: var(--muted);
  border: 1px solid var(--border); border-radius: 10px; padding: 0 7px;
}
.file > .file-head .counts { margin-left: auto; color: var(--muted); }
.file > .file-head .counts .add { color: var(--add-num); }
.file > .file-head .counts .del { color: var(--del-num); }
.file > .file-head .caret { transition: transform .12s; }
.file.collapsed > .file-head .caret { transform: rotate(-90deg); }
.file.collapsed > .file-body { display: none; }
.file-body { padding: 12px; }

.prose { max-width: 84ch; }
.prose h1, .prose h2, .prose h3 { font-size: 15px; margin: 12px 0 4px; }
.prose ul, .prose ol { padding-left: 22px; }
.prose code { background: var(--panel); border-radius: 4px; padding: 1px 5px; font-size: 12.5px; }
.prose pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow: auto; }
.md-fallback { white-space: pre-wrap; background: var(--panel); padding: 10px; border-radius: 6px; }

.context { border-left: 3px solid var(--border); background: var(--panel); padding: 8px 12px; margin: 10px 0; border-radius: 0 6px 6px 0; }
.context .label { font-size: 11px; text-transform: uppercase; color: var(--muted); }
.context-code { margin: 6px 0 0; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px; overflow: auto; }

table.diff { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 10px; font-size: 12.5px; }
table.diff td { vertical-align: top; padding: 0 8px; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
table.diff td.lno, table.diff td.rno {
  width: 1%; min-width: 44px; text-align: right; color: var(--muted); user-select: none;
  border-right: 1px solid var(--border); padding: 0 6px;
}
table.diff td.lc { border-right: 1px solid var(--border); }
table.diff td.del { background: var(--del-bg); }
table.diff td.add { background: var(--add-bg); }
table.diff td.empty { background: #0b0f14; }
table.diff tr.hunksep td { background: var(--panel); color: var(--muted); padding: 2px 8px; }
table.diff code { background: none; padding: 0; }

.tail { margin-top: 40px; }
.tail h2 { font-size: 18px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
table.commits { width: 100%; border-collapse: collapse; }
table.commits th, table.commits td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); }
table.commits td.sha { font-family: ui-monospace, monospace; color: var(--muted); }

.empty-state { padding: 80px 28px; text-align: center; color: var(--muted); }
```

- [ ] **Step 2: Commit**

```bash
git add skills/pr-walkthrough/assets/styles.css
git commit -m "$(printf 'feat(pr-walkthrough): Layout A stylesheet for the HTML viewer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: Browser renderer (`assets/viewer.js`)

Renders the embedded JSON into Layout A: top bar, sidebar, chapters/sections, split-diff tables, markdown prose, context callouts, lazy syntax highlighting, collapse, active-on-scroll, and the empty state. Verified in the browser in Task 12.

**Files:**
- Create: `skills/pr-walkthrough/assets/viewer.js`

- [ ] **Step 1: Create the renderer**

Create `skills/pr-walkthrough/assets/viewer.js`:

```js
/* PR Walkthrough viewer — renders the embedded walkthrough JSON into Layout A.
   highlight.js (window.hljs) and markdown-it (window.markdownit) are optional CDN
   progressive enhancements; the page renders fully without them. */
(function () {
  'use strict'

  var dataEl = document.getElementById('walkthrough-data')
  var data
  try { data = JSON.parse(dataEl.textContent) } catch (e) { data = null }

  var md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: false }) : null
  var app = document.getElementById('app')

  var EXT_LANG = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', sql: 'sql', css: 'css', scss: 'scss', html: 'xml', xml: 'xml',
  }
  function langOf(file) {
    var ext = (file.split('.').pop() || '').toLowerCase()
    return EXT_LANG[ext] || ''
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function prose(srcMarkdown) {
    var div = el('div', 'prose')
    if (!srcMarkdown) return div
    if (md) div.innerHTML = md.render(srcMarkdown)         // html:false → input HTML is escaped
    else { var pre = el('pre', 'md-fallback'); pre.textContent = srcMarkdown; div.appendChild(pre) }
    return div
  }

  function diffStats(diffText) {
    var add = 0, del = 0, lines = (diffText || '').split('\n')
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i]
      if (l.charAt(0) === '+' && l.slice(0, 3) !== '+++') add++
      else if (l.charAt(0) === '-' && l.slice(0, 3) !== '---') del++
    }
    return { add: add, del: del }
  }

  function parseHunkHeader(line) {
    var m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    return m ? { oldStart: +m[1], newStart: +m[2] } : null
  }

  // side is 'left' or 'right' (which gutter); cls drives the color (del/add/ctx/empty).
  function codeCell(side, no, text, cls, lang) {
    var num = el('td', (side === 'right' ? 'rno ' : 'lno ') + cls, no === '' ? '' : String(no))
    var td = el('td', (side === 'right' ? 'rc ' : 'lc ') + cls)
    if (cls !== 'empty') {
      var c = el('code', null, text)
      if (lang) c.setAttribute('data-lang', lang)
      td.appendChild(c)
    }
    return [num, td]
  }

  function appendRow(table, left, right) {
    var tr = el('tr')
    tr.appendChild(left[0]); tr.appendChild(left[1]); tr.appendChild(right[0]); tr.appendChild(right[1])
    table.appendChild(tr)
  }

  function buildDiff(diffText, lang) {
    var table = el('table', 'diff')
    var lines = diffText.split('\n')
    var i = 0
    while (i < lines.length && lines[i].slice(0, 2) !== '@@') i++
    while (i < lines.length) {
      var hh = parseHunkHeader(lines[i])
      if (!hh) { i++; continue }
      var sep = el('tr', 'hunksep'); var sepTd = el('td', null, lines[i]); sepTd.colSpan = 4
      sep.appendChild(sepTd); table.appendChild(sep)
      var oldNo = hh.oldStart, newNo = hh.newStart
      i++
      var dels = [], adds = []
      function flush() {
        var n = Math.max(dels.length, adds.length)
        for (var k = 0; k < n; k++) {
          var d = dels[k], a = adds[k]
          var left = d ? codeCell('left', d.no, d.text, 'del', lang) : codeCell('left', '', '', 'empty', lang)
          var right = a ? codeCell('right', a.no, a.text, 'add', lang) : codeCell('right', '', '', 'empty', lang)
          appendRow(table, left, right)
        }
        dels = []; adds = []
      }
      for (; i < lines.length && lines[i].slice(0, 2) !== '@@'; i++) {
        var ln = lines[i]
        if (ln.charAt(0) === '\\') continue            // "\ No newline at end of file"
        var tag = ln.charAt(0), text = ln.slice(1)
        if (tag === '-') dels.push({ no: oldNo++, text: text })
        else if (tag === '+') adds.push({ no: newNo++, text: text })
        else {
          flush()
          appendRow(table, codeCell('left', oldNo, text, 'ctx', lang), codeCell('right', newNo, text, 'ctx', lang))
          oldNo++; newNo++
        }
      }
      flush()
    }
    return table
  }

  function contextBlock(c) {
    var box = el('div', 'context')
    box.appendChild(el('div', 'label', 'Context (unchanged): ' + c.ref + ' [' + c.lines.join('–') + ']'))
    box.appendChild(prose(c.note))
    var pre = el('pre', 'context-code'), code = el('code', null, c.resolvedCode || '')
    var lang = langOf(c.ref); if (lang) code.setAttribute('data-lang', lang)
    pre.appendChild(code); box.appendChild(pre)
    return box
  }

  function sectionEl(s, id) {
    var sec = el('section', 'file'); sec.id = id
    var head = el('div', 'file-head')
    head.appendChild(el('span', 'caret', '▾'))
    head.appendChild(el('span', 'path', s.file + (s.unit ? ' — ' + s.unit : '')))
    if (s.kind !== 'normal') head.appendChild(el('span', 'badge', s.kind))
    if (s.kind === 'normal' && s.resolvedDiff) {
      var st = diffStats(s.resolvedDiff), counts = el('span', 'counts')
      counts.innerHTML = '<span class="add">+' + st.add + '</span> <span class="del">−' + st.del + '</span>'
      head.appendChild(counts)
    }
    head.addEventListener('click', function () { sec.classList.toggle('collapsed') })
    sec.appendChild(head)

    var body = el('div', 'file-body')
    body.appendChild(prose(s.narrative))
    ;(s.contexts || []).forEach(function (c) { body.appendChild(contextBlock(c)) })
    if (s.kind === 'normal' && s.resolvedDiff) {
      body.appendChild(buildDiff(s.resolvedDiff, langOf(s.file)))
    } else if (s.kind !== 'normal') {
      var txt = s.note || ''
      if (s.kind === 'generated' && s.derivedFrom) txt += '\n\n_generated from `' + s.derivedFrom + '`_'
      body.appendChild(prose(txt))
    }
    sec.appendChild(body)
    return sec
  }

  function sidebarFileLink(s, id) {
    var a = el('a', 'file-link'); a.href = '#' + id; a.setAttribute('data-target', id)
    a.appendChild(el('span', 'name', (s.unit ? s.unit + ' ' : '') + s.file))
    if (s.kind === 'normal' && s.resolvedDiff) {
      var st = diffStats(s.resolvedDiff), c = el('span', 'counts')
      c.innerHTML = '<span class="add">+' + st.add + '</span> <span class="del">−' + st.del + '</span>'
      a.appendChild(c)
    } else { a.appendChild(el('span', 'counts', s.kind)) }
    return a
  }

  function topbar() {
    var bar = el('div', 'topbar')
    bar.appendChild(el('h1', null, 'PR #' + data.pr.number + ': ' + data.pr.title))
    var meta = el('div', 'meta')
    // Built via DOM (not innerHTML) so PR-derived strings can't inject HTML/JS.
    var sep = function () { meta.appendChild(document.createTextNode(' · ')) }
    meta.appendChild(document.createTextNode(data.pr.repo + ' #' + data.pr.number))
    sep()
    meta.appendChild(document.createTextNode('@' + data.pr.author))
    sep()
    meta.appendChild(el('code', null, data.pr.headBranch + '→' + data.pr.baseBranch))
    sep()
    meta.appendChild(document.createTextNode(data.pr.filesCount + ' files, ' + data.pr.commitsCount + ' commits'))
    var url = String(data.pr.url || '')
    if (/^https?:\/\//i.test(url)) {            // only linkify safe schemes
      sep()
      var link = el('a', null, url)
      link.setAttribute('href', url)
      meta.appendChild(link)
    } else if (url) {
      sep()
      meta.appendChild(document.createTextNode(url))
    }
    bar.appendChild(meta)
    bar.appendChild(prose(data.summary))
    var controls = el('div', 'controls')
    var btn = el('button', null, 'Collapse all')
    var collapsed = false
    btn.addEventListener('click', function () {
      collapsed = !collapsed
      document.querySelectorAll('.file').forEach(function (f) { f.classList.toggle('collapsed', collapsed) })
      btn.textContent = collapsed ? 'Expand all' : 'Collapse all'
    })
    controls.appendChild(btn); bar.appendChild(controls)
    return bar
  }

  function tailSection(title, id, markdown) {
    var s = el('section', 'tail'); s.id = id
    s.appendChild(el('h2', null, title))
    s.appendChild(prose(markdown))
    return s
  }

  function commitTail() {
    var s = el('section', 'tail'); s.id = 'commit-map'
    s.appendChild(el('h2', null, 'Commit map'))
    var t = el('table', 'commits')
    var head = el('tr'); ['SHA', 'Message', 'Chapters'].forEach(function (h) { head.appendChild(el('th', null, h)) })
    t.appendChild(head)
    ;(data.commitMap || []).forEach(function (c) {
      var tr = el('tr')
      tr.appendChild(el('td', 'sha', c.sha))
      tr.appendChild(el('td', null, c.message))
      tr.appendChild(el('td', null, (c.chapters || []).join(', ')))
      t.appendChild(tr)
    })
    s.appendChild(t); return s
  }

  function highlightSection(sec) {
    if (!window.hljs || sec.getAttribute('data-hl')) return
    sec.setAttribute('data-hl', '1')
    sec.querySelectorAll('code[data-lang]').forEach(function (c) {
      var lang = c.getAttribute('data-lang')
      try {
        var res = lang && window.hljs.getLanguage(lang)
          ? window.hljs.highlight(c.textContent, { language: lang })
          : window.hljs.highlightAuto(c.textContent)
        c.innerHTML = res.value
      } catch (e) { /* leave as plain text */ }
    })
  }

  function render() {
    app.textContent = ''
    if (!data) { app.appendChild(el('div', 'empty-state', 'Could not parse walkthrough data.')); return }

    app.appendChild(topbar())

    var hasContent = (data.chapters || []).some(function (c) { return (c.sections || []).length })
    if (!hasContent) {
      app.appendChild(el('div', 'empty-state', 'This PR has no file changes to walk through.'))
      return
    }

    var layout = el('div', 'layout')
    var sidebar = el('nav', 'sidebar')
    var main = el('div', 'main')

    data.chapters.forEach(function (ch, ci) {
      var navChap = el('div', 'chap')
      var chTitle = el('a', 'chap-title'); chTitle.href = '#chap-' + ci; chTitle.textContent = ch.title
      navChap.appendChild(chTitle)

      var chapter = el('section', 'chapter'); chapter.id = 'chap-' + ci
      chapter.appendChild(el('h2', null, ch.title))
      chapter.appendChild(prose(ch.intro))

      ch.sections.forEach(function (s, si) {
        var id = 'sec-' + ci + '-' + si
        navChap.appendChild(sidebarFileLink(s, id))
        chapter.appendChild(sectionEl(s, id))
      })

      sidebar.appendChild(navChap)
      main.appendChild(chapter)
    })

    ;['Cross-cutting concerns:cross-cutting', 'Open questions:open-questions', 'Commit map:commit-map']
      .forEach(function (pair) {
        var label = pair.split(':')[0], id = pair.split(':')[1]
        var link = el('a', 'tail-link', label); link.href = '#' + id; sidebar.appendChild(link)
      })

    main.appendChild(tailSection('Cross-cutting concerns', 'cross-cutting', data.crossCutting))
    main.appendChild(tailSection('Open questions', 'open-questions', data.openQuestions))
    main.appendChild(commitTail())

    layout.appendChild(sidebar); layout.appendChild(main)
    app.appendChild(layout)

    // lazy syntax highlighting when a section scrolls near the viewport
    var hlObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { highlightSection(en.target); hlObs.unobserve(en.target) } })
    }, { rootMargin: '400px 0px' })
    main.querySelectorAll('.file').forEach(function (f) { hlObs.observe(f) })

    // active sidebar link tracking
    var links = sidebar.querySelectorAll('.file-link')
    var byId = {}; links.forEach(function (a) { byId[a.getAttribute('data-target')] = a })
    var actObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return
        links.forEach(function (a) { a.classList.remove('active') })
        var a = byId[en.target.id]; if (a) a.classList.add('active')
      })
    }, { rootMargin: '-10% 0px -80% 0px' })
    main.querySelectorAll('.file').forEach(function (f) { actObs.observe(f) })
  }

  render()
})()
```

- [ ] **Step 2: Sanity-check that the file is valid JS (parses without executing the DOM)**

Run: `node --check skills/pr-walkthrough/assets/viewer.js`
Expected: no output, exit 0 (syntax is valid). Full behavior is verified in the browser in Task 12.

- [ ] **Step 3: Commit**

```bash
git add skills/pr-walkthrough/assets/viewer.js
git commit -m "$(printf 'feat(pr-walkthrough): browser renderer for split diffs and markdown prose\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: End-to-end build test (real assets)

An integration test that builds against the **real committed assets** with a fake diff provider, asserting the shipped template inlines correctly and produces a well-formed self-contained document. Reuses the inline `validData()` from Task 1 — no separate fixture file (the agent prompt in Task 11 is the canonical documented example of the content model).

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

- [ ] **Step 1: Write the test**

Append to `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs` (reuses `validData()` from Task 1, `TWO_HUNK_DIFF` from Task 2, `fakeProvider` from Task 3, and `REAL_ASSETS` from Task 6 — all already in this file):

```js
test('end-to-end: builds a self-contained HTML document from the real assets', () => {
  const html = buildDocument(validData(), {
    assetsDir: REAL_ASSETS,
    provider: fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'export function helper() {}' }),
  })
  assert.ok(html.startsWith('<!DOCTYPE html>'))
  assert.ok(html.includes('Add auth'))                          // PR title from validData() present in embedded data
  assert.ok(!html.includes('id="chap-0"'))                      // chapter anchors are created client-side, not baked in
  assert.ok(/highlight\.min\.js/.test(html))                    // CDN hljs reference present
  assert.ok(/markdown-it.*\.min\.js/.test(html))                // CDN markdown-it reference present
  assert.ok(/integrity="sha384-/.test(html))                    // SRI survived inlining
  assert.ok(html.includes('"resolvedDiff"'))                    // normal section was resolved and embedded
})
```

Note: the `id="chap-0"` assertion documents that chapter/section anchors are generated by `viewer.js` at runtime, not baked into the served HTML — the test asserts they are absent from the static output, and Task 12 verifies they appear in the browser.

- [ ] **Step 2: Run the test to verify it passes**

This is an integration test over the units built in Tasks 1–8, so it validates wiring rather than driving new code (no prior "failing" state to show). Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — entire suite green. If it fails, the failing assertion names the broken invariant (missing title, stripped SRI, unresolved section, etc.).

- [ ] **Step 3: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "$(printf 'test(pr-walkthrough): end-to-end build against the real shipped assets\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: Update the controller (`SKILL.md`)

Switch the controller to produce `.json` (agent) → build → `.html`, add a `node` preflight, and update Red Flags.

**Files:**
- Modify: `skills/pr-walkthrough/SKILL.md`

- [ ] **Step 1: Replace the description front-matter line**

In `skills/pr-walkthrough/SKILL.md`, replace the `description:` value:

Find:
```
description: Use when you want a structured tour of a GitHub PR — generates a single document that walks through the final state of the changed code in a digestible order, with all diffs embedded inline. For exploration and understanding, not review (use comprehensive-review for review).
```
Replace with:
```
description: Use when you want a structured tour of a GitHub PR — generates a single self-contained HTML page that walks through the final state of the changed code in a digestible order, with GitHub-style side-by-side diffs. For exploration and understanding, not review (use comprehensive-review for review).
```

- [ ] **Step 2: Replace Step 3 (output path) with `.json` + `.html` paths**

Find the `### Step 3: Compute output path and slug` section's path block:
```bash
mkdir -p /tmp/pr-walkthroughs
OUTPUT_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.md"
```
Replace with:
```bash
mkdir -p /tmp/pr-walkthroughs
DATA_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.json"
OUTPUT_PATH="/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.html"
```

And in the same section, replace the trailing sentence:
```
If the file already exists, the dispatched agent in Step 4 will overwrite it. `/tmp` is ephemeral; re-runs reflect the current PR state.
```
with:
```
The agent writes `DATA_PATH`; the build step (Step 4b) produces `OUTPUT_PATH`. Both are overwritten on re-run. `/tmp` is ephemeral; re-runs reflect the current PR state.
```

- [ ] **Step 3: Add the node preflight at the end of Step 3**

Immediately after the path block from Step 2, add:
```bash
# Preflight: the build step needs Node.
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to build the HTML walkthrough. Install Node.js (>=20) and retry." >&2
  exit 1
fi
```

- [ ] **Step 4: Update Step 4 dispatch to point at DATA_PATH**

In `### Step 4: Dispatch the agent`, replace the placeholder list line that ends with `{OUTPUT_PATH}`:
```
  - `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_BODY}`, `{BASE_BRANCH}`, `{HEAD_BRANCH}`, `{AUTHOR}`, `{URL}`, `{OWNER_REPO}`, `{COMMITS_LIST}` (formatted as one `sha  headline` per line), `{FILES_LIST}` (formatted as one path per line), `{COMMITS_COUNT}`, `{FILES_COUNT}`, `{OUTPUT_PATH}`
```
with:
```
  - `{PR_NUMBER}`, `{PR_TITLE}`, `{PR_BODY}`, `{BASE_BRANCH}`, `{HEAD_BRANCH}`, `{AUTHOR}`, `{URL}`, `{OWNER_REPO}`, `{COMMITS_LIST}` (formatted as one `sha  headline` per line), `{FILES_LIST}` (formatted as one path per line), `{COMMITS_COUNT}`, `{FILES_COUNT}`, `{DATA_PATH}`
```

- [ ] **Step 5: Insert a new Step 4b (build) before Step 5**

Immediately before `### Step 5: Present result`, insert:
````markdown
### Step 4b: Build the HTML from the agent's JSON

The agent has written pointer JSON to `DATA_PATH`. Resolve it against git and render the self-contained HTML:

```bash
node /mnt/skills/user/pr-walkthrough/scripts/build-walkthrough.mjs \
  --data "$DATA_PATH" --out "$OUTPUT_PATH" \
  --base "$BASE_BRANCH" --head "$HEAD_BRANCH"
```

(When running from this repo rather than an installed skill, use `skills/pr-walkthrough/scripts/build-walkthrough.mjs`.)

- On success the script prints `OUTPUT_PATH`.
- On a **validation or resolution failure** the script exits non-zero and prints the errors. Re-dispatch the Step 4 agent **once**, appending the printed errors to the prompt with the instruction to fix them and rewrite `DATA_PATH`, then re-run this build. If it fails a second time, **stop** and report the errors to the user — do not hand-edit the JSON.
````

- [ ] **Step 6: Update Step 5 (present result)**

Replace the body of `### Step 5: Present result`:
```
Once the agent returns, report only this single line to the user:

> Walkthrough saved to `/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.md`

Do not include counts, previews, or orientation summaries. The document is the artifact; it speaks for itself.
```
with:
```
Once the build succeeds, open the result (macOS) and report a single line:

```bash
[ "$(uname)" = "Darwin" ] && open "$OUTPUT_PATH" || true
```

> Walkthrough saved to `/tmp/pr-walkthroughs/PR-${PR_NUMBER}-${SLUG}.html` — open it in a browser.

Do not include counts, previews, or orientation summaries. The document is the artifact; it speaks for itself.
```

- [ ] **Step 7: Update Red Flags**

In the `## Red Flags` → `**Never:**` list, add a new bullet after the "Strip diff headers…" bullet:
```
- Transcribe diffs or source code into the agent's JSON — the agent emits **pointers only** (`file` + `lines`); the build step resolves the real code from git
```

- [ ] **Step 8: Verify the controller reads cleanly**

Run: `sed -n '1,20p' skills/pr-walkthrough/SKILL.md` and confirm the new `description` is present, then `grep -n "Step 4b" skills/pr-walkthrough/SKILL.md` returns a line.
Expected: description updated; Step 4b present.

- [ ] **Step 9: Commit**

```bash
git add skills/pr-walkthrough/SKILL.md
git commit -m "$(printf 'feat(pr-walkthrough): controller builds HTML via JSON + build step\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 11: Rewrite the agent prompt (`walkthrough-prompt.md`)

The agent must emit pointer JSON (prose = markdown), read diffs but never copy them, and self-validate.

**Files:**
- Modify: `skills/pr-walkthrough/walkthrough-prompt.md`

- [ ] **Step 1: Replace the intro paragraph**

Replace the first paragraph (under `# PR Walkthrough Agent`):
```
You are generating a structured tour of PR #{PR_NUMBER}. The output is a single markdown document that walks a reader through the final state of the changed code in a digestible order, with all diffs embedded inline.
```
with:
```
You are generating a structured tour of PR #{PR_NUMBER}. Your output is a **pointer JSON document** written to `{DATA_PATH}`. You decide the narrative and where each change lives (file + line range); a separate deterministic build step resolves those pointers to git-exact diffs and renders the HTML. You never write HTML, never style anything, and never copy diff or source text into the JSON.
```

- [ ] **Step 2: Replace the "Output path" context line**

Find:
```
- **Output path:** `{OUTPUT_PATH}`
```
Replace with:
```
- **Data path (write your JSON here):** `{DATA_PATH}`
```

- [ ] **Step 3: Replace Section 6 (Output document format) entirely**

Replace the whole `## 6. Output document format` section (from its heading through the end of its `### Edge cases to handle` subsection) with:

````markdown
## 6. Output: the pointer JSON

Write a single JSON document to `{DATA_PATH}` with exactly this shape. **Prose field values are markdown** (bold/italic, inline code, bullet lists, sub-headings). Do **not** put raw HTML in prose. Do **not** put any diff or source code in the JSON — only pointers.

```jsonc
{
  "pr": {
    "number": {PR_NUMBER}, "repo": "{OWNER_REPO}", "title": "{PR_TITLE}",
    "author": "{AUTHOR}", "headBranch": "{HEAD_BRANCH}", "baseBranch": "{BASE_BRANCH}",
    "url": "{URL}", "filesCount": {FILES_COUNT}, "commitsCount": {COMMITS_COUNT}
  },
  "summary": "Markdown — 1–3 sentences orienting the reader (your own voice).",
  "chapters": [
    {
      "id": "kebab-slug",
      "title": "Concept name",
      "intro": "Markdown — 2–4 sentences: what this chapter covers and why it comes here.",
      "sections": [
        {
          "file": "path/to/file.ts",
          "unit": null,
          "lines": null,
          "kind": "normal",
          "narrative": "Markdown — what this code does and why it changed.",
          "contexts": [
            { "ref": "path/to/helper.ts", "lines": [42, 58], "note": "Markdown — why this unchanged code matters." }
          ]
        }
      ]
    }
  ],
  "crossCutting": "Markdown — observational notes across chapters (use a bullet list).",
  "openQuestions": "Markdown — genuine questions for the author (use a bullet list).",
  "commitMap": [
    { "sha": "abc1234", "message": "headline", "chapters": ["Concept name"] }
  ]
}
```

**Field rules:**

- `sections[].file` — a path that appears in the PR's changed files. For a `normal` section the build step runs `git diff {BASE_BRANCH}...{HEAD_BRANCH} -- <file>`; if it produces no diff, the build fails — so only point at files that actually changed.
- `sections[].unit` — `null`, or a short label when you split one file into multiple sub-sections (e.g. `"Component A"`).
- `sections[].lines` — `null` to show the whole file's diff, or `[start, end]` (line numbers in the **new** file) to show only the hunks overlapping that range. Use a range when a `unit` covers part of a file.
- `sections[].kind` — one of:
  - `normal` — the build step embeds the (optionally sliced) diff. No `note`.
  - `lockfile` — lockfiles (e.g. `package-lock.json`, `yarn.lock`, `Cargo.lock`). No diff; set `note` to the churn summary (e.g. `"12 deps added, 3 updated"`).
  - `generated` — a file mechanically derived from another in the PR. No diff; set `note` and `derivedFrom` (the human-authored source path).
  - `binary` — images/fonts/blobs. No diff; set `note` (include a `git diff --stat` line if useful).
- `sections[].contexts` — optional pointers to **unchanged** code worth quoting. Each needs `ref`, `lines` `[start,end]`, and a markdown `note`. The build step reads those lines from the base revision.
- `crossCutting` / `openQuestions` — single markdown strings (write them as bullet lists). Observational, not fix recommendations.

Every file in the files-changed list must appear as a section (full diff for `normal`; a `note` for `lockfile`/`generated`/`binary`). Organize chapters by **final state**, not commit order. Split a file into multiple sub-sections (same `file`, different `unit` + `lines`) only when distinct readers care about distinct parts.

### Edge cases

- **Empty PR** (zero files/commits) — write `{ "pr": {...}, "summary": "...", "chapters": [], "crossCutting": "", "openQuestions": "", "commitMap": [] }` and stop. The viewer renders an empty state.
- **Deleted / renamed files** — point a `normal` section at the path; the resolved diff encodes the deletion/rename.
- **Huge PRs** — no special handling; pointers keep your output small regardless of diff size.
````

- [ ] **Step 4: Replace Section 7 (Save and stop) with self-validation**

Replace the whole `## 7. Save and stop` section with:
````markdown
## 7. Save, self-validate, and stop

Write the JSON to `{DATA_PATH}` with the `Write` tool (overwrite if it exists). Then validate it — both shape and that every pointer resolves against git:

```bash
node /mnt/skills/user/pr-walkthrough/scripts/build-walkthrough.mjs \
  --validate "{DATA_PATH}" --base "{BASE_BRANCH}" --head "{HEAD_BRANCH}"
```

(From this repo instead of an installed skill, use `skills/pr-walkthrough/scripts/build-walkthrough.mjs`.)

- Output `ok` → you are done; return a one-line confirmation.
- Any errors → fix the JSON (a missing field, a wrong `kind`, a `file` with no diff, a `lines` range that overlaps no hunks, a bad context `ref`/`lines`) and re-run until it prints `ok`.

You read `git diff`/`gh pr diff` only to **understand** the code well enough to write narratives — never copy that output into the JSON.
````

- [ ] **Step 5: Update the read-only contract and final reminders**

In `## 8. Read-only contract`, replace:
```
- You **must not write any other file** — no scratch files, no debug logs, no intermediate artifacts, nowhere on disk except `{OUTPUT_PATH}`.
```
with:
```
- You **must not write any other file** — nowhere on disk except `{DATA_PATH}`.
```

Replace the `## Final reminders` list with:
```
## Final reminders

- Output is **pointer JSON** at `{DATA_PATH}` — no HTML, no styling, no copied diffs.
- Every changed file appears as a section; `normal` gets a diff via its pointer, lockfile/generated/binary get a `note`.
- Prose values are markdown; no raw HTML.
- Chapters organized by *final state*, not commit order.
- Pure exploration. No fix recommendations.
- Self-validate with `--validate` until it prints `ok`, then stop.
```

- [ ] **Step 6: Verify no stale `{OUTPUT_PATH}` or markdown-template references remain**

Run: `grep -n "OUTPUT_PATH\|fenced\|```diff" skills/pr-walkthrough/walkthrough-prompt.md`
Expected: no matches (all references now use `{DATA_PATH}` and the JSON shape). If any remain in prose that still makes sense, leave it; otherwise update to `{DATA_PATH}`.

- [ ] **Step 7: Commit**

```bash
git add skills/pr-walkthrough/walkthrough-prompt.md
git commit -m "$(printf 'feat(pr-walkthrough): agent emits pointer JSON with markdown prose\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 12: End-to-end manual verification

Confirm the whole pipeline works against a real PR and renders correctly in a browser.

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite once more**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 2: Build a walkthrough for a real PR in this repo**

Pick any merged or open PR number `N` with a few changed files (e.g. one of the repo's own PRs), then run the controller's resolve + build manually:

```bash
PR=N
J=$(gh pr view "$PR" --json baseRefName,headRefName)
BASE=$(echo "$J" | jq -r .baseRefName); HEAD=$(echo "$J" | jq -r .headRefName)
git fetch origin "$BASE" "$HEAD" >/dev/null 2>&1 || true
```

Then hand-write a minimal `/tmp/pr-walkthroughs/manual.json` for one changed file (or run the actual skill end-to-end via the agent), and build:

```bash
node skills/pr-walkthrough/scripts/build-walkthrough.mjs \
  --data /tmp/pr-walkthroughs/manual.json --out /tmp/pr-walkthroughs/manual.html \
  --base "$BASE" --head "$HEAD"
```
Expected: prints `/tmp/pr-walkthroughs/manual.html`.

- [ ] **Step 3: Open in a browser and verify**

Run: `open /tmp/pr-walkthroughs/manual.html` (macOS).
Confirm visually:
- Layout A renders: sticky sidebar with chapters/files (+/− counts), one scrolling main column.
- Diffs show **side-by-side** (old left / new right) with line numbers and add/remove coloring.
- Prose shows **markdown** formatting (bold, inline code, bullets, sub-headings).
- Syntax highlighting is applied to code (online). 
- Collapse caret on a file header hides/shows its body; "Collapse all" toggles every file.
- Clicking a sidebar file scrolls to it; the active link tracks as you scroll.

- [ ] **Step 4: Verify graceful degradation (offline)**

Temporarily disable network (or use a browser devtools "offline" toggle) and reload the file.
Confirm: diffs still render with add/remove coloring (no token colors), and prose shows as legible raw markdown — the page is not broken.

- [ ] **Step 5: Verify the XSS guard**

Run: `node --check` is not enough here — instead add a temporary prose field containing `<img src=x onerror=alert(1)>` to `manual.json`, rebuild, open, and confirm the tag is shown as escaped text and does **not** execute. Remove the temporary field afterward.
Expected: no alert; the literal text appears.

- [ ] **Step 6: Final commit (docs/readme touch-up if needed)**

If `skills/pr-walkthrough/SKILL.md` references markdown output anywhere else (e.g. the top summary paragraph), update it to say HTML. Then:

```bash
git add -A skills/pr-walkthrough
git commit -m "$(printf 'docs(pr-walkthrough): finalize HTML viewer wording\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" || echo "nothing to commit"
```

---

## Notes for the implementer

- **No new dependencies.** Everything runs on Node stdlib + two pinned CDN libraries loaded by the browser. Do not add `node_modules` to the skill.
- **The agent never authors appearance.** If you find yourself adding HTML/CSS knowledge to `walkthrough-prompt.md`, stop — that belongs in `assets/`.
- **Diffs are git-exact.** Never reconstruct diff text in JS or in the prompt; always resolve via `git` in the build step.
- **Keep the build script pure-function-first** so each piece stays unit-testable without git or a browser.
