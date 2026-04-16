#!/usr/bin/env node
/**
 * Validate rule files for every registered rule-based skill.
 *
 * If no skills are registered in SKILLS (see config.ts), this is a no-op
 * and exits 0 — orchestration-style skills are handled by validate-skills.ts.
 */

import { readdir } from 'fs/promises'
import { join } from 'path'
import { Rule } from './types.js'
import { parseRuleFile } from './parser.js'
import { SKILLS, SkillConfig } from './config.js'

interface ValidationError {
  skill: string
  file: string
  ruleId?: string
  message: string
}

function validateRule(rule: Rule, skill: string, file: string): ValidationError[] {
  const errors: ValidationError[] = []

  if (!rule.title || rule.title.trim().length === 0) {
    errors.push({ skill, file, ruleId: rule.id, message: 'Missing or empty title' })
  }

  if (!rule.explanation || rule.explanation.trim().length === 0) {
    errors.push({ skill, file, ruleId: rule.id, message: 'Missing or empty explanation' })
  }

  if (!rule.examples || rule.examples.length === 0) {
    errors.push({
      skill,
      file,
      ruleId: rule.id,
      message: 'Missing examples (need at least one bad and one good example)',
    })
  } else {
    const codeExamples = rule.examples.filter(
      (e) => e.code && e.code.trim().length > 0
    )

    const hasBad = codeExamples.some(
      (e) =>
        e.label.toLowerCase().includes('incorrect') ||
        e.label.toLowerCase().includes('wrong') ||
        e.label.toLowerCase().includes('bad')
    )
    const hasGood = codeExamples.some(
      (e) =>
        e.label.toLowerCase().includes('correct') ||
        e.label.toLowerCase().includes('good') ||
        e.label.toLowerCase().includes('usage') ||
        e.label.toLowerCase().includes('implementation') ||
        e.label.toLowerCase().includes('example')
    )

    if (codeExamples.length === 0) {
      errors.push({ skill, file, ruleId: rule.id, message: 'Missing code examples' })
    } else if (!hasBad && !hasGood) {
      errors.push({
        skill,
        file,
        ruleId: rule.id,
        message: 'Missing bad/incorrect or good/correct examples',
      })
    }
  }

  const validImpacts: Rule['impact'][] = [
    'CRITICAL',
    'HIGH',
    'MEDIUM-HIGH',
    'MEDIUM',
    'LOW-MEDIUM',
    'LOW',
  ]
  if (!validImpacts.includes(rule.impact)) {
    errors.push({
      skill,
      file,
      ruleId: rule.id,
      message: `Invalid impact level: ${rule.impact}. Must be one of: ${validImpacts.join(', ')}`,
    })
  }

  return errors
}

async function validateSkill(skill: SkillConfig): Promise<ValidationError[]> {
  const errors: ValidationError[] = []
  const files = await readdir(skill.rulesDir)
  const ruleFiles = files.filter((f) => f.endsWith('.md') && !f.startsWith('_'))

  for (const file of ruleFiles) {
    const filePath = join(skill.rulesDir, file)
    try {
      const { rule } = await parseRuleFile(filePath, skill.sectionMap)
      errors.push(...validateRule(rule, skill.name, file))
    } catch (error) {
      errors.push({
        skill: skill.name,
        file,
        message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  console.log(`  ${skill.name}: validated ${ruleFiles.length} rule file(s)`)
  return errors
}

async function validate() {
  try {
    const registered = Object.values(SKILLS)

    if (registered.length === 0) {
      console.log('No rule-based skills to validate.')
      return
    }

    console.log('Validating rule files...')

    const allErrors: ValidationError[] = []
    for (const skill of registered) {
      allErrors.push(...(await validateSkill(skill)))
    }

    if (allErrors.length > 0) {
      console.error('\n✗ Validation failed:\n')
      allErrors.forEach((error) => {
        const loc = `${error.skill}/${error.file}${error.ruleId ? ` (${error.ruleId})` : ''}`
        console.error(`  ${loc}: ${error.message}`)
      })
      process.exit(1)
    }

    console.log('✓ All rule files are valid')
  } catch (error) {
    console.error('Validation failed:', error)
    process.exit(1)
  }
}

validate()
