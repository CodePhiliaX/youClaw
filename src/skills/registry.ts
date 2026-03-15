import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { unzipSync } from 'fflate'
import { getLogger } from '../logger/index.ts'
import type { SkillsLoader } from './loader.ts'
import type { SkillRegistryMeta } from './types.ts'

export interface RecommendedSkill {
  slug: string
  displayName: string
  summary: string
  category: string
  installed: boolean
}

interface RecommendedEntry {
  slug: string
  displayName: string
  summary: string
  category: string
}

const CLAWHUB_DOWNLOAD_URL = 'https://clawhub.ai/api/v1/download'

export class RegistryManager {
  private recommended: RecommendedEntry[] = []

  constructor(private skillsLoader: SkillsLoader) {
    this.loadRecommendedList()
  }

  /** Get recommended list, merged with local installation status */
  getRecommended(): RecommendedSkill[] {
    const allSkills = this.skillsLoader.loadAllSkills()
    // Set of installed slugs (matched by registryMeta or directory name)
    const installedSlugs = new Set<string>()
    for (const skill of allSkills) {
      if (skill.registryMeta?.slug) {
        installedSlugs.add(skill.registryMeta.slug)
      }
    }

    // Also check if a directory for the slug exists in user skills directory
    const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
    for (const entry of this.recommended) {
      if (!installedSlugs.has(entry.slug)) {
        const dir = resolve(userSkillsDir, entry.slug)
        if (existsSync(resolve(dir, 'SKILL.md'))) {
          installedSlugs.add(entry.slug)
        }
      }
    }

    return this.recommended.map((entry) => ({
      ...entry,
      installed: installedSlugs.has(entry.slug),
    }))
  }

  /** Download ZIP from ClawHub and install to ~/.youclaw/skills/<slug>/ */
  async installSkill(slug: string): Promise<void> {
    const logger = getLogger()
    const entry = this.recommended.find((e) => e.slug === slug)
    if (!entry) {
      throw new Error(`Unknown recommended skill: ${slug}`)
    }

    const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
    const targetDir = resolve(userSkillsDir, slug)

    if (existsSync(resolve(targetDir, 'SKILL.md'))) {
      throw new Error(`Skill "${slug}" is already installed`)
    }

    // Download ZIP
    const url = `${CLAWHUB_DOWNLOAD_URL}?slug=${encodeURIComponent(slug)}`
    logger.info({ slug, url }, 'Downloading skill from ClawHub')

    let response = await fetch(url)

    // Handle 429 rate limit: read retry-after, wait and retry once
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10)
      logger.warn({ slug, retryAfter }, 'ClawHub rate limited, waiting to retry')
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      response = await fetch(url)
    }

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`)
    }

    const zipBuffer = await response.arrayBuffer()

    // Unzip and install
    mkdirSync(targetDir, { recursive: true })

    try {
      const zipData = new Uint8Array(zipBuffer)
      const files = unzipSync(zipData)

      let hasSkillMd = false

      for (const [filePath, content] of Object.entries(files)) {
        // Skip directory entries (ending with / and empty content)
        if (filePath.endsWith('/') && content.length === 0) continue

        // Strip possible top-level directory prefix (e.g. slug/)
        let relativePath = filePath
        const firstSlash = filePath.indexOf('/')
        if (firstSlash !== -1) {
          // Check if all files share the same top-level directory
          relativePath = filePath.slice(firstSlash + 1)
          if (!relativePath) continue // Top-level directory itself
        }

        if (relativePath === 'SKILL.md' || relativePath.endsWith('/SKILL.md')) {
          hasSkillMd = true
        }

        const destPath = resolve(targetDir, relativePath)
        const destDir = resolve(destPath, '..')
        mkdirSync(destDir, { recursive: true })
        writeFileSync(destPath, content)
      }

      // If SKILL.md not found, files may be directly in root directory
      if (!hasSkillMd) {
        // Double-check if extracted directly to targetDir
        if (!existsSync(resolve(targetDir, 'SKILL.md'))) {
          throw new Error('SKILL.md not found in ZIP archive')
        }
      }

      // Write .registry.json metadata
      const meta: SkillRegistryMeta = {
        source: 'clawhub',
        slug,
        installedAt: new Date().toISOString(),
        displayName: entry.displayName,
      }
      writeFileSync(resolve(targetDir, '.registry.json'), JSON.stringify(meta, null, 2))

      // Refresh skills cache
      this.skillsLoader.refresh()
      logger.info({ slug, targetDir }, 'Skill installed')
    } catch (err) {
      // Clean up failed installation
      const { rmSync } = await import('node:fs')
      rmSync(targetDir, { recursive: true, force: true })
      throw err
    }
  }

  /** Uninstall a skill */
  async uninstallSkill(slug: string): Promise<void> {
    const logger = getLogger()
    const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
    const targetDir = resolve(userSkillsDir, slug)

    if (!existsSync(targetDir)) {
      throw new Error(`Skill "${slug}" is not installed`)
    }

    const { rmSync } = await import('node:fs')
    rmSync(targetDir, { recursive: true, force: true })

    this.skillsLoader.refresh()
    logger.info({ slug }, 'Skill uninstalled')
  }

  /** Load recommended list (cached at startup) */
  private loadRecommendedList(): void {
    const logger = getLogger()
    try {
      // Use import.meta.url to ensure embedded file is readable after compilation
      const filePath = new URL('./recommended-skills.json', import.meta.url).pathname
      const raw = readFileSync(filePath, 'utf-8')
      this.recommended = JSON.parse(raw)
      logger.debug({ count: this.recommended.length }, 'Recommended skills list loaded')
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to load recommended skills list')
      this.recommended = []
    }
  }
}
