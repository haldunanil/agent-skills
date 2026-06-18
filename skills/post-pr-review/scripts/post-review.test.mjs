import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReview, reviewApiArgs, fileCommentApiArgs, postReview, maybe422Hint } from './post-review.mjs'

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
