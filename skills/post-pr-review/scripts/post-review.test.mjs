import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReview, reviewApiArgs, fileCommentApiArgs, postReview, maybe422Hint, markFilesViewed } from './post-review.mjs'

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
  assert.ok(validateReview(review({ comments: [], fileComments: [] })).some((e) => e.includes('nothing to post')))
})

test('validateReview rejects startLine greater than line', () => {
  assert.ok(validateReview(review({ comments: [{ path: 'a', side: 'RIGHT', line: 5, startLine: 9, body: 'x' }] }))
    .some((e) => e.includes('startLine')))
})

test('validateReview rejects non-positive pr and line', () => {
  assert.ok(validateReview(review({ pr: 0 })).some((e) => e.startsWith('pr')))
  assert.ok(validateReview(review({ comments: [{ path: 'a', side: 'RIGHT', line: 0, body: 'x' }] })).some((e) => e.includes('.line')))
})

test('validateReview accepts a file-comments-only review (no comments key)', () => {
  const r = { repo: 'acme/widgets', pr: 5, commit: 'abc123', fileComments: [{ path: 'src/a.ts', body: 'whole file' }] }
  assert.deepEqual(validateReview(r), [])
  const { gh, calls } = fakeGh()
  postReview(r, { gh })
  assert.equal(calls.length, 1)                                  // no review call, just the file comment
  assert.equal(calls[0].body.subject_type, 'file')
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

test('maybe422Hint suggests GH_DEBUG on a bare 422, not when already debugging or on other errors', () => {
  assert.match(maybe422Hint('gh: Unprocessable Entity (HTTP 422)', {}), /GH_DEBUG=api/)
  assert.equal(maybe422Hint('gh: Unprocessable Entity (HTTP 422)', { GH_DEBUG: 'api' }), null)
  assert.equal(maybe422Hint('gh: Not Found (HTTP 404)', {}), null)
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

test('validateReview accepts a viewed-only review (no comments)', () => {
  const r = { repo: 'acme/widgets', pr: 5, commit: 'abc123', viewedFiles: ['src/a.ts'] }
  assert.deepEqual(validateReview(r), [])
})

test('validateReview rejects non-string viewedFiles entries and a fully empty review', () => {
  assert.ok(validateReview(review({ viewedFiles: [123] })).some((e) => e.startsWith('viewedFiles[0]')))
  const empty = { repo: 'acme/widgets', pr: 5, commit: 'abc123', comments: [], fileComments: [], viewedFiles: [] }
  assert.ok(validateReview(empty).some((e) => e.includes('nothing to post')))
})

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
