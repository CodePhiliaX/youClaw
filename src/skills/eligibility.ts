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
 * 检查 skill 是否满足运行条件
 * - OS 是否匹配
 * - 依赖的可执行文件是否存在
 * - 需要的环境变量是否已设置
 */
export function checkEligibility(frontmatter: SkillFrontmatter): EligibilityResult {
  const errors: string[] = []

  // 检查 OS
  const osPassed = !frontmatter.os || frontmatter.os.length === 0 || frontmatter.os.includes(process.platform)
  if (!osPassed) {
    errors.push(`OS 不匹配: 需要 [${frontmatter.os!.join(', ')}]，当前为 ${process.platform}`)
  }

  // 检查 dependencies（可执行文件）
  const depResults: DependencyCheckResult[] = []
  if (frontmatter.dependencies) {
    for (const dep of frontmatter.dependencies) {
      const path = which(dep)
      depResults.push({ name: dep, found: !!path, path: path ?? undefined })
      if (!path) {
        errors.push(`依赖缺失: 可执行文件 "${dep}" 未找到`)
      }
    }
  }
  const depsPassed = depResults.every((r) => r.found)

  // 检查 env（环境变量）
  const envResults: EnvCheckResult[] = []
  if (frontmatter.env) {
    for (const envVar of frontmatter.env) {
      const found = !!process.env[envVar]
      envResults.push({ name: envVar, found })
      if (!found) {
        errors.push(`环境变量缺失: "${envVar}" 未设置`)
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
