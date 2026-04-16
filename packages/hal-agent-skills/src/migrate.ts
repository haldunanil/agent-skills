#!/usr/bin/env node
/**
 * Migration helper: split a monolithic legacy markdown file (e.g. RPG.md)
 * into per-section and per-rule files under <skill>/rules/.
 *
 * Requires a --skill=<name> flag matching an entry in SKILLS (see config.ts).
 * The source file is read from <skillDir>/RPG.md by default; override with
 * --source=<path>.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { SKILLS } from './config.js'

const args = process.argv.slice(2)
const skillArg = args.find((a) => a.startsWith('--skill='))
const sourceArg = args.find((a) => a.startsWith('--source='))
const skillName = skillArg ? skillArg.split('=')[1] : null
const sourceOverride = sourceArg ? sourceArg.split('=')[1] : null

function parseSectionHeading(line: string): { number: number; title: string } | null {
  const match = line.match(/^##\s+(\d+)\.\s+(.+)$/)
  if (match) {
    return { number: parseInt(match[1]), title: match[2].trim() }
  }
  return null
}

function parseRuleHeading(
  line: string
): { section: number; subsection: number; title: string } | null {
  const match = line.match(/^###\s+(\d+)\.(\d+)\s+(.+)$/)
  if (match) {
    return {
      section: parseInt(match[1]),
      subsection: parseInt(match[2]),
      title: match[3].trim(),
    }
  }
  return null
}

function extractImpact(line: string): { impact: string; description?: string } | null {
  const match = line.match(/\*\*Impact:\s*(\w+(?:-\w+)?)\s*(?:\(([^)]+)\))?/i)
  if (match) {
    return { impact: match[1].toUpperCase(), description: match[2] }
  }
  return null
}

async function migrate() {
  if (!skillName) {
    console.error('Usage: migrate --skill=<name> [--source=<path>]')
    console.error(`Available skills: ${Object.keys(SKILLS).join(', ') || '(none registered)'}`)
    process.exit(1)
  }

  const skill = SKILLS[skillName]
  if (!skill) {
    console.error(`Unknown skill: ${skillName}`)
    console.error(`Available skills: ${Object.keys(SKILLS).join(', ') || '(none registered)'}`)
    process.exit(1)
  }

  const sourceFile = sourceOverride ?? join(skill.skillDir, 'RPG.md')

  try {
    console.log(`Migrating ${sourceFile} into ${skill.rulesDir}...`)

    if (!existsSync(sourceFile)) {
      console.error(`Source file not found: ${sourceFile}`)
      process.exit(1)
    }

    if (!existsSync(skill.rulesDir)) {
      await mkdir(skill.rulesDir, { recursive: true })
    }

    const content = await readFile(sourceFile, 'utf-8')
    const lines = content.split('\n')

    let currentSection: {
      number: number
      title: string
      impact?: string
      introduction?: string
    } | null = null
    let currentRule: {
      section: number
      subsection: number
      title: string
      content: string[]
    } | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      const sectionInfo = parseSectionHeading(line)
      if (sectionInfo) {
        if (currentSection) {
          const sectionFile = join(skill.rulesDir, `section-${currentSection.number}.md`)
          let sectionContent = `# ${currentSection.number}. ${currentSection.title}\n\n`
          if (currentSection.impact) {
            sectionContent += `**Impact: ${currentSection.impact}**\n\n`
          }
          if (currentSection.introduction) {
            sectionContent += `## Introduction\n\n${currentSection.introduction}\n`
          }
          await writeFile(sectionFile, sectionContent, 'utf-8')
        }

        currentSection = sectionInfo
        currentRule = null

        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const impactInfo = extractImpact(lines[j])
          if (impactInfo) {
            currentSection.impact = impactInfo.impact
            break
          }
        }

        const introduction: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          if (parseRuleHeading(lines[j])) break
          if (!lines[j].match(/^###/)) introduction.push(lines[j])
        }
        currentSection.introduction = introduction.join('\n').trim()
        continue
      }

      const ruleInfo = parseRuleHeading(line)
      if (ruleInfo) {
        if (currentRule && currentSection) {
          const ruleFile = join(
            skill.rulesDir,
            `section-${currentRule.section}-rule-${currentRule.subsection}.md`
          )
          await writeFile(ruleFile, currentRule.content.join('\n'), 'utf-8')
          console.log(`Created ${ruleFile}`)
        }

        currentRule = { ...ruleInfo, content: [line] }
        continue
      }

      if (currentRule) currentRule.content.push(line)
    }

    if (currentRule && currentSection) {
      const ruleFile = join(
        skill.rulesDir,
        `section-${currentRule.section}-rule-${currentRule.subsection}.md`
      )
      await writeFile(ruleFile, currentRule.content.join('\n'), 'utf-8')
      console.log(`Created ${ruleFile}`)
    }

    if (currentSection) {
      const sectionFile = join(skill.rulesDir, `section-${currentSection.number}.md`)
      let sectionContent = `# ${currentSection.number}. ${currentSection.title}\n\n`
      if (currentSection.impact) {
        sectionContent += `**Impact: ${currentSection.impact}**\n\n`
      }
      if (currentSection.introduction) {
        sectionContent += `## Introduction\n\n${currentSection.introduction}\n`
      }
      await writeFile(sectionFile, sectionContent, 'utf-8')
      console.log(`Created ${sectionFile}`)
    }

    console.log('\n✓ Migration complete!')
    console.log('Note: You may need to manually add frontmatter to rule files.')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
}

migrate()
