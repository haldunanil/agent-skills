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
