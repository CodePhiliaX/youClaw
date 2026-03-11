import { readdirSync } from 'node:fs'
import { minimatch } from 'minimatch'
import type { Skill } from './types.ts'

// 扫描时排除的目录和文件
const EXCLUDED = new Set(['.git', 'node_modules', '.DS_Store', 'data'])

/**
 * 扫描工作空间目录，返回所有文件的相对路径列表
 * 排除 .git、node_modules、.DS_Store、data/
 */
export function scanWorkspaceFiles(workspaceDir: string): string[] {
  try {
    const entries = readdirSync(workspaceDir, { recursive: true, withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue

      // 构建相对路径
      const parentPath = entry.parentPath ?? (entry as any).path ?? ''
      const relativeDir = parentPath
        ? parentPath.replace(workspaceDir, '').replace(/^\//, '')
        : ''
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

      // 检查路径中是否包含排除目录
      const parts = relativePath.split('/')
      if (parts.some((p) => EXCLUDED.has(p))) continue

      files.push(relativePath)
    }

    return files
  } catch {
    return []
  }
}

/**
 * 检查 skill 的 globs 是否匹配工作空间中的文件
 * - 无 globs 或空数组 → 无条件纳入（返回 true）
 * - 否则用 Bun.Glob 检查是否有文件匹配任一 glob 模式
 */
export function matchSkillGlobs(skill: Skill, filePaths: string[]): boolean {
  const globs = skill.frontmatter.globs
  if (!globs || globs.length === 0) return true

  for (const pattern of globs) {
    for (const filePath of filePaths) {
      if (minimatch(filePath, pattern)) return true
    }
  }

  return false
}
