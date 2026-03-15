import { watch, existsSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { SkillsLoader } from './loader.ts'

/**
 * Watch skills directories for changes and auto-trigger reload.
 * Uses node:fs watch (recursive) with debouncing.
 */
export class SkillsWatcher {
  private loader: SkillsLoader
  private onReload?: (skills: unknown[]) => void
  private watchers: FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number

  constructor(loader: SkillsLoader, options?: { onReload?: (skills: unknown[]) => void; debounceMs?: number }) {
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

    const dirsToWatch = [
      paths.skills,                               // Project-level skills/
      resolve(homedir(), '.youclaw', 'skills'),   // User-level
    ]

    // Also watch skills subdirectories under agents
    if (existsSync(paths.agents)) {
      dirsToWatch.push(paths.agents)
    }

    for (const dir of dirsToWatch) {
      if (!existsSync(dir)) continue

      try {
        const watcher = watch(dir, { recursive: true }, (_event, _filename) => {
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
   * Debounced reload scheduling.
   */
  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      const logger = getLogger()

      try {
        const skills = this.loader.refresh()
        logger.info({ count: skills.length }, 'Skills hot-reload complete')
        this.onReload?.(skills)
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Skills hot-reload failed')
      }
    }, this.debounceMs)
  }
}
