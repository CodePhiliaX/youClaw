import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { formatSkillsForPrompt, type Skill as PiAgentSkill } from '@mariozechner/pi-coding-agent'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSkillSettings, setSkillEnabled as dbSetSkillEnabled } from '../db/index.ts'
import type { AgentConfig } from '../agent/types.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { checkEligibility } from './eligibility.ts'
import { bumpSkillsSnapshotVersion, getSkillsSnapshotVersion } from './refresh.ts'
import type {
  Skill,
  SkillsConfig,
  AgentSkillsView,
  SkillRegistryMeta,
  SkillPromptSnapshot,
  SkillResolutionSummary,
} from './types.ts'
import { DEFAULT_SKILLS_CONFIG } from './types.ts'

export class SkillsLoader {
  private baseCache: Map<string, Skill> = new Map()
  private cacheVersion = 0
  private lastLoadTime = 0
  private config: SkillsConfig

  constructor(config?: Partial<SkillsConfig>) {
    this.config = { ...DEFAULT_SKILLS_CONFIG, ...config }
  }

  /**
   * Load globally available skills.
   * Global scope includes builtin resources and user-installed skills only.
   */
  loadAllSkills(forceReload?: boolean): Skill[] {
    return this.loadBaseSkills(forceReload)
  }

  /**
   * Load all skills visible to a specific agent.
   * Priority: builtin < user < workspace
   */
  loadAllSkillsForAgent(agentConfig: AgentConfig, forceReload?: boolean): Skill[] {
    const skillMap = new Map<string, Skill>()

    for (const skill of this.loadBaseSkills(forceReload)) {
      skillMap.set(skill.name, skill)
    }

    this.loadSkillsFromDir(resolve(agentConfig.workspaceDir, 'skills'), 'workspace', skillMap)
    this.applySettings(skillMap)

    return Array.from(skillMap.values())
  }

  /**
   * Normalize agent skill bindings to local skill names.
   * Wildcard always wins; registry slugs are converted to installed local names when possible.
   */
  normalizeAgentSkillNames(
    skills?: string[],
    availableSkills?: Skill[],
  ): { skills: string[] | undefined; changed: boolean } {
    if (!skills || skills.length === 0) {
      return { skills, changed: false }
    }

    if (skills.includes('*')) {
      return { skills: ['*'], changed: skills.length !== 1 || skills[0] !== '*' }
    }

    const resolvedSkills = availableSkills ?? this.loadAllSkills()
    const knownNames = new Set(resolvedSkills.map((skill) => skill.name))
    const namesBySlug = new Map<string, string>()
    for (const skill of resolvedSkills) {
      const slug = skill.registryMeta?.slug
      if (slug) {
        namesBySlug.set(slug, skill.name)
      }
    }

    const normalized: string[] = []
    const seen = new Set<string>()
    let changed = false

    for (const skillId of skills) {
      const normalizedSkill = knownNames.has(skillId)
        ? skillId
        : (namesBySlug.get(skillId) ?? skillId)

      if (normalizedSkill !== skillId) {
        changed = true
      }
      if (seen.has(normalizedSkill)) {
        changed = true
        continue
      }

      seen.add(normalizedSkill)
      normalized.push(normalizedSkill)
    }

    if (!changed && normalized.length !== skills.length) {
      changed = true
    }

    return { skills: normalized, changed }
  }

  /**
   * Filter loaded skills based on agent.yaml skills field.
   * "*" wildcard = all skills; undefined or empty = no skills; otherwise filter by explicit list.
   */
  loadSkillsForAgent(agentConfig: AgentConfig): Skill[] {
    const allSkills = this.loadAllSkillsForAgent(agentConfig)
    const normalized = this.normalizeAgentSkillNames(agentConfig.skills, allSkills).skills
    if (normalized?.includes('*')) {
      return allSkills
    }
    if (!normalized || normalized.length === 0) {
      return []
    }
    return allSkills.filter((skill) => normalized.includes(skill.name))
  }

  /**
   * Set a skill's enabled/disabled state and refresh the cache.
   */
  setSkillEnabled(name: string, enabled: boolean): Skill | null {
    dbSetSkillEnabled(name, enabled)
    const skills = this.refresh()
    return skills.find((s) => s.name === name) ?? null
  }

