import { readdirSync } from 'node:fs'
import { minimatch } from 'minimatch'
import type { Skill } from './types.ts'

// Directories and files excluded during scanning
const EXCLUDED = new Set(['.git', 'node_modules', '.DS_Store', 'data'])

/**
 * Scan workspace directory and return relative paths of all files.
 * Excludes .git, node_modules, .DS_Store, data/.
 */
export function scanWorkspaceFiles(workspaceDir: string): string[] {
  try {
    const entries = readdirSync(workspaceDir, { recursive: true, withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue

      // Build relative path
      const parentPath = entry.parentPath ?? (entry as any).path ?? ''
      const relativeDir = parentPath
        ? parentPath.replace(workspaceDir, '').replace(/^\//, '')
        : ''
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

      // Check if path contains an excluded directory
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
 * Check if a skill's globs match any files in the workspace.
 * - No globs or empty array -> unconditionally included (returns true)
 * - Otherwise checks if any file matches at least one glob pattern
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
