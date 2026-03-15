import { execSync } from 'node:child_process'
import type { SkillFrontmatter, EligibilityDetail, DependencyCheckResult, EnvCheckResult } from './types.ts'

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

export interface EligibilityResult {
  eligible: boolean
  errors: string[]
  detail: EligibilityDetail
}

/**
 * Check whether a skill meets its runtime requirements:
 * - OS platform match
 * - Required executables exist
 * - Required environment variables are set
 */
export function checkEligibility(frontmatter: SkillFrontmatter): EligibilityResult {
  const errors: string[] = []

  // Check OS
  const osPassed = !frontmatter.os || frontmatter.os.length === 0 || frontmatter.os.includes(process.platform)
  if (!osPassed) {
    errors.push(`OS mismatch: requires [${frontmatter.os!.join(', ')}], current is ${process.platform}`)
  }

  // Check dependencies (executables)
  const depResults: DependencyCheckResult[] = []
  if (frontmatter.dependencies) {
    for (const dep of frontmatter.dependencies) {
      const path = which(dep)
      depResults.push({ name: dep, found: !!path, path: path ?? undefined })
      if (!path) {
        errors.push(`Missing dependency: executable "${dep}" not found`)
      }
    }
  }
  const depsPassed = depResults.every((r) => r.found)

  // Check env (environment variables)
  const envResults: EnvCheckResult[] = []
  if (frontmatter.env) {
    for (const envVar of frontmatter.env) {
      const found = !!process.env[envVar]
      envResults.push({ name: envVar, found })
      if (!found) {
        errors.push(`Missing environment variable: "${envVar}" is not set`)
      }
    }
  }
  const envPassed = envResults.every((r) => r.found)

  const detail: EligibilityDetail = {
    os: { passed: osPassed, current: process.platform, required: frontmatter.os },
    dependencies: { passed: depsPassed, results: depResults },
    env: { passed: envPassed, results: envResults },
  }

  return {
    eligible: errors.length === 0,
    errors,
    detail,
  }
}
