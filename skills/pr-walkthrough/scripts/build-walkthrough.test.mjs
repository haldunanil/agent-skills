import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateShape } from './build-walkthrough.mjs'

function validData() {
  return {
    pr: { number: 482, repo: 'acme/widgets', commit: 'deadbeef', title: 'Add auth', author: 'me',
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

test('validateShape: pr.commit is required', () => {
  const d = validData(); delete d.pr.commit
  assert.ok(validateShape(d).some((e) => e.startsWith('pr.commit')), 'expected pr.commit error')
})

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

import { resolveSections } from './build-walkthrough.mjs'

function fakeProvider(diffs, codes, files) {
  return {
    fileDiff: (file) => diffs[file] ?? '',
    showLines: (ref) => codes[ref] ?? '',
    changedFiles: () => files ?? Object.keys(diffs),
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

import { mkdtempSync, writeFileSync as writeFileSyncT } from 'node:fs'
import { tmpdir } from 'node:os'
import path2 from 'node:path'
import { escapeForScript, renderHtml, SLOT_STYLES, SLOT_VIEWER, SLOT_DATA, SLOT_COMMENTS } from './build-walkthrough.mjs'

function tempAssets() {
  const dir = mkdtempSync(path2.join(tmpdir(), 'pw-assets-'))
  writeFileSyncT(path2.join(dir, 'template.html'),
    `<!DOCTYPE html><html><head>${SLOT_STYLES}</head><body>` +
    `<script id="walkthrough-data" type="application/json">${SLOT_DATA}</script>${SLOT_VIEWER}${SLOT_COMMENTS}</body></html>`)
  writeFileSyncT(path2.join(dir, 'styles.css'), 'body{color:red}')
  writeFileSyncT(path2.join(dir, 'viewer.js'), "console.log('viewer')")
  writeFileSyncT(path2.join(dir, 'comments.js'), "console.log('comments')")
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

import { readFileSync as readFileSyncT } from 'node:fs'
import { fileURLToPath as f2u } from 'node:url'

const REAL_ASSETS = path2.join(path2.dirname(f2u(import.meta.url)), '..', 'assets')

test('real template.html contains all three slot tokens', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  for (const slot of [SLOT_STYLES, SLOT_VIEWER, SLOT_DATA]) {
    assert.ok(tpl.includes(slot), `missing ${slot}`)
  }
})

test('renderHtml inlines comments.js', () => {
  const assetsDir = tempAssets()
  const html = renderHtml({ x: 1 }, { assetsDir })
  assert.ok(html.includes("console.log('comments')"), 'comments.js should be inlined')
})

test('real template.html contains the comments slot', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  assert.ok(tpl.includes(SLOT_COMMENTS), 'template must contain the comments slot token')
})

test('real template.html loads CDN libs with SRI on every CDN tag', () => {
  const tpl = readFileSyncT(path2.join(REAL_ASSETS, 'template.html'), 'utf8')
  // every CDN <script>/<link> must carry a non-empty sha384 integrity attribute
  const cdnTags = tpl.match(/<(script|link)[^>]*cdnjs[^>]*>/g) || []
  assert.ok(cdnTags.length >= 3, 'expected at least 3 CDN tags (hljs css + hljs js + markdown-it)')
  for (const tag of cdnTags) assert.ok(/integrity="sha384-.+?"/.test(tag), `no SRI on: ${tag}`)
})

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

import { coverageErrors } from './build-walkthrough.mjs'

test('coverageErrors flags a changed file not covered by any section', () => {
  const errs = coverageErrors(validData(), fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, {}, ['src/user.ts', 'src/orphan.ts']))
  assert.ok(errs.some((e) => e.startsWith('src/orphan.ts')), errs.join('; '))
})

test('coverageErrors passes when every changed file is covered', () => {
  assert.deepEqual(coverageErrors(validData(), fakeProvider({}, {}, ['src/user.ts'])), [])
})

test('buildDocument throws a coverage error when a changed file is uncovered', () => {
  const assetsDir = tempAssets()
  assert.throws(
    () => buildDocument(validData(), {
      assetsDir,
      provider: fakeProvider({ 'src/user.ts': TWO_HUNK_DIFF }, { 'src/helper.ts': 'x' }, ['src/user.ts', 'src/missing.ts']),
    }),
    (e) => {
      assert.ok(Array.isArray(e.coverage))
      assert.ok(e.coverage.some((m) => m.startsWith('src/missing.ts')))
      return true
    },
  )
})

import { splitPrDiff } from './build-walkthrough.mjs'

const MULTI_FILE_PR_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/src/added.ts b/src/added.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/added.ts',
  '@@ -0,0 +1 @@',
  '+hello',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 100%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  '',
].join('\n')

test('splitPrDiff keys each file section by its new path (modify/add/delete/rename)', () => {
  const map = splitPrDiff(MULTI_FILE_PR_DIFF)
  assert.deepEqual(Object.keys(map).sort(), ['new/name.ts', 'src/a.ts', 'src/added.ts', 'src/gone.ts'])
})

test('splitPrDiff captures full, non-bleeding per-file sections', () => {
  const map = splitPrDiff(MULTI_FILE_PR_DIFF)
  assert.ok(map['src/a.ts'].startsWith('diff --git a/src/a.ts'))
  assert.ok(map['src/a.ts'].includes('+new'))
  assert.ok(!map['src/a.ts'].includes('src/added.ts'))      // sections must not bleed into each other
  assert.ok(map['new/name.ts'].includes('rename to new/name.ts'))
  assert.ok(map['src/gone.ts'].includes('+++ /dev/null'))   // deletion keyed by its path
})

test('splitPrDiff returns an empty map for empty input', () => {
  assert.deepEqual(splitPrDiff(''), {})
})

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
