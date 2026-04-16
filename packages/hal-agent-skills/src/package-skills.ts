#!/usr/bin/env node
/**
 * Package every skill in skills/<name>/ into skills/<name>.zip
 *
 * Requires the `zip` CLI to be on PATH. Each archive has <name>/ as its root
 * entry so it unpacks cleanly into ~/.claude/skills/.
 */

import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { SKILLS_DIR } from './config.js'

function runZip(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('zip', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`zip exited with code ${code}: ${stderr.trim()}`))
    })
  })
}

async function main() {
  try {
    if (!existsSync(SKILLS_DIR)) {
      console.log('No skills/ directory found. Nothing to package.')
      return
    }

    const entries = await readdir(SKILLS_DIR)
    const skillNames: string[] = []
    for (const entry of entries) {
      const full = join(SKILLS_DIR, entry)
      if (!(await stat(full)).isDirectory()) continue
      if (!existsSync(join(full, 'SKILL.md'))) {
        console.log(`  ⏭ ${entry}: no SKILL.md, skipping`)
        continue
      }
      skillNames.push(entry)
    }

    if (skillNames.length === 0) {
      console.log('No skills to package.')
      return
    }

    console.log(`Packaging ${skillNames.length} skill(s)...`)

    for (const name of skillNames) {
      const zipPath = join(SKILLS_DIR, `${name}.zip`)
      if (existsSync(zipPath)) await unlink(zipPath)

      await runZip(SKILLS_DIR, [
        '-r',
        '-q',
        '-X',
        `${name}.zip`,
        name,
        '-x',
        '*.DS_Store',
      ])
      console.log(`  ✓ ${name}.zip`)
    }

    console.log('✓ Packaging complete')
  } catch (error) {
    console.error('Packaging failed:', error)
    process.exit(1)
  }
}

main()