  /**
   * Get the skills view for a specific agent.
   */
  getAgentSkillsView(agentConfig: AgentConfig): AgentSkillsView {
    const available = this.loadAllSkillsForAgent(agentConfig)
    const normalized = this.normalizeAgentSkillNames(agentConfig.skills, available).skills
    const isWildcard = normalized?.includes('*')
    const enabled = isWildcard
      ? available
      : normalized && normalized.length > 0
        ? available.filter((s) => normalized.includes(s.name))
        : []
    const eligible = enabled.filter((s) => s.eligible)
    return { available, enabled, eligible }
  }

  /**
   * Build the versioned runtime snapshot used by agent execution.
   */
  buildSnapshotForAgent(agentConfig: AgentConfig, requestedSkills?: string[]): SkillPromptSnapshot {
    const requested = requestedSkills
      ? Array.from(new Set(requestedSkills.map((name) => name.trim()).filter(Boolean)))
      : undefined
    const requestedSet = requested ? new Set(requested) : null
    const enabledSkills = this.loadSkillsForAgent(agentConfig)
      .filter((skill) => skill.usable)
      .filter((skill) => !requestedSet || requestedSet.has(skill.name))
    const limited = this.applyPromptLimits(enabledSkills)

    return {
      prompt: formatSkillsForPrompt(limited.map((skill) => this.toPiSkill(skill))),
      skills: limited,
      resolvedSkills: limited,
      version: getSkillsSnapshotVersion(),
      ...(requested ? { requestedSkills: requested } : {}),
    }
  }

  /**
   * Backward-compatible prompt snapshot helper.
   */
  buildPromptSnapshot(agentConfig: AgentConfig, requestedSkills?: string[]): SkillPromptSnapshot {
    return this.buildSnapshotForAgent(agentConfig, requestedSkills)
  }

  /**
   * Return usable skill names for inline invocation parsing.
   */
  getUsableSkillNamesForAgent(agentConfig: AgentConfig): Set<string> {
    return new Set(
      this.loadAllSkillsForAgent(agentConfig)
        .filter((skill) => skill.usable)
        .map((skill) => skill.name),
    )
  }

  /**
   * Return versioned source metadata for agent-visible skills.
   */
  getResolutionSummary(agentConfig: AgentConfig): SkillResolutionSummary {
    const skills = this.loadAllSkillsForAgent(agentConfig)
    return {
      version: getSkillsSnapshotVersion(),
      skills: skills.map((skill) => ({
        name: skill.name,
        source: skill.source,
        path: skill.path,
      })),
    }
  }

  /**
   * Clear cache, bump the snapshot version, and reload global skills.
   */
  refresh(options?: { bumpReason?: 'watch' | 'manual'; preserveVersion?: boolean }): Skill[] {
    this.clearCache()
    if (!options?.preserveVersion) {
      bumpSkillsSnapshotVersion(options?.bumpReason ?? 'manual')
    }
    return this.loadBaseSkills(true)
  }

