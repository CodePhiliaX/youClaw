import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
import type { AgentConfig, AgentInstance } from './types.ts'
import {
  DEFAULT_AGENT_YAML, DEFAULT_SOUL_MD, DEFAULT_AGENT_MD,
  DEFAULT_USER_MD, DEFAULT_TOOLS_MD, DEFAULT_MEMORY_MD, GLOBAL_MEMORY_MD,
} from './templates.ts'

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map()
  private eventBus: EventBus
  private promptBuilder: PromptBuilder
  private hooksManager: HooksManager | null
  private agentRouter: AgentRouter | null
  private secretsManager: SecretsManager | null
  private skillsLoader: SkillsLoader | null
  private memoryManager: MemoryManager | null

  constructor(
    eventBus: EventBus,
    promptBuilder: PromptBuilder,
    hooksManager?: HooksManager,
    agentRouter?: AgentRouter,
    secretsManager?: SecretsManager,
    skillsLoader?: SkillsLoader,
    memoryManager?: MemoryManager,
  ) {
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
    this.hooksManager = hooksManager ?? null
    this.agentRouter = agentRouter ?? null
    this.secretsManager = secretsManager ?? null
    this.skillsLoader = skillsLoader ?? null
    this.memoryManager = memoryManager ?? null
  }

  /**
   * Ensure default agent and global memory directory exist
   * Uses agent.yaml as sentinel file; initializes from built-in templates if missing
   */
  ensureDefaultAgent(): void {
    const logger = getLogger()
    const paths = getPaths()
    const defaultDir = resolve(paths.agents, 'default')
    const globalDir = resolve(paths.agents, '_global')

    if (!existsSync(resolve(defaultDir, 'agent.yaml'))) {
      logger.info('Initializing default agent template...')
      mkdirSync(defaultDir, { recursive: true })
      mkdirSync(resolve(defaultDir, 'memory'), { recursive: true })
      mkdirSync(resolve(defaultDir, 'skills'), { recursive: true })
      mkdirSync(resolve(defaultDir, 'prompts'), { recursive: true })
      writeFileSync(resolve(defaultDir, 'agent.yaml'), DEFAULT_AGENT_YAML)
      writeFileSync(resolve(defaultDir, 'SOUL.md'), DEFAULT_SOUL_MD)
      writeFileSync(resolve(defaultDir, 'AGENT.md'), DEFAULT_AGENT_MD)
      writeFileSync(resolve(defaultDir, 'USER.md'), DEFAULT_USER_MD)
      writeFileSync(resolve(defaultDir, 'TOOLS.md'), DEFAULT_TOOLS_MD)
      writeFileSync(resolve(defaultDir, 'memory', 'MEMORY.md'), DEFAULT_MEMORY_MD)
    } else {
      // Sync AGENT.md template if it exists but doesn't contain placeholder syntax
      // This ensures template updates (e.g., IPC path placeholders) propagate to existing agents
      const agentMdPath = resolve(defaultDir, 'AGENT.md')
      if (existsSync(agentMdPath)) {
        try {
          const currentContent = readFileSync(agentMdPath, 'utf-8')
          if (!currentContent.includes('{{ipcTasksDir}}') || !currentContent.includes('Do NOT use the built-in CronCreate')) {
            writeFileSync(agentMdPath, DEFAULT_AGENT_MD)
            logger.info('Updated default agent AGENT.md with latest template')
          }
        } catch (err) {
          logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to sync AGENT.md template')
        }
      }

    }

    if (!existsSync(resolve(globalDir, 'memory', 'MEMORY.md'))) {
      mkdirSync(resolve(globalDir, 'memory'), { recursive: true })
      writeFileSync(resolve(globalDir, 'memory', 'MEMORY.md'), GLOBAL_MEMORY_MD)
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

        // Sync .claude/skills/ symlinks for SDK discovery
        if (this.skillsLoader) {
          try {
            this.skillsLoader.syncAgentClaudeSkills(config, agentDir)
          } catch (err) {
            logger.warn({ agentId: config.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to sync .claude/skills/')
          }
        }

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

  /**
   * Re-sync .claude/skills/ symlinks for all loaded agents.
   * Called after skills hot-reload so new/removed skills are reflected.
   */
  syncAllAgentSkills(): void {
    if (!this.skillsLoader) return
    const logger = getLogger()
    const paths = getPaths()
    for (const managed of this.agents.values()) {
      const agentDir = resolve(paths.agents, managed.config.id)
      try {
        this.skillsLoader.syncAgentClaudeSkills(managed.config, agentDir)
      } catch (err) {
        logger.warn({ agentId: managed.config.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to sync .claude/skills/ on reload')
      }
    }
  }
}
