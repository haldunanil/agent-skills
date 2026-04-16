/**
 * Configuration for the rule-based skill build tooling.
 *
 * Register rule-based skills here by appending to the SKILLS map below.
 *
 * Each entry describes how a skill's `rules/` directory + `metadata.json`
 * compile into a generated AGENTS.md. Example shape:
 *
 *   'my-skill': {
 *     name: 'my-skill',
 *     title: 'My Skill',
 *     description: 'projects of type X',
 *     skillDir:     join(SKILLS_DIR, 'my-skill'),
 *     rulesDir:     join(SKILLS_DIR, 'my-skill/rules'),
 *     metadataFile: join(SKILLS_DIR, 'my-skill/metadata.json'),
 *     outputFile:   join(SKILLS_DIR, 'my-skill/AGENTS.md'),
 *     sectionMap:   { 'section-a': 1, 'section-b': 2 },
 *   }
 *
 * Orchestration-style skills (SKILL.md + reference prompt files, no rules/)
 * do NOT belong here — they are handled by validate-skills.ts and
 * package-skills.ts.
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Base paths
export const SKILLS_DIR = join(__dirname, '../../..', 'skills')
export const BUILD_DIR = join(__dirname, '..')

// Skill configurations
export interface SkillConfig {
  name: string
  title: string
  description: string
  skillDir: string
  rulesDir: string
  metadataFile: string
  outputFile: string
  sectionMap: Record<string, number>
}

export const SKILLS: Record<string, SkillConfig> = {}

// Test cases are build artifacts, not part of any skill
export const TEST_CASES_FILE = join(BUILD_DIR, 'test-cases.json')
