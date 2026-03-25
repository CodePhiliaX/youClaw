import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, cpSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { inferChannelType } from '../channel/config-schema.ts'
import type { EventBus } from '../events/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import { AgentConfigSchema } from './schema.ts'
import { AgentRuntime } from './runtime.ts'
import { PromptBuilder } from './prompt-builder.ts'
import type { HooksManager } from './hooks.ts'
import type { AgentRouter } from './router.ts'
import type { SecretsManager } from './secrets.ts'
import type { SkillsLoader } from '../skills/loader.ts'
import type { BrowserManager } from '../browser/index.ts'
import type { AgentConfig, AgentInstance } from './types.ts'
import {
  DEFAULT_AGENT_YAML, GLOBAL_MEMORY_MD,
} from './templates.ts'
import { ensureAgentWorkspace } from './workspace.ts'

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map()
  private eventBus: EventBus
  private promptBuilder: PromptBuilder
  private hooksManager: HooksManager | null
  private agentRouter: AgentRouter | null
  private secretsManager: SecretsManager | null
  private skillsLoader: SkillsLoader | null
  private memoryManager: MemoryManager | null
  private browserManager: BrowserManager | null

  constructor(
    eventBus: EventBus,
    promptBuilder: PromptBuilder,
    hooksManager?: HooksManager,
    agentRouter?: AgentRouter,
    secretsManager?: SecretsManager,
    skillsLoader?: SkillsLoader,
    memoryManager?: MemoryManager,
    browserManager?: BrowserManager,
  ) {
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
    this.hooksManager = hooksManager ?? null
    this.agentRouter = agentRouter ?? null
    this.secretsManager = secretsManager ?? null
    this.skillsLoader = skillsLoader ?? null
    this.memoryManager = memoryManager ?? null
    this.browserManager = browserManager ?? null
  }

  /**
   * Ensure default agent and global memory directory exist
   * Uses agent.yaml as sentinel file; initializes from built-in templates if missing
   */
  ensureDefaultAgent(): void {
    const logger = getLogger()
    const paths = getPaths()
    this.migrateLegacyAgentWorkspaces()
    const defaultDir = resolve(paths.agents, 'default')
    const globalDir = resolve(paths.agents, '_global')

    if (!existsSync(resolve(defaultDir, 'agent.yaml'))) {
      logger.info('Initializing default agent template...')
      mkdirSync(defaultDir, { recursive: true })
      writeFileSync(resolve(defaultDir, 'agent.yaml'), DEFAULT_AGENT_YAML)
    }
    ensureAgentWorkspace(defaultDir, {
      ensureBootstrap: true,
      ensureSkillsDir: true,
      ensurePromptsDir: true,
    })

    if (!existsSync(resolve(globalDir, 'memory', 'MEMORY.md'))) {
      mkdirSync(resolve(globalDir, 'memory'), { recursive: true })
      writeFileSync(resolve(globalDir, 'memory', 'MEMORY.md'), GLOBAL_MEMORY_MD)
    }
  }

  private migrateLegacyAgentWorkspaces(): void {
    const logger = getLogger()
    const paths = getPaths()
    const candidates = [
      resolve(paths.data, 'agents'),
      resolve(paths.root, 'agents'),
    ]
      .filter((dir, index, all) => all.indexOf(dir) === index)
      .filter((dir) => dir !== paths.agents && existsSync(dir))

    if (candidates.length === 0) return

    mkdirSync(paths.agents, { recursive: true })
    const migrated: string[] = []

    for (const candidate of candidates) {
      let entries: string[]
      try {
        entries = readdirSync(candidate)
      } catch {
        continue
      }

      for (const entry of entries) {
        const sourceDir = resolve(candidate, entry)
        const targetDir = resolve(paths.agents, entry)

        try {
          if (!statSync(sourceDir).isDirectory()) continue
        } catch {
          continue
        }

        if (existsSync(targetDir)) continue

        const hasAgentConfig = existsSync(resolve(sourceDir, 'agent.yaml'))
        const isGlobalMemory = entry === '_global' && existsSync(resolve(sourceDir, 'memory', 'MEMORY.md'))
        if (!hasAgentConfig && !isGlobalMemory) continue

        try {
          cpSync(sourceDir, targetDir, { recursive: true, force: false })
          migrated.push(entry)
        } catch (err) {
          logger.warn({
            sourceDir,
            targetDir,
            error: err instanceof Error ? err.message : String(err),
          }, 'Failed to migrate legacy agent workspace')
        }
      }
    }

    if (migrated.length > 0) {
      logger.info({ agents: migrated, target: paths.agents }, 'Migrated legacy agent workspaces to .youclaw workspace')
    }
  }

  /**
   * Load all agents from the agents/ directory
   * Scans each subdirectory for agent.yaml, validates config with Zod, and creates AgentRuntime
   */
  async loadAgents(): Promise<void> {
    const logger = getLogger()
    const paths = getPaths()
    const agentsDir = paths.agents

    // Ensure default agent exists
    this.ensureDefaultAgent()

    if (!existsSync(agentsDir)) {
      logger.warn({ agentsDir }, 'Agents directory does not exist')
      return
    }

    const entries = readdirSync(agentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const agentDir = resolve(agentsDir, entry.name)
      const configPath = resolve(agentDir, 'agent.yaml')

      if (!existsSync(configPath)) {
        logger.debug({ agentDir }, 'Skipping directory without agent.yaml')
        continue
      }

      try {
        const rawYaml = readFileSync(configPath, 'utf-8')
        const parsed = parseYaml(rawYaml) as Record<string, unknown>

        // Validate config with Zod
        const result = AgentConfigSchema.safeParse({
          ...parsed,
          id: parsed.id ?? entry.name,
          name: parsed.name ?? entry.name,
        })

        if (!result.success) {
          logger.error({ agentDir, errors: result.error.issues }, 'agent.yaml config validation failed')
          continue
        }

        const config: AgentConfig = {
          ...result.data,
          workspaceDir: agentDir,
          hasExplicitModel: typeof parsed.model === 'string' && parsed.model.trim().length > 0,
        }

        if (this.skillsLoader) {
          const normalizedSkills = this.skillsLoader.normalizeAgentSkillNames(config.skills)
          if (normalizedSkills.changed) {
            config.skills = normalizedSkills.skills
            const nextYaml = {
              ...parsed,
              id: config.id,
              name: config.name,
              skills: normalizedSkills.skills,
            }
            writeFileSync(configPath, stringifyYaml(nextYaml))
            logger.info({ agentId: config.id, skills: normalizedSkills.skills }, 'Normalized agent skill bindings')
          }
        }

        // Backward compatibility: auto-migrate legacy telegram.chatIds to bindings
        if (config.telegram?.chatIds && !config.bindings) {
          config.bindings = [{
            channel: 'telegram',
            chatIds: config.telegram.chatIds,
            priority: 100,
          }]
        }

        // Load hooks
        if (this.hooksManager && config.hooks) {
          await this.hooksManager.loadHooks(config.id, agentDir, config.hooks)
        }

        // Register security policy as built-in hook
        if (this.hooksManager && config.security) {
          const { createSecurityHook } = await import('./security.ts')
          const securityHandler = createSecurityHook(config.security)
          this.hooksManager.registerBuiltinHook(config.id, 'pre_tool_use', securityHandler, -1000)
        }

        const runtime = new AgentRuntime(
          config,
          this.eventBus,
          this.promptBuilder,
          this.hooksManager ?? undefined,
          this.skillsLoader ?? undefined,
          this.memoryManager ?? undefined,
          this.browserManager ?? undefined,
          this.secretsManager ?? undefined,
        )

        this.agents.set(config.id, {
          config,
          workspaceDir: agentDir,
          runtime,
          state: {
            sessionId: null,
            isProcessing: false,
            lastProcessedAt: null,
            totalProcessed: 0,
            lastError: null,
            queueDepth: 0,
          },
        })

        logger.info({ agentId: config.id, name: config.name }, 'Agent loaded')
      } catch (err) {
        logger.error({ agentDir, error: err instanceof Error ? err.message : String(err) }, 'Failed to load agent')
      }
    }

    // Build route table
    if (this.agentRouter) {
      this.agentRouter.buildRouteTable(this.agents)
    }

    logger.info({ count: this.agents.size }, 'All agents loaded')
  }

  /**
   * Clear loaded agents and reload from disk
   */
  async reloadAgents(): Promise<void> {
    // Clean up hooks
    if (this.hooksManager) {
      for (const agentId of this.agents.keys()) {
        this.hooksManager.unloadHooks(agentId)
      }
    }
    this.agents.clear()
    await this.loadAgents()
  }

  /**
   * Resolve the agent for a given chatId
   */
  resolveAgent(chatId: string): AgentInstance | undefined {
    // Prefer AgentRouter if initialized
    if (this.agentRouter) {
      const channel = inferChannelType(chatId)
      return this.agentRouter.resolve({
        channel,
        chatId,
      })
    }

    // Fall back to legacy logic
    for (const managed of this.agents.values()) {
      const chatIds = managed.config.telegram?.chatIds
      if (chatIds && chatIds.includes(chatId)) {
        return managed
      }
    }
    return this.getDefaultAgent()
  }

  /**
   * Get all agent configs
   */
  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).map((m) => m.config)
  }

  /**
   * Get a single agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId)
  }

  /**
   * Get the default agent
   */
  getDefaultAgent(): AgentInstance | undefined {
    const defaultAgent = this.agents.get('default')
    if (defaultAgent) return defaultAgent
    const first = this.agents.values().next()
    return first.done ? undefined : first.value
  }

  /**
   * Get the AgentRouter (for API routing)
   */
  getRouter(): AgentRouter | null {
    return this.agentRouter
  }

  /**
   * Get the internal agents Map (for AgentRouter)
   */
  getAgentsMap(): Map<string, AgentInstance> {
    return this.agents
  }

}
