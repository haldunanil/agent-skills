#!/usr/bin/env node
// Validate + resolve a PR-walkthrough pointer JSON and render a self-contained HTML viewer.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const KINDS = new Set(['normal', 'lockfile', 'generated', 'binary'])

const isStr = (v) => typeof v === 'string'
const isInt = (v) => Number.isInteger(v)
const isArr = Array.isArray
const isLinePair = (v) => isArr(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]) && v[0] <= v[1]

// Template slot tokens — template.html MUST contain these exact comments.
export const SLOT_STYLES = '<!--PR_WALKTHROUGH_STYLES-->'
export const SLOT_VIEWER = '<!--PR_WALKTHROUGH_VIEWER_JS-->'
export const SLOT_DATA = '<!--PR_WALKTHROUGH_DATA-->'

export function validateShape(data) {
  const errors = []
  const err = (p, m) => errors.push(`${p}: ${m}`)

  if (typeof data !== 'object' || data === null || isArr(data)) return ['<root>: must be an object']

  const pr = data.pr
  if (typeof pr !== 'object' || pr === null || isArr(pr)) {
    err('pr', 'must be an object')
  } else {
    for (const k of ['title', 'repo', 'commit', 'author', 'headBranch', 'baseBranch', 'url']) {
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

// ---------- referential resolution (layer 2) ----------
// Split a full `gh pr diff` into per-file unified diffs, keyed by the new path.
export function splitPrDiff(fullDiff) {
  const map = {}
  if (!fullDiff || !fullDiff.trim()) return map
  for (const section of fullDiff.split(/(?=^diff --git )/m)) {
    if (!section.startsWith('diff --git ')) continue
    const file =
      (/^rename to (.+)$/m.exec(section) || [])[1] ||
      (/^\+\+\+ b\/(.+)$/m.exec(section) || [])[1] ||
      (/^diff --git a\/.+ b\/(.+)$/m.exec(section) || [])[1]
    if (file) map[file] = section
  }
  return map
}

// Diffs come from `gh pr diff` — GitHub's canonical PR diff, correct for open,
// merged, AND fork PRs alike. (`git diff base...head` goes empty once a PR is
// merged via a merge commit, because the base then contains the head.) Context
// (unchanged) code is read from the head commit, matching the final-state framing.
export function prDiffProvider(prNumber, headSha) {
  const opts = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  let map = null
  const load = () => {
    if (map) return map
    let full
    try {
      full = execFileSync('gh', ['pr', 'diff', String(prNumber)], opts)
    } catch (e) {
      throw new Error(`gh pr diff ${prNumber} failed — is gh installed and authenticated? ${(e.stderr || e.message || '').toString().trim()}`)
    }
    map = splitPrDiff(full)
    return map
  }
  return {
    fileDiff: (file) => load()[file] || '',
    changedFiles: () => Object.keys(load()),
    showLines: (ref, [a, b]) => {
      try {
        return execFileSync('git', ['show', `${headSha}:${ref}`], opts).split('\n').slice(a - 1, b).join('\n')
      } catch (e) {
        throw new Error(`git show ${headSha}:${ref} failed — ensure the PR head commit is fetched locally. ${(e.stderr || e.message || '').toString().trim()}`)
      }
    },
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

// layer 3: every changed file in the PR must appear in some section.
// Only runs when the provider can list changed files (i.e. base/head are known).
export function coverageErrors(data, provider) {
  if (typeof provider.changedFiles !== 'function') return []
  const covered = new Set()
  for (const ch of data.chapters) for (const s of ch.sections) covered.add(s.file)
  return provider
    .changedFiles()
    .filter((f) => !covered.has(f))
    .map((f) => `${f}: changed file not covered by any walkthrough section`)
}

// ---------- inlining / rendering ----------
export function escapeForScript(s) {
  return s.replace(/<\/script/gi, (m) => '<\\/' + m.slice(2))
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

// ---------- orchestration + CLI ----------
export function buildDocument(data, { provider, assetsDir }) {
  const errors = validateShape(data)
  if (errors.length) {
    const e = new Error('Validation failed:\n' + errors.join('\n'))
    e.validation = errors
    throw e
  }
  resolveSections(data, provider)
  const cov = coverageErrors(data, provider)
  if (cov.length) {
    const e = new Error('Coverage failed:\n' + cov.join('\n'))
    e.coverage = cov
    throw e
  }
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
    if (args.pr && args.head && errors.length === 0) {
      const provider = prDiffProvider(args.pr, args.head)
      try {
        resolveSections(data, provider)
        errors.push(...coverageErrors(data, provider))
      } catch (e) { errors.push(e.message) }
    }
    if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
    console.log('ok')
    return
  }

  if (args.data && args.out && args.pr && args.head) {
    const data = JSON.parse(readFileSync(args.data, 'utf8'))
    let html
    try {
      html = buildDocument(data, { provider: prDiffProvider(args.pr, args.head), assetsDir: assetsDirFromScript() })
    } catch (e) {
      console.error(e.message)
      process.exit(1)
    }
    writeFileSync(args.out, html)
    console.log(args.out)
    return
  }

  console.error('usage:')
  console.error('  build-walkthrough.mjs --validate <data.json> [--pr <number> --head <sha>]')
  console.error('  build-walkthrough.mjs --data <data.json> --out <out.html> --pr <number> --head <sha>')
  process.exit(2)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