  /**
   * Clear cache and bump the snapshot version without eagerly reloading.
   */
  invalidate(options?: { bumpReason?: 'watch' | 'manual'; preserveVersion?: boolean }): number {
    this.clearCache()
    if (options?.preserveVersion) {
      return getSkillsSnapshotVersion()
    }
    return bumpSkillsSnapshotVersion(options?.bumpReason ?? 'manual')
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { skillCount: number; lastLoadTime: number; cached: boolean; version: number } {
    return {
      skillCount: this.baseCache.size,
      lastLoadTime: this.lastLoadTime,
      cached: this.baseCache.size > 0,
      version: getSkillsSnapshotVersion(),
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): SkillsConfig {
    return { ...this.config }
  }

  /**
   * Apply priority-aware prompt limits to a skills list.
   * 1. Group by priority: critical / normal / low
   * 2. Critical: only truncate individual content, exempt from count and total limits
   * 3. Normal + Low: normal first then low, apply count and total char limits (minus critical usage)
   * 4. Return order: critical -> normal -> low
   */
  applyPromptLimits(skills: Skill[]): Skill[] {
    const { maxSingleSkillChars, maxSkillCount, maxTotalChars } = this.config

    const critical: Skill[] = []
    const normal: Skill[] = []
    const low: Skill[] = []

    for (const skill of skills) {
      const priority = skill.frontmatter.priority ?? 'normal'
      if (priority === 'critical') critical.push(skill)
      else if (priority === 'low') low.push(skill)
      else normal.push(skill)
    }

    const truncate = (skill: Skill): Skill => {
      if (skill.content.length <= maxSingleSkillChars) return skill
      return {
        ...skill,
        content: skill.content.slice(0, maxSingleSkillChars) + '\n...[content truncated]',
      }
    }

    const limitedCritical = critical.map(truncate)
    const criticalCount = limitedCritical.length
    const criticalChars = limitedCritical.reduce((sum, s) => sum + s.content.length, 0)

    const rest = [...normal, ...low].map(truncate)
    const remainingCount = Math.max(0, maxSkillCount - criticalCount)
    const remainingChars = Math.max(0, maxTotalChars - criticalChars)

    let totalChars = 0
    const limitedRest: Skill[] = []
    for (const skill of rest) {
      if (limitedRest.length >= remainingCount) break
      totalChars += skill.content.length
      if (totalChars > remainingChars) break
      limitedRest.push(skill)
    }

    return [...limitedCritical, ...limitedRest]
  }

  private loadBaseSkills(forceReload?: boolean): Skill[] {
    const version = getSkillsSnapshotVersion()
    if (!forceReload && this.baseCache.size > 0 && this.cacheVersion === version) {
      return Array.from(this.baseCache.values())
    }

    const logger = getLogger()
    const paths = getPaths()
    const skillMap = new Map<string, Skill>()

    this.loadSkillsFromDir(paths.skills, 'builtin', skillMap)
    this.loadSkillsFromDir(paths.userSkills, 'user', skillMap)
    this.applySettings(skillMap)

    this.baseCache = skillMap
    this.cacheVersion = version
    this.lastLoadTime = Date.now()

    const skills = Array.from(skillMap.values())
    logger.debug({ count: skills.length, version }, 'Skills loaded')
    return skills
  }

  private clearCache(): void {
    this.baseCache.clear()
    this.cacheVersion = 0
    this.lastLoadTime = 0
  }

  private applySettings(skillMap: Map<string, Skill>): void {
    const settings = getSkillSettings()
    for (const [name, skill] of skillMap) {
      const setting = settings[name]
      skill.enabled = setting ? setting.enabled : true
      skill.usable = skill.eligible && skill.enabled
    }
  }

  private toPiSkill(skill: Skill): PiAgentSkill {
    return {
      name: skill.name,
      description: skill.frontmatter.description,
      filePath: skill.path,
      baseDir: dirname(skill.path),
      source: skill.source,
      disableModelInvocation: false,
    }
  }

  /**
   * Load skills from a given directory.
   * Looks for SKILL.md in each subdirectory.
   */
  private loadSkillsFromDir(dir: string, source: Skill['source'], skillMap: Map<string, Skill>): void {
    const logger = getLogger()

    if (!existsSync(dir)) {
      logger.debug({ dir, source }, 'Skills directory does not exist, skipping')
      return
    }

    let dirEntries: string[]
    try {
      dirEntries = readdirSync(dir)
    } catch {
      logger.debug({ dir }, 'Unable to read skills directory')
      return
    }

    for (const entryName of dirEntries) {
      const skillDir = resolve(dir, entryName)
      try {
        if (!statSync(skillDir).isDirectory()) continue
      } catch {
        continue
      }
      const skillFile = resolve(skillDir, 'SKILL.md')

      if (!existsSync(skillFile)) continue

      try {
        const raw = readFileSync(skillFile, 'utf-8')
        const { frontmatter, content } = parseFrontmatter(raw)
        const { eligible, errors, detail } = checkEligibility(frontmatter)

        let registryMeta: SkillRegistryMeta | undefined
        const registryFile = resolve(skillDir, '.registry.json')
        if (existsSync(registryFile)) {
          try {
            registryMeta = JSON.parse(readFileSync(registryFile, 'utf-8'))
          } catch {
            // Ignore parse failures
          }
        }

        skillMap.set(frontmatter.name, {
          name: frontmatter.name,
          source,
          frontmatter,
          content,
          path: skillFile,
          eligible,
          eligibilityErrors: errors,
          eligibilityDetail: detail,
          loadedAt: Date.now(),
          enabled: true,
          usable: eligible,
          registryMeta,
        })

        logger.debug({ name: frontmatter.name, source, eligible }, 'Skill loaded')
      } catch (err) {
        logger.warn(
          { skillDir, error: err instanceof Error ? err.message : String(err) },
          'Failed to load skill',
        )
      }
    }
  }
}
