import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { EventBus } from '../events/index.ts'
import { AgentConfigSchema } from './schema.ts'
import { AgentRuntime } from './runtime.ts'
import { PromptBuilder } from './prompt-builder.ts'
import type { AgentCompiler } from './compiler.ts'
import type { HooksManager } from './hooks.ts'
import type { AgentRouter } from './router.ts'
import type { SecretsManager } from './secrets.ts'
import type { AgentConfig, AgentInstance } from './types.ts'

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map()
  private eventBus: EventBus
  private promptBuilder: PromptBuilder
  private compiler: AgentCompiler | null
  private hooksManager: HooksManager | null
  private agentRouter: AgentRouter | null
  private secretsManager: SecretsManager | null

  constructor(
    eventBus: EventBus,
    promptBuilder: PromptBuilder,
    compiler?: AgentCompiler,
    hooksManager?: HooksManager,
    agentRouter?: AgentRouter,
    secretsManager?: SecretsManager,
  ) {
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
    this.compiler = compiler ?? null
    this.hooksManager = hooksManager ?? null
    this.agentRouter = agentRouter ?? null
    this.secretsManager = secretsManager ?? null
  }

  /**
   * 从 agents/ 目录加载所有 agent
   * 扫描每个子目录的 agent.yaml，使用 Zod 校验配置并创建 AgentRuntime
   */
  async loadAgents(): Promise<void> {
    const logger = getLogger()
    const paths = getPaths()
    const agentsDir = paths.agents

    if (!existsSync(agentsDir)) {
      logger.warn({ agentsDir }, 'agents 目录不存在')
      return
    }

    const entries = readdirSync(agentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const agentDir = resolve(agentsDir, entry.name)
      const configPath = resolve(agentDir, 'agent.yaml')

      if (!existsSync(configPath)) {
        logger.debug({ agentDir }, '跳过无 agent.yaml 的目录')
        continue
      }

      try {
        const rawYaml = readFileSync(configPath, 'utf-8')
        const parsed = parseYaml(rawYaml) as Record<string, unknown>

        // 使用 Zod 校验配置
        const result = AgentConfigSchema.safeParse({
          ...parsed,
          id: parsed.id ?? entry.name,
          name: parsed.name ?? entry.name,
        })

        if (!result.success) {
          logger.error({ agentDir, errors: result.error.issues }, 'agent.yaml 配置校验失败')
          continue
        }

        const config: AgentConfig = {
          ...result.data,
          workspaceDir: agentDir,
        }

        // 向后兼容：旧 telegram.chatIds 自动迁移为 bindings
        if (config.telegram?.chatIds && !config.bindings) {
          config.bindings = [{
            channel: 'telegram',
            chatIds: config.telegram.chatIds,
            priority: 100,
          }]
        }

        // 加载 hooks
        if (this.hooksManager && config.hooks) {
          await this.hooksManager.loadHooks(config.id, agentDir, config.hooks)
        }

        // 注册安全策略为内置 hook
        if (this.hooksManager && config.security) {
          const { createSecurityHook } = await import('./security.ts')
          const securityHandler = createSecurityHook(config.security)
          this.hooksManager.registerBuiltinHook(config.id, 'pre_tool_use', securityHandler, -1000)
        }

        const runtime = new AgentRuntime(
          config,
          this.eventBus,
          this.promptBuilder,
          this.compiler ?? undefined,
          this.hooksManager ?? undefined,
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

        logger.info({ agentId: config.id, name: config.name }, 'Agent 已加载')
      } catch (err) {
        logger.error({ agentDir, error: err instanceof Error ? err.message : String(err) }, '加载 agent 失败')
      }
    }

    // 构建路由表
    if (this.agentRouter) {
      this.agentRouter.buildRouteTable(this.agents)
    }

    logger.info({ count: this.agents.size }, '所有 agent 加载完成')
  }

  /**
   * 清空已加载的 agent 并重新从磁盘加载
   */
  async reloadAgents(): Promise<void> {
    // 清理 hooks
    if (this.hooksManager) {
      for (const agentId of this.agents.keys()) {
        this.hooksManager.unloadHooks(agentId)
      }
    }
    this.agents.clear()
    await this.loadAgents()
  }

  /**
   * 根据 chatId 找到对应的 agent
   */
  resolveAgent(chatId: string): AgentInstance | undefined {
    // 优先使用 AgentRouter（如果已初始化）
    if (this.agentRouter) {
      const channel = chatId.startsWith('tg:') ? 'telegram' : 'web'
      return this.agentRouter.resolve({
        channel,
        chatId,
      })
    }

    // 回退到旧逻辑
    for (const managed of this.agents.values()) {
      const chatIds = managed.config.telegram?.chatIds
      if (chatIds && chatIds.includes(chatId)) {
        return managed
      }
    }
    return this.getDefaultAgent()
  }

  /**
   * 获取所有 agent 配置列表
   */
  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values()).map((m) => m.config)
  }

  /**
   * 获取单个 agent
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 获取默认 agent
   */
  getDefaultAgent(): AgentInstance | undefined {
    const defaultAgent = this.agents.get('default')
    if (defaultAgent) return defaultAgent
    const first = this.agents.values().next()
    return first.done ? undefined : first.value
  }

  /**
   * 获取 AgentRouter（供 API 路由使用）
   */
  getRouter(): AgentRouter | null {
    return this.agentRouter
  }

  /**
   * 获取内部 agents Map（供 AgentRouter 使用）
   */
  getAgentsMap(): Map<string, AgentInstance> {
    return this.agents
  }
}
