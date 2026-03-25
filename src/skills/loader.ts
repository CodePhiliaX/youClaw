import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { formatSkillsForPrompt, type Skill as PiAgentSkill } from '@mariozechner/pi-coding-agent'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { checkEligibility } from './eligibility.ts'
import type { Skill, SkillsConfig, AgentSkillsView, SkillRegistryMeta } from './types.ts'
import { DEFAULT_SKILLS_CONFIG } from './types.ts'
import type { AgentConfig } from '../agent/types.ts'
import { getSkillSettings, setSkillEnabled as dbSetSkillEnabled } from '../db/index.ts'

export class SkillsLoader {
  private cache: Map<string, Skill> = new Map()
  private lastLoadTime: number = 0
  private config: SkillsConfig

  constructor(config?: Partial<SkillsConfig>) {
    this.config = { ...DEFAULT_SKILLS_CONFIG, ...config }
  }

  /**
   * Load all available skills with three-tier priority override (higher priority overrides lower for same name).
   * 1. Agent workspace: agents/<id>/skills/
   * 2. Project-level: skills/
   * 3. User-level: ~/.youclaw/skills/
   *
   * Supports caching; pass forceReload=true to force reload.
   */
  loadAllSkills(forceReload?: boolean): Skill[] {
    // Return cache if available and not forcing reload
    if (!forceReload && this.cache.size > 0) {
      return Array.from(this.cache.values())
    }

    const logger = getLogger()
    const paths = getPaths()
    const skillMap = new Map<string, Skill>()

    // 3. User-level (lowest priority, loaded first)
    const userSkillsDir = resolve(homedir(), '.youclaw', 'skills')
    this.loadSkillsFromDir(userSkillsDir, 'user', skillMap)

    // 2. Project-level (builtin)
    const projectSkillsDir = paths.skills
    logger.info({ projectSkillsDir, exists: existsSync(projectSkillsDir) }, 'Builtin skills path resolved')
    this.loadSkillsFromDir(projectSkillsDir, 'builtin', skillMap)

    // 1. Agent workspace-level (highest priority, loaded last to override)
    const agentsDir = paths.agents
    if (existsSync(agentsDir)) {
      const agentEntries = readdirSync(agentsDir)
      for (const agentName of agentEntries) {
        const agentDir = resolve(agentsDir, agentName)
        try {
          if (!statSync(agentDir).isDirectory()) continue
        } catch {
          continue
        }
        const agentSkillsDir = resolve(agentDir, 'skills')
        this.loadSkillsFromDir(agentSkillsDir, 'workspace', skillMap)
      }
    }

    // Read user enable/disable settings and merge into each skill
    const settings = getSkillSettings()
    for (const [name, skill] of skillMap) {
      const setting = settings[name]
      skill.enabled = setting ? setting.enabled : true
      skill.usable = skill.eligible && skill.enabled
    }

    // Update cache
    this.cache = skillMap
    this.lastLoadTime = Date.now()

    const skills = Array.from(skillMap.values())
    logger.debug({ count: skills.length }, 'Skills loaded')
    return skills
  }

  /**
   * Normalize agent skill bindings to local skill names.
   * Wildcard always wins; registry slugs are converted to installed local names when possible.
   */
  normalizeAgentSkillNames(skills?: string[]): { skills: string[] | undefined; changed: boolean } {
    if (!skills || skills.length === 0) {
      return { skills, changed: false }
    }

    if (skills.includes('*')) {
      return { skills: ['*'], changed: skills.length !== 1 || skills[0] !== '*' }
    }

    const allSkills = this.loadAllSkills()
    const knownNames = new Set(allSkills.map((skill) => skill.name))
    const namesBySlug = new Map<string, string>()
    for (const skill of allSkills) {
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
    const allSkills = this.loadAllSkills()
    const normalized = this.normalizeAgentSkillNames(agentConfig.skills).skills
    // "*" wildcard = all skills
    if (normalized?.includes('*')) {
      return allSkills
    }
    // undefined or empty = no skills
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
    const allSkills = this.loadAllSkills()
    const normalized = this.normalizeAgentSkillNames(agentConfig.skills).skills
    const available = allSkills
    const isWildcard = normalized?.includes('*')
    const enabled = isWildcard
      ? allSkills
      : normalized && normalized.length > 0
        ? allSkills.filter((s) => normalized.includes(s.name))
        : []
    const eligible = enabled.filter((s) => s.eligible)
    return { available, enabled, eligible }
  }

  buildPromptSnapshot(agentConfig: AgentConfig, requestedSkills?: string[]): {
    prompt: string
    skills: Skill[]
  } {
    const requested = requestedSkills
      ? new Set(requestedSkills.map((name) => name.trim()).filter(Boolean))
      : null
    const enabledSkills = this.loadSkillsForAgent(agentConfig)
      .filter((skill) => skill.usable)
      .filter((skill) => !requested || requested.has(skill.name))
    const limited = this.applyPromptLimits(enabledSkills)
    const prompt = formatSkillsForPrompt(limited.map((skill) => this.toPiSkill(skill)))
    return { prompt, skills: limited }
  }

  /**
   * Clear cache and reload all skills.
   */
  refresh(): Skill[] {
    this.cache.clear()
    this.lastLoadTime = 0
    return this.loadAllSkills(true)
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
   * Get cache statistics.
   */
  getCacheStats(): { skillCount: number; lastLoadTime: number; cached: boolean } {
    return {
      skillCount: this.cache.size,
      lastLoadTime: this.lastLoadTime,
      cached: this.cache.size > 0,
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

    // Group by priority
    const critical: Skill[] = []
    const normal: Skill[] = []
    const low: Skill[] = []

    for (const skill of skills) {
      const priority = skill.frontmatter.priority ?? 'normal'
      if (priority === 'critical') critical.push(skill)
      else if (priority === 'low') low.push(skill)
      else normal.push(skill)
    }

    // Critical: only truncate individual content, exempt from count and total limits
    const truncate = (skill: Skill): Skill => {
      if (skill.content.length <= maxSingleSkillChars) return skill
      return {
        ...skill,
        content: skill.content.slice(0, maxSingleSkillChars) + '\n...[content truncated]',
      }
    }

    const limitedCritical = critical.map(truncate)

    // Calculate quota used by critical skills
    const criticalCount = limitedCritical.length
    const criticalChars = limitedCritical.reduce((sum, s) => sum + s.content.length, 0)

    // Normal + Low: merge and apply limits sequentially (minus critical usage)
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

        // Read .registry.json metadata (if present)
        let registryMeta: SkillRegistryMeta | undefined
        const registryFile = resolve(skillDir, '.registry.json')
        if (existsSync(registryFile)) {
          try {
            registryMeta = JSON.parse(readFileSync(registryFile, 'utf-8'))
          } catch {
            // Ignore parse failures
          }
        }

        const skill: Skill = {
          name: frontmatter.name,
          source,
          frontmatter,
          content,
          path: skillFile,
          eligible,
          eligibilityErrors: errors,
          eligibilityDetail: detail,
          loadedAt: Date.now(),
          enabled: true,  // Default enabled, overridden by settings later
          usable: eligible,
          registryMeta,
        }

        // Higher priority overrides lower priority
        skillMap.set(skill.name, skill)

        logger.debug({ name: skill.name, source, eligible }, 'Skill loaded')
      } catch (err) {
        logger.warn(
          { skillDir, error: err instanceof Error ? err.message : String(err) },
          'Failed to load skill',
        )
      }
    }
  }
}
