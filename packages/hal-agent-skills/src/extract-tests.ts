#!/usr/bin/env node
/**
 * Extract test cases from rule-based skills for LLM evaluation.
 *
 * Iterates every registered skill in SKILLS (see config.ts). If no skills
 * are registered, exits 0 without writing anything.
 */

import { readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { Rule, TestCase } from './types.js'
import { parseRuleFile } from './parser.js'
import { SKILLS, SkillConfig, TEST_CASES_FILE } from './config.js'

function extractTestCases(rule: Rule): TestCase[] {
  const testCases: TestCase[] = []

  rule.examples.forEach((example) => {
    const isBad =
      example.label.toLowerCase().includes('incorrect') ||
      example.label.toLowerCase().includes('wrong') ||
      example.label.toLowerCase().includes('bad')
    const isGood =
      example.label.toLowerCase().includes('correct') ||
      example.label.toLowerCase().includes('good')

    if (isBad || isGood) {
      testCases.push({
        ruleId: rule.id,
        ruleTitle: rule.title,
        type: isBad ? 'bad' : 'good',
        code: example.code,
        language: example.language || 'typescript',
        description:
          example.description || `${example.label} example for ${rule.title}`,
      })
    }
  })

  return testCases
}

async function extractFromSkill(skill: SkillConfig): Promise<TestCase[]> {
  const files = await readdir(skill.rulesDir)
  const ruleFiles = files.filter(
    (f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md'
  )

  const testCases: TestCase[] = []
  for (const file of ruleFiles) {
    const filePath = join(skill.rulesDir, file)
    try {
      const { rule } = await parseRuleFile(filePath, skill.sectionMap)
      testCases.push(...extractTestCases(rule))
    } catch (error) {
      console.error(`  Error processing ${skill.name}/${file}:`, error)
    }
  }
  return testCases
}

async function extractTests() {
  try {
    const registered = Object.values(SKILLS)

    if (registered.length === 0) {
      console.log('No rule-based skills registered. Skipping test extraction.')
      return
    }

    console.log('Extracting test cases from rules...')
    console.log(`Output file: ${TEST_CASES_FILE}`)

    const allTestCases: TestCase[] = []
    for (const skill of registered) {
      console.log(`  ${skill.name}...`)
      allTestCases.push(...(await extractFromSkill(skill)))
    }

    await writeFile(TEST_CASES_FILE, JSON.stringify(allTestCases, null, 2), 'utf-8')

    console.log(
      `✓ Extracted ${allTestCases.length} test cases to ${TEST_CASES_FILE}`
    )
    console.log(
      `  - Bad examples: ${allTestCases.filter((tc) => tc.type === 'bad').length}`
    )
    console.log(
      `  - Good examples: ${allTestCases.filter((tc) => tc.type === 'good').length}`
    )
  } catch (error) {
    console.error('Extraction failed:', error)
    process.exit(1)
  }
}

extractTests()
