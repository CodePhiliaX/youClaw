import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { getLogger } from '../logger/index.ts'
import type { Skill } from './types.ts'

/**
 * SkillsInstaller: manages skill installation and uninstallation.
 *
 * Supports:
 * - Copy skill from local path
 * - Download skill from remote URL
 * - Uninstall skill (delete directory + run teardown)
 * - Dependency and conflict checks
 */
export class SkillsInstaller {
  /**
   * Install a skill from a local path to the target directory.
   */
  async installFromLocal(sourcePath: string, targetDir: string): Promise<void> {
    const logger = getLogger()

    if (!existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`)
    }

    const skillName = basename(sourcePath)
    const destPath = resolve(targetDir, skillName)

    if (existsSync(destPath)) {
      throw new Error(`Skill "${skillName}" already exists in target directory`)
    }

    // Create target directory
    mkdirSync(destPath, { recursive: true })

    // Copy files
    try {
      execSync(`cp -r "${sourcePath}/"* "${destPath}/"`, { encoding: 'utf-8', timeout: 30_000 })
    } catch (err) {
      // Clean up failed installation
      rmSync(destPath, { recursive: true, force: true })
      throw new Error(`Failed to copy skill files: ${err instanceof Error ? err.message : String(err)}`)
    }

    logger.info({ skillName, sourcePath, destPath }, 'Skill installed from local path')
  }

  /**
   * Install a skill from a remote URL.
   */
  async installFromUrl(url: string, targetDir: string): Promise<void> {
    const logger = getLogger()

    // Create temp directory for download
    const tmpDir = resolve(targetDir, `.tmp-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    try {
      // Download using curl
      execSync(`curl -sL "${url}" -o "${tmpDir}/SKILL.md"`, { encoding: 'utf-8', timeout: 30_000 })

      // Read downloaded file and parse frontmatter for name
      const { parseFrontmatter } = await import('./frontmatter.ts')
      const content = readFileSync(resolve(tmpDir, 'SKILL.md'), 'utf-8')
      const { frontmatter } = parseFrontmatter(content)
      const skillName = frontmatter.name

      const destPath = resolve(targetDir, skillName)
      if (existsSync(destPath)) {
        throw new Error(`Skill "${skillName}" already exists in target directory`)
      }

      // Move to final location
      mkdirSync(destPath, { recursive: true })
      execSync(`mv "${tmpDir}/SKILL.md" "${destPath}/SKILL.md"`, { encoding: 'utf-8' })

      logger.info({ skillName, url, destPath }, 'Skill installed from remote URL')
    } finally {
      // Clean up temp directory
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * Uninstall a skill.
   */
  async uninstall(skillName: string, targetDir: string): Promise<void> {
    const logger = getLogger()
    const skillDir = resolve(targetDir, skillName)

    if (!existsSync(skillDir)) {
      throw new Error(`Skill "${skillName}" does not exist`)
    }

    // Try to read frontmatter and run teardown
    try {
      const skillFile = resolve(skillDir, 'SKILL.md')
      if (existsSync(skillFile)) {
        const { parseFrontmatter } = await import('./frontmatter.ts')
        const content = readFileSync(skillFile, 'utf-8')
        const { frontmatter } = parseFrontmatter(content)

        if (frontmatter.teardown) {
          logger.info({ skillName, teardown: frontmatter.teardown }, 'Running teardown command')
          try {
            execSync(frontmatter.teardown, { encoding: 'utf-8', timeout: 30_000 })
          } catch (err) {
            logger.warn({ skillName, error: err instanceof Error ? err.message : String(err) }, 'Teardown command failed')
          }
        }
      }
    } catch {
      // Teardown failure does not block uninstallation
    }

    // Delete skill directory
    rmSync(skillDir, { recursive: true, force: true })
    logger.info({ skillName }, 'Skill uninstalled')
  }

  /**
   * Check dependencies and conflicts.
   */
  checkCompatibility(skill: Skill, installedSkills: Skill[]): { ok: boolean; issues: string[] } {
    const issues: string[] = []
    const installedNames = new Set(installedSkills.map((s) => s.name))

    // Check dependencies
    if (skill.frontmatter.requires) {
      for (const dep of skill.frontmatter.requires) {
        if (!installedNames.has(dep)) {
          issues.push(`Missing required skill: ${dep}`)
        }
      }
    }

    // Check conflicts
    if (skill.frontmatter.conflicts) {
      for (const conflict of skill.frontmatter.conflicts) {
        if (installedNames.has(conflict)) {
          issues.push(`Conflicts with installed skill "${conflict}"`)
        }
      }
    }

    return { ok: issues.length === 0, issues }
  }
}
