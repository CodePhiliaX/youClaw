import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
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
   * Filter loaded skills based on agent.yaml skills field.
   * Returns all skills if agent does not specify a skills field.
   */
  loadSkillsForAgent(agentConfig: AgentConfig): Skill[] {
    const allSkills = this.loadAllSkills()

    // If agent does not specify skills, return all skills
    if (!agentConfig.skills || agentConfig.skills.length === 0) {
      return allSkills
    }

    // Return only the skills specified by the agent
    return allSkills.filter((skill) => agentConfig.skills!.includes(skill.name))
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

    // available: all skills accessible to this agent
    const available = allSkills

    // enabled: skills listed in agent.yaml skills field
    const enabled = agentConfig.skills && agentConfig.skills.length > 0
      ? allSkills.filter((s) => agentConfig.skills!.includes(s.name))
      : allSkills

    // eligible: skills that passed eligibility checks
    const eligible = enabled.filter((s) => s.eligible)

    return { available, enabled, eligible }
  }

  /**
   * Clear cache and reload all skills.
   */
  refresh(): Skill[] {
    this.cache.clear()
    this.lastLoadTime = 0
    return this.loadAllSkills(true)
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

    if (!existsSync(dir)) return

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
