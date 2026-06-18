# pr-walkthrough Viewer UX Implementation Plan (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the offline pr-walkthrough HTML viewer: cleaner sidebar with test nesting, per-hunk collapse with a per-path read→viewed roll-up, sticky headers, and a GitHub-style Markdown comment composer with suggestions — plus a new `viewedFiles` field in the exported review.

**Architecture:** Pure computation (test↔source pairing, per-path hunk index + coverage, viewed roll-up) lives in `build-walkthrough.mjs` and is unit-tested with `node:test`. The browser assets (`viewer.js`, `comments.js`, `styles.css`) stay plain dependency-free IIFEs and are verified with `node --check` plus a scripted manual browser check. Viewed state is shared between the two scripts only through `localStorage` + the build-provided `data.pathHunks` — no runtime coupling.

**Tech Stack:** Node ≥20 (stdlib only, `node:test`), vanilla browser JS (ES5-style IIFE, no transpile), CSS. Inlined into a single HTML file by the build step. CDN `markdown-it` / `highlight.js` are optional progressive enhancements.

## Global Constraints

- **No new dependencies** anywhere — Node scripts and browser assets are stdlib/vanilla only.
- **Browser assets must pass `node --check`** (CI runs it) and stay plain `var`/function IIFEs matching the existing style (no `import`, no arrow-only ES, no optional chaining in assets — match what's already there).
- **Assets are inlined** by `renderHtml`; never reference external asset files at runtime. CDN tags keep their `integrity="sha384-…"` SRI.
- **Hunk id format is exactly** `` `${path}@${newStart}` `` (new-side start line). The build and both browser scripts must agree on this string.
- **localStorage keys** namespace under `pr-walkthrough:<repo>#<pr>`: comments stay at that base key; read-state uses the suffix `:read`.
- **Export shape:** add `viewedFiles: string[]` to the exported review; everything else (`repo`, `pr`, `commit`, `body`, `comments`, `fileComments`) is unchanged.
- Run `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs` after every build-side task; it must stay green.

---

## File Structure

- `skills/pr-walkthrough/scripts/build-walkthrough.mjs` — add `sourceForTest`, `pairTestsWithSources`, `computePathHunks`, `viewedFilesFrom`, `annotate`; call `annotate` in `buildDocument`.
- `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs` — tests for the four pure functions + the `annotate` wiring.
- `skills/pr-walkthrough/assets/viewer.js` — per-hunk `<tbody>` rendering + collapse, read-state store, sidebar redesign + test nesting + read/viewed state, file-head Viewed checkbox.
- `skills/pr-walkthrough/assets/comments.js` — composer (toolbar + Write/Preview + Suggest), `viewedFiles` in `exportReview`, sidebar comment-count badges.
- `skills/pr-walkthrough/assets/styles.css` — sidebar rows, hunk carets/read ticks, Viewed checkbox, composer toolbar/tabs, sticky offsets.
- `skills/pr-walkthrough/assets/template.html` — unchanged (slots already present).

---

## Task 1: Build — test↔source pairing

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (add after `splitPrDiff`, ~line 151)
- Test: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

**Interfaces:**
- Produces: `sourceForTest(path: string): string | null` and `pairTestsWithSources(paths: string[]): { [testPath: string]: sourcePath }`.

- [ ] **Step 1: Write the failing tests** — append to `build-walkthrough.test.mjs`:

```js
import { sourceForTest, pairTestsWithSources } from './build-walkthrough.mjs'

test('sourceForTest maps common test conventions to their source', () => {
  assert.equal(sourceForTest('src/auth/tokens.test.ts'), 'src/auth/tokens.ts')
  assert.equal(sourceForTest('src/auth/tokens.spec.tsx'), 'src/auth/tokens.tsx')
  assert.equal(sourceForTest('pkg/api/test_client.py'), 'pkg/api/client.py')
  assert.equal(sourceForTest('pkg/api/server_test.go'), 'pkg/api/server.go')
  assert.equal(sourceForTest('src/__tests__/user.ts'), 'src/user.ts')
  assert.equal(sourceForTest('src/__tests__/user.test.ts'), 'src/user.ts')
  assert.equal(sourceForTest('src/auth/tokens.ts'), null)   // not a test file
})

test('pairTestsWithSources pairs only when the source is also changed', () => {
  const pairs = pairTestsWithSources(['src/a.ts', 'src/a.test.ts', 'src/b.test.ts'])
  assert.equal(pairs['src/a.test.ts'], 'src/a.ts')          // a.ts present → paired
  assert.equal(pairs['src/b.test.ts'], undefined)           // b.ts absent → not paired
  assert.equal(pairs['src/a.ts'], undefined)                // sources are not keys
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `sourceForTest is not a function` (or import error).

- [ ] **Step 3: Implement** — add to `build-walkthrough.mjs` after `splitPrDiff` (line 151):

```js
// ---------- test grouping (sidebar nesting) ----------
// Given a path, return the source path it tests, or null if it isn't a test file.
export function sourceForTest(p) {
  // strip an enclosing __tests__/ dir: src/__tests__/user.ts -> src/user.ts
  const q = p.replace(/(^|\/)__tests__\//, '$1')
  const slash = q.lastIndexOf('/')
  const dir = slash < 0 ? '' : q.slice(0, slash + 1)
  const base = slash < 0 ? q : q.slice(slash + 1)
  let m = /^(.+)\.(test|spec)\.([^.]+)$/.exec(base)   // user.test.ts -> user.ts
  if (m) return dir + m[1] + '.' + m[3]
  m = /^test_(.+\.py)$/.exec(base)                    // test_client.py -> client.py
  if (m) return dir + m[1]
  m = /^(.+)_test\.go$/.exec(base)                    // server_test.go -> server.go
  if (m) return dir + m[1] + '.go'
  if (q !== p) return dir + base                      // __tests__/user.ts -> user.ts
  return null
}

// Map each changed test file to the source it tests, when that source is also changed.
export function pairTestsWithSources(paths) {
  const set = new Set(paths)
  const pairs = {}
  for (const p of paths) {
    const src = sourceForTest(p)
    if (src && set.has(src)) pairs[p] = src
  }
  return pairs
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "feat(pr-walkthrough): pair test files with their source for sidebar nesting"
```

---

## Task 2: Build — per-path hunk index + coverage

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (add after Task 1 code)
- Test: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

**Interfaces:**
- Consumes: `parseHunkHeader` (existing), a provider with `fileDiff(path)` (existing).
- Produces: `computePathHunks(data, provider): { [path]: { hunkIds: string[], fullyCovered: boolean } }`. Hunk id = `` `${path}@${newStart}` ``.

- [ ] **Step 1: Write the failing tests** — append to the test file:

```js
import { computePathHunks } from './build-walkthrough.mjs'

test('computePathHunks: a full-file section covers the whole diff', () => {
  const d = docWithSection({ lines: null, contexts: [] })   // shows the whole TWO_HUNK_DIFF
  resolveSections(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  const ph = computePathHunks(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  assert.deepEqual(ph['src/user.ts'].hunkIds, ['src/user.ts@10', 'src/user.ts@130'])
  assert.equal(ph['src/user.ts'].fullyCovered, true)
})

test('computePathHunks: a sliced section is partial coverage', () => {
  const d = docWithSection({ lines: [10, 13], contexts: [] })   // shows only the first hunk
  resolveSections(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  const ph = computePathHunks(d, fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}))
  assert.deepEqual(ph['src/user.ts'].hunkIds, ['src/user.ts@10'])
  assert.equal(ph['src/user.ts'].fullyCovered, false)
})
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `computePathHunks is not a function`.

- [ ] **Step 3: Implement** — add to `build-walkthrough.mjs` after the Task 1 functions:

```js
// ---------- per-path hunk index + coverage (read→viewed roll-up) ----------
function hunkStarts(diffText) {
  const out = []
  for (const line of (diffText || '').split('\n')) {
    const h = parseHunkHeader(line)
    if (h) out.push(h.newStart)
  }
  return out
}

// Per path: the hunk ids the walkthrough actually shows (unioned across all its
// sections) and whether those cover the file's complete diff. Requires sections
// to have been resolved first (reads s.resolvedDiff).
export function computePathHunks(data, provider) {
  const shown = {}                                  // path -> Set<newStart>
  for (const ch of data.chapters) {
    for (const s of ch.sections) {
      if (s.kind !== 'normal' || !s.resolvedDiff) continue
      const set = shown[s.file] || (shown[s.file] = new Set())
      for (const ns of hunkStarts(s.resolvedDiff)) set.add(ns)
    }
  }
  const out = {}
  for (const file of Object.keys(shown)) {
    const full = hunkStarts(provider.fileDiff(file))
    const has = shown[file]
    out[file] = {
      hunkIds: [...has].sort((a, b) => a - b).map((ns) => file + '@' + ns),
      fullyCovered: full.length > 0 && full.every((ns) => has.has(ns)),
    }
  }
  return out
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "feat(pr-walkthrough): compute per-path hunk ids and full-coverage flags"
```

---

## Task 3: Build — viewed roll-up + annotate wiring

**Files:**
- Modify: `skills/pr-walkthrough/scripts/build-walkthrough.mjs` (add `viewedFilesFrom`, `annotate`; call `annotate` in `buildDocument` ~line 244)
- Test: `skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`

**Interfaces:**
- Produces: `viewedFilesFrom(pathHunks, readIds: string[]): string[]`; `annotate(data, provider)` sets `data.testPairs` and `data.pathHunks`.
- Consumed by: `comments.js` replicates the `viewedFilesFrom` filter inline at export time (see Task 7); `viewer.js`/`comments.js` read `data.testPairs` and `data.pathHunks`.

- [ ] **Step 1: Write the failing tests** — append:

```js
import { viewedFilesFrom, annotate } from './build-walkthrough.mjs'

test('viewedFilesFrom returns only fully-covered, fully-read paths', () => {
  const ph = {
    'a.ts': { hunkIds: ['a.ts@1', 'a.ts@9'], fullyCovered: true },
    'b.ts': { hunkIds: ['b.ts@1'], fullyCovered: false },   // partial: never viewed
  }
  assert.deepEqual(viewedFilesFrom(ph, ['a.ts@1', 'a.ts@9']), ['a.ts'])         // all read
  assert.deepEqual(viewedFilesFrom(ph, ['a.ts@1']), [])                          // one hunk unread
  assert.deepEqual(viewedFilesFrom(ph, ['b.ts@1']), [])                          // partial coverage
})

test('annotate attaches testPairs and pathHunks to the document', () => {
  const d = validData()
  d.chapters[0].sections.push({ file: 'src/user.test.ts', unit: null, lines: null, kind: 'normal', narrative: 'tests' })
  const provider = fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF, 'src/user.test.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'x' })
  resolveSections(d, provider)
  annotate(d, provider)
  assert.equal(d.testPairs['src/user.test.ts'], 'src/user.ts')
  assert.ok(d.pathHunks['src/user.ts'])
  assert.equal(d.pathHunks['src/user.ts'].fullyCovered, true)
})
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: FAIL — `viewedFilesFrom is not a function`.

- [ ] **Step 3: Implement** — add the functions after `computePathHunks`:

```js
// Paths whose every shown hunk is read AND whose full diff is covered.
// NOTE: comments.js replicates this filter inline at export time — keep them in sync.
export function viewedFilesFrom(pathHunks, readIds) {
  const read = new Set(readIds)
  return Object.keys(pathHunks).filter((p) => {
    const ph = pathHunks[p]
    return ph.fullyCovered && ph.hunkIds.length > 0 && ph.hunkIds.every((id) => read.has(id))
  })
}

// Attach page annotations consumed by the viewer/comments scripts. Run after
// resolveSections so resolvedDiff is available to computePathHunks.
export function annotate(data, provider) {
  const paths = []
  for (const ch of data.chapters) for (const s of ch.sections) paths.push(s.file)
  data.testPairs = pairTestsWithSources([...new Set(paths)])
  data.pathHunks = computePathHunks(data, provider)
  return data
}
```

Then wire it into `buildDocument` — after the coverage check, before `renderHtml`. Replace:

```js
  resolveSections(data, provider)
  const cov = coverageErrors(data, provider)
  if (cov.length) {
    const e = new Error('Coverage failed:\n' + cov.join('\n'))
    e.coverage = cov
    throw e
  }
  return renderHtml(data, { assetsDir })
```

with:

```js
  resolveSections(data, provider)
  const cov = coverageErrors(data, provider)
  if (cov.length) {
    const e = new Error('Coverage failed:\n' + cov.join('\n'))
    e.coverage = cov
    throw e
  }
  annotate(data, provider)
  return renderHtml(data, { assetsDir })
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add a guard test that the e2e document embeds the annotations** — append:

```js
test('buildDocument embeds testPairs and pathHunks in the page data', () => {
  const html = buildDocument(validData(), {
    assetsDir: REAL_ASSETS,
    provider: fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'x' }),
  })
  assert.ok(html.includes('"pathHunks"'))
  assert.ok(html.includes('"testPairs"'))
})
```

Run: `node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs` → PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/pr-walkthrough/scripts/build-walkthrough.mjs skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
git commit -m "feat(pr-walkthrough): annotate page data with testPairs and pathHunks"
```

---

## Task 4: Viewer — per-hunk collapse + read store

**Files:**
- Modify: `skills/pr-walkthrough/assets/viewer.js` (`buildDiff` ~lines 74-140; add a store + delegated handler near the top)
- Modify: `skills/pr-walkthrough/assets/styles.css` (hunk caret/read + collapse + sticky)

**Interfaces:**
- Produces (browser globals/localStorage): read set persisted at `pr-walkthrough:<repo>#<pr>:read`; each hunk rendered as `<tbody class="hunk" data-hunk-id="path@newStart">`; `window.__wtv.refreshViewed()` recomputes sidebar/file state (defined in Task 5, called here after toggles via a no-op-safe guard).

> Browser-JS tasks are verified with `node --check` (syntax/CI parity) plus a scripted manual browser check. There is no DOM unit harness in this repo (matches existing convention).

- [ ] **Step 1: Add the read-state store** — near the top of the IIFE in `viewer.js`, right after `var app = document.getElementById('app')` (line 12), add:

```js
  var STORE_KEY = data && data.pr ? 'pr-walkthrough:' + data.pr.repo + '#' + data.pr.number + ':read' : null
  function loadRead() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]') } catch (e) { return [] } }
  var readSet = {}                                  // hunk id -> true
  loadRead().forEach(function (id) { readSet[id] = true })
  function saveRead() { try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.keys(readSet))) } catch (e) {} }
  function setHunkRead(id, on) {
    if (on) readSet[id] = true; else delete readSet[id]
    saveRead()
    if (window.__wtv && window.__wtv.refreshViewed) window.__wtv.refreshViewed()
  }
```

- [ ] **Step 2: Rewrite `buildDiff` to emit one `<tbody>` per hunk** — replace the whole `buildDiff` function (lines 74-140) with:

```js
  function buildDiff(diffText, lang, path) {
    var wrap = el('div', 'diff-wrap')
    var lines = diffText.split('\n')

    var META = /^(similarity index|dissimilarity index|rename from|rename to|copy from|copy to|new file mode|deleted file mode) /
    var i = 0, metaLines = []
    while (i < lines.length && lines[i].slice(0, 2) !== '@@') {
      if (META.test(lines[i])) metaLines.push(lines[i])
      i++
    }
    if (metaLines.length) {
      var mbox = el('div', 'diff-meta')
      metaLines.forEach(function (m) { mbox.appendChild(el('div', null, m)) })
      wrap.appendChild(mbox)
    }

    var table = el('table', 'diff')
    var cg = document.createElement('colgroup')
    ;['c-gutter', 'c-code', 'c-gutter', 'c-code'].forEach(function (c) {
      var col = document.createElement('col'); col.className = c; cg.appendChild(col)
    })
    table.appendChild(cg)

    var rendered = false
    while (i < lines.length) {
      var hh = parseHunkHeader(lines[i])
      if (!hh) { i++; continue }
      rendered = true
      var hunkId = path + '@' + hh.newStart
      var tb = el('tbody', 'hunk'); tb.setAttribute('data-hunk-id', hunkId)
      if (readSet[hunkId]) tb.classList.add('collapsed')

      var sep = el('tr', 'hunksep')
      var sepTd = el('td', null); sepTd.colSpan = 4
      sepTd.appendChild(el('span', 'hcaret', '▾'))
      sepTd.appendChild(el('span', 'htext', lines[i]))
      sepTd.appendChild(el('span', 'hread', '✓ read'))
      sep.appendChild(sepTd); tb.appendChild(sep)

      var oldNo = hh.oldStart, newNo = hh.newStart
      i++
      var dels = [], adds = []
      function flush() {
        var n = Math.max(dels.length, adds.length)
        for (var k = 0; k < n; k++) {
          var d = dels[k], a = adds[k]
          var left = d ? codeCell('left', d.no, d.text, 'del', lang) : codeCell('left', '', '', 'empty', lang)
          var right = a ? codeCell('right', a.no, a.text, 'add', lang) : codeCell('right', '', '', 'empty', lang)
          var tr = el('tr')
          tr.appendChild(left[0]); tr.appendChild(left[1]); tr.appendChild(right[0]); tr.appendChild(right[1])
          tb.appendChild(tr)
        }
        dels = []; adds = []
      }
      for (; i < lines.length && lines[i].slice(0, 2) !== '@@'; i++) {
        var ln = lines[i]
        if (ln === '') continue
        if (ln.charAt(0) === '\\') continue
        var tag = ln.charAt(0), text = ln.slice(1)
        if (tag === '-') dels.push({ no: oldNo++, text: text })
        else if (tag === '+') adds.push({ no: newNo++, text: text })
        else {
          flush()
          var l = codeCell('left', oldNo, text, 'ctx', lang), r = codeCell('right', newNo, text, 'ctx', lang)
          var trc = el('tr'); trc.appendChild(l[0]); trc.appendChild(l[1]); trc.appendChild(r[0]); trc.appendChild(r[1])
          tb.appendChild(trc)
          oldNo++; newNo++
        }
      }
      flush()
      table.appendChild(tb)
    }

    if (rendered) wrap.appendChild(table)
    else if (!metaLines.length) wrap.appendChild(el('div', 'diff-meta', '(no textual changes)'))
    return wrap
  }
```

(The old standalone `appendRow` helper at lines 68-72 is now unused — delete it.)

- [ ] **Step 3: Pass `path` into `buildDiff`** — in `sectionEl` (line 171), change:

```js
      body.appendChild(buildDiff(s.resolvedDiff, langOf(s.file)))
```
to:
```js
      body.appendChild(buildDiff(s.resolvedDiff, langOf(s.file), s.file))
```

- [ ] **Step 4: Add a delegated click handler for hunk collapse** — at the end of `render()`, just before its closing `}` (after the active-link observer, ~line 329), add:

```js
    // per-hunk collapse: clicking a hunk separator toggles that hunk and its read state
    main.addEventListener('click', function (e) {
      var sep = e.target.closest ? e.target.closest('tr.hunksep') : null
      if (!sep) return
      var tb = sep.parentNode
      if (!tb || !tb.classList.contains('hunk')) return
      var collapsed = tb.classList.toggle('collapsed')
      setHunkRead(tb.getAttribute('data-hunk-id'), collapsed)
    })
```

- [ ] **Step 5: Add hunk styles** — append to `styles.css`:

```css
/* ---- per-hunk collapse + read ---- */
table.diff tr.hunksep td { display: flex; align-items: center; gap: 8px; cursor: pointer; }
table.diff tr.hunksep .hcaret { color: var(--muted); transition: transform .12s; }
tbody.hunk.collapsed tr.hunksep .hcaret { transform: rotate(-90deg); }
table.diff tr.hunksep .htext { font-family: ui-monospace, monospace; }
table.diff tr.hunksep .hread { margin-left: auto; color: var(--add-num); font-size: 11px; visibility: hidden; }
tbody.hunk.collapsed tr.hunksep .hread { visibility: visible; }
tbody.hunk.collapsed tr:not(.hunksep) { display: none; }
/* hunk header sticks just below the file header while scrolling a long block */
table.diff tr.hunksep { position: sticky; top: 40px; z-index: 1; }
```

- [ ] **Step 6: Syntax check**

Run: `node --check skills/pr-walkthrough/assets/viewer.js`
Expected: no output (exit 0).

- [ ] **Step 7: Manual browser check (human checkpoint)**

Build a walkthrough for any PR with a multi-hunk file (see Task 8 for the build command), open the HTML, and confirm:
- Each hunk has a caret in its `@@` header; clicking it collapses just that hunk and shows "✓ read".
- Reloading the page preserves collapsed/read hunks (localStorage).
- The hunk header stays visible (sticky) while scrolling a long hunk.

- [ ] **Step 8: Commit**

```bash
git add skills/pr-walkthrough/assets/viewer.js skills/pr-walkthrough/assets/styles.css
git commit -m "feat(pr-walkthrough): per-hunk collapse with persisted read state"
```

---

## Task 5: Viewer — sidebar redesign, test nesting, read/viewed roll-up

**Files:**
- Modify: `skills/pr-walkthrough/assets/viewer.js` (`sidebarFileLink` ~181-190, `sectionEl` head ~152-165, the chapter render loop ~281-298, add `__wtv` roll-up)
- Modify: `skills/pr-walkthrough/assets/styles.css` (sidebar rows, checkbox, Viewed badge)

**Interfaces:**
- Consumes: `data.testPairs`, `data.pathHunks`, `readSet`, `setHunkRead` (Task 4).
- Produces: `window.__wtv = { refreshViewed }`; sidebar rows carry `data-path`; file headers carry a `.vbox` Viewed control.

- [ ] **Step 1: Rewrite `sidebarFileLink` to two-line rows with a state checkbox** — replace lines 181-190:

```js
  function sidebarFileLink(s, id) {
    var a = el('a', 'file-link'); a.href = '#' + id; a.setAttribute('data-target', id)
    a.setAttribute('data-path', s.file)
    a.appendChild(el('span', 'ck'))                       // read/viewed checkbox, state set by refreshViewed
    var nm = el('span', 'nm')
    var slash = s.file.lastIndexOf('/')
    nm.appendChild(el('b', null, (s.unit ? s.unit + ' · ' : '') + (slash < 0 ? s.file : s.file.slice(slash + 1))))
    if (slash >= 0) nm.appendChild(el('span', 'dir', s.file.slice(0, slash + 1)))
    a.appendChild(nm)
    a.appendChild(el('span', 'badge'))                    // comment count, filled by comments.js
    if (s.kind === 'normal' && s.resolvedDiff) {
      var st = diffStats(s.resolvedDiff), c = el('span', 'counts')
      c.innerHTML = '<span class="add">+' + st.add + '</span> <span class="del">−' + st.del + '</span>'
      a.appendChild(c)
    } else { a.appendChild(el('span', 'counts', s.kind)) }
    return a
  }
```

- [ ] **Step 2: Nest test rows under their source within a chapter** — in the chapter loop, replace the `ch.sections.forEach(...)` block (lines 290-294) with:

```js
      var linkByPath = {}
      ch.sections.forEach(function (s, si) {
        var id = 'sec-' + ci + '-' + si
        var link = sidebarFileLink(s, id)
        var src = (data.testPairs || {})[s.file]
        var parentLink = src ? linkByPath[src] : null
        if (parentLink) { link.classList.add('nested'); parentLink.after(link) }
        else { navChap.appendChild(link) }
        linkByPath[s.file] = link
        chapter.appendChild(sectionEl(s, id))
      })
```

(`Element.prototype.after` is supported in every browser that runs this page.)

- [ ] **Step 3: Add a Viewed control to each file header** — in `sectionEl`, after the counts block (after line 163, before `head.addEventListener`), add:

```js
    if (s.kind === 'normal') {
      var vbox = el('span', 'vbox')
      vbox.appendChild(el('span', 'ck'))
      vbox.appendChild(document.createTextNode('Viewed'))
      vbox.setAttribute('data-path', s.file)
      vbox.addEventListener('click', function (e) {
        e.stopPropagation()                                 // don't toggle section collapse
        var on = !sec.classList.contains('all-read')        // computed class set by refreshViewed
        setPathRead(s.file, on)
      })
      head.appendChild(vbox)
    }
```

- [ ] **Step 4: Add the roll-up + `setPathRead`** — add these helpers inside the IIFE (e.g. just after `setHunkRead` from Task 4):

```js
  function pathState(path) {
    var ph = (data.pathHunks || {})[path]
    if (!ph || !ph.hunkIds.length) return 'none'
    var readCount = 0
    ph.hunkIds.forEach(function (id) { if (readSet[id]) readCount++ })
    if (readCount === 0) return 'none'
    if (readCount === ph.hunkIds.length) return ph.fullyCovered ? 'viewed' : 'read'
    return 'read'
  }
  function setPathRead(path, on) {
    var ph = (data.pathHunks || {})[path]; if (!ph) return
    ph.hunkIds.forEach(function (id) { if (on) readSet[id] = true; else delete readSet[id] })
    saveRead()
    // reflect collapse on every tbody for this path
    document.querySelectorAll('tbody.hunk').forEach(function (tb) {
      if (tb.getAttribute('data-hunk-id').indexOf(path + '@') === 0) tb.classList.toggle('collapsed', on)
    })
    refreshViewed()
  }
  function refreshViewed() {
    var paths = Object.keys(data.pathHunks || {})
    paths.forEach(function (path) {
      var state = pathState(path)
      var partial = (data.pathHunks[path] || {}).fullyCovered === false
      document.querySelectorAll('[data-path="' + cssEscV(path) + '"]').forEach(function (node) {
        node.classList.remove('st-read', 'st-viewed')
        if (state === 'viewed') node.classList.add('st-viewed')
        else if (state === 'read') node.classList.add('st-read')
        var vbox = node.classList.contains('vbox') ? node : null
        if (vbox) vbox.title = partial ? 'Partial coverage — won’t mark Viewed on GitHub' : ''
      })
      document.querySelectorAll('section.file[data-path="' + cssEscV(path) + '"]').forEach(function (sec) {
        sec.classList.toggle('all-read', state === 'viewed')
      })
    })
  }
  function cssEscV(s) { return String(s).replace(/["\\]/g, '\\$&') }
  window.__wtv = { refreshViewed: refreshViewed }
```

- [ ] **Step 5: Call `refreshViewed()` once after render** — at the very end of `render()` (after the hunk-collapse handler from Task 4), add:

```js
    refreshViewed()
```

- [ ] **Step 6: Replace the sidebar CSS** — replace the existing sidebar block in `styles.css` (lines 32-40) with:

```css
.sidebar .chap { margin-bottom: 14px; }
.sidebar .chap > .chap-title { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px; }
.sidebar .file-link { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-left: 2px solid transparent; border-radius: 0 6px 6px 0; color: var(--fg); }
.sidebar .file-link:hover { background: var(--panel); }
.sidebar .file-link.active { background: var(--panel); border-left-color: var(--link); }
.sidebar .file-link.nested { padding-left: 24px; }
.sidebar .file-link .nm { flex: 1 1 auto; min-width: 0; }
.sidebar .file-link .nm b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar .file-link .nm .dir { display: block; font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left; }
.sidebar .file-link.st-viewed .nm b, .sidebar .file-link.st-viewed .nm .dir { color: var(--muted); }
.sidebar .file-link .badge:empty { display: none; }
.sidebar .file-link .badge { font-size: 11px; color: var(--muted); background: var(--panel); border-radius: 9px; padding: 0 6px; align-self: center; }
.sidebar .counts { color: var(--muted); white-space: nowrap; font-size: 11px; align-self: flex-start; }
.sidebar .counts .add { color: var(--add-num); }
.sidebar .counts .del { color: var(--del-num); }
.sidebar .tail-link { display: block; padding: 4px 8px; margin-top: 4px; }
/* read/viewed checkbox (sidebar .ck and file-head .vbox .ck) */
.ck { width: 14px; height: 14px; flex: 0 0 auto; border: 1.5px solid var(--border); border-radius: 3px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; align-self: center; }
.st-read > .ck, .st-read .ck { border-color: #9e6a03; color: #d29922; }
.st-read > .ck::after, .st-read .ck::after { content: "✓"; }
.st-viewed > .ck, .st-viewed .ck { background: var(--add-num); border-color: var(--add-num); color: #fff; }
.st-viewed > .ck::after, .st-viewed .ck::after { content: "✓"; }
.file > .file-head .vbox { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.file > .file-head .vbox.st-viewed { color: var(--add-num); border-color: var(--add-num); }
```

- [ ] **Step 7: Syntax check**

Run: `node --check skills/pr-walkthrough/assets/viewer.js`
Expected: exit 0.

- [ ] **Step 8: Manual browser check (human checkpoint)**

Rebuild and open. Confirm:
- Sidebar rows show basename + dimmed path; long paths truncate; active row highlights on scroll.
- A changed `foo.ts` + `foo.test.ts` in the same chapter: the test row is indented under the source.
- Collapsing all of a fully-covered file's hunks turns its sidebar checkbox + file-head "Viewed" green; partial-coverage files only reach amber and the Viewed control shows the tooltip.
- Clicking the file-head "Viewed" control collapses/expands all that file's hunks and flips every sidebar row for that path together.

- [ ] **Step 9: Commit**

```bash
git add skills/pr-walkthrough/assets/viewer.js skills/pr-walkthrough/assets/styles.css
git commit -m "feat(pr-walkthrough): sidebar redesign, test nesting, read→viewed roll-up"
```

---

## Task 6: Comments — GitHub-style composer with suggestions

**Files:**
- Modify: `skills/pr-walkthrough/assets/comments.js` (composer creation ~117-164; capture selected source in mouseup ~83-93)
- Modify: `skills/pr-walkthrough/assets/styles.css` (toolbar, tabs)

**Interfaces:**
- Produces: `buildComposer({ placeholder, suggestText }) -> { root, getValue, focus }` reused by line/file/edit composers.

- [ ] **Step 1: Capture the selected source lines on mouseup** — in the `mouseup` handler (~line 92), change the `openComposer` call to include the selected new-side source text:

```js
    var suggestText = d.side === 'RIGHT'
      ? range.map(function (c) {
          var code = c.parentNode.querySelector('td.rc code')
          return code ? code.textContent : ''
        }).join('\n')
      : ''
    openComposer(anchorRow, { kind: 'line', path: d.sec.getAttribute('data-path'), side: d.side, line: hi, startLine: lo === hi ? null : lo, suggestText: suggestText })
```

- [ ] **Step 2: Add a reusable composer builder** — add near the composer code (after `closeComposer`, ~line 118):

```js
  function buildComposer(opts) {
    opts = opts || {}
    var root = el('div', 'wt-composer')
    var bar = el('div', 'wt-bar')
    var tabs = el('div', 'wt-tabs')
    var tabW = el('span', 'wt-tab wt-on', 'Write'), tabP = el('span', 'wt-tab', 'Preview')
    tabs.appendChild(tabW); tabs.appendChild(tabP); bar.appendChild(tabs)

    var ta = el('textarea'); ta.placeholder = opts.placeholder || 'Comment…'
    var preview = el('div', 'wt-preview prose'); preview.style.display = 'none'

    function wrap(before, after, sample) {
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value
      var sel = v.slice(s, e) || sample || ''
      ta.value = v.slice(0, s) + before + sel + after + v.slice(e)
      ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length
    }
    var TOOLS = [
      ['B', 'Bold', function () { wrap('**', '**', 'bold') }],
      ['i', 'Italic', function () { wrap('_', '_', 'italic') }],
      ['</>', 'Code', function () { wrap('`', '`', 'code') }],
      ['▤', 'Code block', function () { wrap('\n```\n', '\n```\n', 'code') }],
      ['🔗', 'Link', function () { wrap('[', '](url)', 'text') }],
      ['❝', 'Quote', function () { wrap('> ', '', 'quote') }],
      ['☰', 'List', function () { wrap('- ', '', 'item') }],
    ]
    TOOLS.forEach(function (t) {
      var b = el('button', 'wt-tbtn', t[0]); b.type = 'button'; b.title = t[1]
      b.addEventListener('click', function () { tabW.click(); t[2]() })
      bar.appendChild(b)
    })
    if (opts.suggestText) {
      var sg = el('button', 'wt-tbtn wt-suggest', '± Suggest'); sg.type = 'button'; sg.title = 'Insert a suggestion prefilled with the selected lines'
      sg.addEventListener('click', function () {
        tabW.click()
        var pre = ta.value && ta.value.slice(-1) !== '\n' ? ta.value + '\n' : ta.value
        ta.value = pre + '```suggestion\n' + opts.suggestText + '\n```\n'
        ta.focus()
      })
      bar.appendChild(sg)
    }
    tabW.addEventListener('click', function () { tabW.classList.add('wt-on'); tabP.classList.remove('wt-on'); ta.style.display = ''; preview.style.display = 'none' })
    tabP.addEventListener('click', function () { tabP.classList.add('wt-on'); tabW.classList.remove('wt-on'); renderBody(preview, ta.value || '_Nothing to preview_'); ta.style.display = 'none'; preview.style.display = '' })

    root.appendChild(bar); root.appendChild(ta); root.appendChild(preview)
    return { root: root, getValue: function () { return ta.value.trim() }, focus: function () { ta.focus() } }
  }
```

- [ ] **Step 3: Use `buildComposer` in `openComposer`** — replace the body of `openComposer` (lines 119-137) with:

```js
  function openComposer(afterRow, anchor) {
    closeComposer()
    var tr = el('tr', 'wt-composer-row')
    var td = el('td'); td.colSpan = 4
    var c = buildComposer({ placeholder: 'Comment…', suggestText: anchor.suggestText })
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add to review')
    cancel.addEventListener('click', closeComposer)
    ok.addEventListener('click', function () {
      var body = c.getValue(); if (!body) return
      add({ kind: anchor.kind, path: anchor.path, side: anchor.side, line: anchor.line, startLine: anchor.startLine, body: body })
      closeComposer()
    })
    row.appendChild(cancel); row.appendChild(ok)
    c.root.appendChild(row); td.appendChild(c.root); tr.appendChild(td)
    afterRow.parentNode.insertBefore(tr, afterRow.nextSibling)
    composerRow = tr; c.focus()
  }
```

- [ ] **Step 4: Use `buildComposer` in `openBlockComposer`** — replace its body (lines 154-164) with:

```js
  function openBlockComposer(container, anchor) {
    if (blockComposer) { blockComposer.remove(); blockComposer = null }
    var c = buildComposer({ placeholder: 'Comment on this file…' })
    c.root.classList.add('wt-block')
    var row = el('div', 'wt-actions')
    var cancel = el('button', 'wt-btn', 'Cancel'); var ok = el('button', 'wt-btn wt-primary', 'Add to review')
    cancel.addEventListener('click', function () { c.root.remove(); blockComposer = null })
    ok.addEventListener('click', function () { var b = c.getValue(); if (!b) return; add({ kind: 'file', path: anchor.path, body: b }); c.root.remove(); blockComposer = null })
    row.appendChild(cancel); row.appendChild(ok); c.root.appendChild(row)
    container.insertBefore(c.root, container.firstChild); blockComposer = c.root; c.focus()
  }
```

- [ ] **Step 5: Add toolbar/tab styles** — append to `styles.css`:

```css
/* ---- composer toolbar + tabs ---- */
.wt-bar { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px; }
.wt-tabs { display: flex; gap: 2px; margin-right: 6px; }
.wt-tab { padding: 3px 9px; border-radius: 6px; color: var(--muted); cursor: pointer; font-size: 12px; }
.wt-tab.wt-on { background: var(--bg); color: var(--fg); font-weight: 600; }
.wt-tbtn { background: none; border: none; color: var(--muted); cursor: pointer; border-radius: 6px; padding: 3px 7px; font-size: 13px; }
.wt-tbtn:hover { background: var(--bg); color: var(--fg); }
.wt-suggest { margin-left: auto; border: 1px solid var(--border); }
.wt-suggest:hover { border-color: var(--add-num); }
.wt-preview { min-height: 40px; padding: 4px 2px; }
```

- [ ] **Step 6: Syntax check**

Run: `node --check skills/pr-walkthrough/assets/comments.js`
Expected: exit 0.

- [ ] **Step 7: Manual browser check (human checkpoint)**

Rebuild and open. Confirm:
- Selecting a line opens a full-width composer with a toolbar and Write/Preview tabs; toolbar buttons wrap the selection; Preview renders Markdown.
- For a RIGHT-side selection, "± Suggest" inserts a ` ```suggestion ` block prefilled with the selected source line(s).
- File-level "Comment on file" opens the same composer (no Suggest button).

- [ ] **Step 8: Commit**

```bash
git add skills/pr-walkthrough/assets/comments.js skills/pr-walkthrough/assets/styles.css
git commit -m "feat(pr-walkthrough): GitHub-style comment composer with suggestions"
```

---

## Task 7: Comments — viewedFiles export + sidebar comment badges

**Files:**
- Modify: `skills/pr-walkthrough/assets/comments.js` (`exportReview` ~30-41; `refresh` ~278)

**Interfaces:**
- Consumes: `data.pathHunks` (Task 3), the read set at `pr-walkthrough:<repo>#<pr>:read` (Task 4).
- Produces: `exportReview()` returns `{ …, viewedFiles: string[] }`; sidebar `.file-link .badge` shows per-path comment counts.

- [ ] **Step 1: Add `viewedFiles` to the export** — replace `exportReview` (lines 30-41) with:

```js
  function readSetIds() {
    try { return JSON.parse(localStorage.getItem(KEY + ':read') || '[]') } catch (e) { return [] }
  }
  // Mirror of build-walkthrough.mjs viewedFilesFrom — keep in sync.
  function viewedFiles() {
    var ph = data.pathHunks || {}
    var read = {}; readSetIds().forEach(function (id) { read[id] = true })
    return Object.keys(ph).filter(function (p) {
      var h = ph[p]
      return h.fullyCovered && h.hunkIds.length > 0 && h.hunkIds.every(function (id) { return read[id] })
    })
  }
  function exportReview() {
    var out = { repo: pr.repo, pr: pr.number, commit: pr.commit, body: '', comments: [], fileComments: [], viewedFiles: viewedFiles() }
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
```

- [ ] **Step 2: Update sidebar comment badges on refresh** — add this function above `refresh` (line 277) and call it from `refresh`:

```js
  function updateSidebarBadges() {
    var counts = {}
    comments.forEach(function (c) { counts[c.path] = (counts[c.path] || 0) + 1 })
    ;[].slice.call(document.querySelectorAll('.sidebar .file-link')).forEach(function (link) {
      var badge = link.querySelector('.badge'); if (!badge) return
      var n = counts[link.getAttribute('data-path')] || 0
      badge.textContent = n ? '💬' + n : ''
    })
  }
```

Then change `refresh` (line 278) to:

```js
  function refresh() { clearRendered(); renderLineThreads(); renderFileCards(); renderPanel(); updateSidebarBadges() }
```

- [ ] **Step 3: Syntax check**

Run: `node --check skills/pr-walkthrough/assets/comments.js`
Expected: exit 0.

- [ ] **Step 4: Manual browser check (human checkpoint)**

Rebuild and open. Confirm:
- Adding a comment shows `💬N` next to that file's sidebar row(s).
- In the devtools console, after marking a fully-covered file Viewed, `__wtc.exportReview().viewedFiles` includes that path; a partial-coverage file never appears.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough/assets/comments.js
git commit -m "feat(pr-walkthrough): export viewedFiles and show sidebar comment badges"
```

---

## Task 8: Rebuild zip, changeset, full verification

**Files:**
- Generated: `skills/pr-walkthrough.zip`
- Create: `.changeset/pr-walkthrough-viewer-ux.md`

- [ ] **Step 1: Run the full build-side test suite + syntax checks**

Run:
```bash
node --test skills/pr-walkthrough/scripts/build-walkthrough.test.mjs
node --check skills/pr-walkthrough/assets/viewer.js
node --check skills/pr-walkthrough/assets/comments.js
```
Expected: tests PASS; checks exit 0.

- [ ] **Step 2: End-to-end build against a real PR (human checkpoint)**

Pick a PR with a multi-hunk file and a source+test pair. Author a pointer JSON per `skills/pr-walkthrough/walkthrough-prompt.md`, then:
```bash
node skills/pr-walkthrough/scripts/build-walkthrough.mjs --data /tmp/wt.json --out /tmp/wt.html --pr <NUMBER> --head <SHA>
```
Open `/tmp/wt.html` and run through the Task 4/5/6/7 browser checks end-to-end, including exporting the review and confirming `viewedFiles` is present in the copied JSON.

- [ ] **Step 3: Add the changeset** — create `.changeset/pr-walkthrough-viewer-ux.md`:

```markdown
---
"hal-agent-skills-build": minor
---

pr-walkthrough viewer overhaul: cleaner sidebar with test nesting, per-hunk collapse with a per-path read→viewed roll-up, sticky hunk headers, and a GitHub-style Markdown comment composer with suggestions. The exported review now includes a `viewedFiles` list (consumed by post-pr-review to mark files viewed on GitHub).
```

- [ ] **Step 4: Rebuild the distributed zip**

Run: `npm --prefix packages/hal-agent-skills run build`
Expected: `✓ pr-walkthrough.zip`. (Do not commit unrelated stale zips — `git add` only `pr-walkthrough.zip`.)

- [ ] **Step 5: Commit**

```bash
git add skills/pr-walkthrough.zip .changeset/pr-walkthrough-viewer-ux.md
git commit -m "chore(pr-walkthrough): changeset + rebuilt zip for viewer UX overhaul"
```

---

## Self-Review (completed against the spec)

- **Sidebar cleanup + test nesting** → Tasks 1, 5. ✅
- **Per-hunk collapse / read** → Task 4. ✅
- **Per-path viewed roll-up (across chapters) + partial-coverage rule** → Tasks 2, 3, 5. ✅
- **Sticky headers** → Task 4 (hunk) + existing file-head sticky retained. ✅
- **Composer (toolbar + Write/Preview) + suggestions** → Task 6. ✅
- **viewedFiles export** → Task 3 (logic), Task 7 (wiring). ✅
- **Build/changeset/zip** → Task 8. ✅
- **Type consistency:** hunk id `path@newStart` identical in build (`computePathHunks`), viewer (`buildDiff`/`setPathRead`), comments (`viewedFiles`). `viewedFilesFrom` (build, tested) and `viewedFiles` (comments inline) intentionally mirror each other — noted in both. ✅
- **Out of scope (per spec):** no WYSIWYG, no live GitHub calls, no `unmark`, no main-content reorder, no cross-chapter nesting. ✅
