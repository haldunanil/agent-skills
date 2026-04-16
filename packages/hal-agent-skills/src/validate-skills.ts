#!/usr/bin/env node
/**
 * Validate SKILL.md files across every skill directory.
 *
 * Checks:
 *  - YAML frontmatter parses
 *  - `name` and `description` are present
 *  - frontmatter `name` matches the directory name (kebab-case)
 *  - relative file references inside SKILL.md (markdown/bash) resolve to
 *    sibling files
 *
 * Warns (does not fail) if SKILL.md exceeds 500 lines.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { SKILLS_DIR } from './config.js'

interface Issue {
  skill: string
  message: string
  kind: 'error' | 'warning'
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const out: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function collectReferences(content: string): string[] {
  const refs = new Set<string>()

  // Markdown links: [text](path.md) or [text](./path.md)
  const linkRe = /\[[^\]]*\]\(([^)\s]+\.(?:md|sh))\)/g
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(content)) !== null) {
    const path = m[1]
    if (!/^https?:\/\//.test(path) && !path.startsWith('/')) {
      refs.add(path.replace(/^\.\//, ''))
    }
  }

  // Inline code references to sibling .md files (e.g. `action-plan-prompt.md`)
  const codeRe = /`([a-z0-9][a-z0-9._-]*\.(?:md|sh))`/gi
  while ((m = codeRe.exec(content)) !== null) {
    refs.add(m[1])
  }

  return Array.from(refs)
}

async function validateSkillDir(skillDir: string, name: string): Promise<Issue[]> {
  const issues: Issue[] = []
  const skillFile = join(skillDir, 'SKILL.md')

  if (!existsSync(skillFile)) {
    issues.push({ skill: name, kind: 'error', message: 'Missing SKILL.md' })
    return issues
  }

  const content = await readFile(skillFile, 'utf-8')

  const frontmatter = parseFrontmatter(content)
  if (!frontmatter) {
    issues.push({
      skill: name,
      kind: 'error',
      message: 'SKILL.md is missing YAML frontmatter',
    })
    return issues
  }

  if (!frontmatter.name) {
    issues.push({ skill: name, kind: 'error', message: 'frontmatter.name is missing' })
  } else if (frontmatter.name !== name) {
    issues.push({
      skill: name,
      kind: 'error',
      message: `frontmatter.name "${frontmatter.name}" does not match directory "${name}"`,
    })
  }

  if (!frontmatter.description) {
    issues.push({
      skill: name,
      kind: 'error',
      message: 'frontmatter.description is missing',
    })
  }

  const lineCount = content.split('\n').length
  if (lineCount > 500) {
    issues.push({
      skill: name,
      kind: 'warning',
      message: `SKILL.md is ${lineCount} lines (recommended ≤ 500). Consider moving detail into reference files.`,
    })
  }

  const refs = collectReferences(content)
  for (const ref of refs) {
    const refPath = join(skillDir, ref)
    if (!existsSync(refPath)) {
      issues.push({
        skill: name,
        kind: 'error',
        message: `Referenced file "${ref}" does not exist next to SKILL.md`,
      })
    }
  }

  return issues
}

async function main() {
  try {
    if (!existsSync(SKILLS_DIR)) {
      console.log('No skills/ directory found. Skipping SKILL.md validation.')
      return
    }

    const entries = await readdir(SKILLS_DIR)
    const skillDirs: { dir: string; name: string }[] = []
    for (const entry of entries) {
      const full = join(SKILLS_DIR, entry)
      if ((await stat(full)).isDirectory()) {
        skillDirs.push({ dir: full, name: entry })
      }
    }

    if (skillDirs.length === 0) {
      console.log('No skill directories found.')
      return
    }

    console.log(`Validating ${skillDirs.length} skill(s)...`)

    const allIssues: Issue[] = []
    for (const { dir, name } of skillDirs) {
      const issues = await validateSkillDir(dir, name)
      allIssues.push(...issues)
      const errs = issues.filter((i) => i.kind === 'error').length
      const warns = issues.filter((i) => i.kind === 'warning').length
      const status = errs === 0 ? '✓' : '✗'
      console.log(`  ${status} ${name} (${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'})`)
    }

    const errors = allIssues.filter((i) => i.kind === 'error')
    const warnings = allIssues.filter((i) => i.kind === 'warning')

    for (const w of warnings) {
      console.warn(`  ⚠ ${w.skill}: ${w.message}`)
    }

    if (errors.length > 0) {
      console.error('\n✗ SKILL.md validation failed:\n')
      for (const e of errors) {
        console.error(`  ${e.skill}: ${e.message}`)
      }
      process.exit(1)
    }

    console.log('✓ All SKILL.md files are valid')
  } catch (error) {
    console.error('SKILL.md validation failed:', error)
    process.exit(1)
  }
}

main()
