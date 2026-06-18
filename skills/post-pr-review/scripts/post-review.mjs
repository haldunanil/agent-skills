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
  if (!isInt(r.pr) || r.pr <= 0) err('pr', 'must be a positive integer')
  if (!isStr(r.commit)) err('commit', 'must be a commit sha string')
  if (r.body !== undefined && typeof r.body !== 'string') err('body', 'must be a string')

  const comments = r.comments ?? []
  const fileComments = r.fileComments ?? []
  if (!Array.isArray(comments)) err('comments', 'must be an array')
  else comments.forEach((c, i) => {
    const p = `comments[${i}]`
    if (!isStr(c?.path)) err(`${p}.path`, 'must be a string')
    if (!SIDES.has(c?.side)) err(`${p}.side`, 'must be LEFT or RIGHT')
    if (!isInt(c?.line) || c.line <= 0) err(`${p}.line`, 'must be a positive integer')
    if (c?.startLine != null && (!isInt(c.startLine) || c.startLine <= 0)) err(`${p}.startLine`, 'must be a positive integer')
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

// Hint shown when gh returns a bare 422 with no detail: the agent should retry once with
// GH_DEBUG=api to surface GitHub's validation response. Gated on GH_DEBUG so it stays silent on
// the debug rerun (where details are already visible).
export function maybe422Hint(message, env = process.env) {
  if (/\b422\b/.test(message) && !env.GH_DEBUG) {
    return 'GitHub returned HTTP 422 without details. Retry once with GH_DEBUG=api unless Already posted includes a review.'
  }
  return null
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
    const hint = maybe422Hint(e.message)
    if (hint) console.error(hint)
    process.exit(1)
  }
  console.log(JSON.stringify({ ok: true, posted }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
