import { watch, existsSync, mkdirSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { Skill } from './types.ts'
import type { SkillsLoader } from './loader.ts'

function normalizeWatchFilename(filename?: string | Buffer | null): string {
  if (!filename) return ''
  return String(filename).replaceAll('\\', '/')
}

function isIgnoredPath(filename: string): boolean {
  return filename.includes('/node_modules/')
    || filename.includes('/dist/')
    || filename.includes('/.git/')
    || filename.includes('/.cache/')
}

function isRelevantSkillPath(filename: string): boolean {
  if (!filename) return true
  if (filename.endsWith('/SKILL.md') || filename === 'SKILL.md') {
    return true
  }
  if (filename.includes('/skills/') && filename.endsWith('SKILL.md')) {
    return true
  }
  if (filename.includes('/skills/')) {
    return true
  }
  return false
}

/**
 * Watch skill directories for changes and auto-trigger invalidation.
 * Uses node:fs watch (recursive) with debouncing and SKILL.md-focused filtering.
 */
export class SkillsWatcher {
  private loader: SkillsLoader
  private onReload?: (skills: Skill[]) => void
  private watchers: FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number

  constructor(loader: SkillsLoader, options?: { onReload?: (skills: Skill[]) => void; debounceMs?: number }) {
    this.loader = loader
    this.onReload = options?.onReload
    this.debounceMs = options?.debounceMs ?? 500
  }

  /**
   * Start watching.
   */
  start(): void {
    const logger = getLogger()
    const paths = getPaths()

    // Ensure mutable roots exist before watching so newly created user/workspace
    // skill folders still trigger cache invalidation without requiring restart.
    const writableDirs = [
      paths.userSkills,
      paths.agents,
    ]
    for (const dir of writableDirs) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (err) {
        logger.warn({ dir, error: err instanceof Error ? err.message : String(err) }, 'Failed to prepare skills watch directory')
      }
    }

    const dirsToWatch = [
      paths.skills,
      paths.userSkills,
    ]

    if (existsSync(paths.agents)) {
      dirsToWatch.push(paths.agents)
    }

    for (const dir of dirsToWatch) {
      if (!existsSync(dir)) continue

      try {
        const watcher = watch(dir, { recursive: true }, (_event, filename) => {
          const normalized = normalizeWatchFilename(filename)
          if (isIgnoredPath(normalized)) return
          if (!isRelevantSkillPath(normalized)) return
          this.scheduleReload()
        })
        this.watchers.push(watcher)
        logger.debug({ dir }, 'Skills watcher started')
      } catch (err) {
        logger.warn({ dir, error: err instanceof Error ? err.message : String(err) }, 'Failed to start skills watcher')
      }
    }

    if (this.watchers.length > 0) {
      logger.info({ watcherCount: this.watchers.length }, 'Skills hot-reload watcher started')
    }
  }

  /**
   * Stop watching.
   */
  stop(): void {
    const logger = getLogger()

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []

    logger.debug('Skills watcher stopped')
  }

  /**
   * Debounced invalidation scheduling.
   */
  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      const logger = getLogger()

      try {
        const version = this.loader.invalidate({ bumpReason: 'watch' })
        const skills = this.loader.loadAllSkills()
        logger.info({ count: skills.length, version }, 'Skills hot-reload complete')
        this.onReload?.(skills)
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Skills hot-reload failed')
      }
    }, this.debounceMs)
  }
}
