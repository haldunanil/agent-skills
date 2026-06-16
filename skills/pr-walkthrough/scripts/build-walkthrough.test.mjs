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
