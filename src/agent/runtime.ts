import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSession, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentCompiler } from './compiler.ts'
import type { HooksManager } from './hooks.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

// 解析 claude-agent-sdk cli.js 路径
// - Tauri 打包模式：从 RESOURCES_DIR 读取
// - 开发模式：通过 require.resolve 定位 node_modules
function resolveCliPath(): string {
  // Tauri 打包模式：cli.js 在 resources 目录中
  const resourcesDir = process.env.RESOURCES_DIR
  if (resourcesDir) {
    const resourceCliPath = resolve(resourcesDir, '_up_/node_modules/@anthropic-ai/claude-agent-sdk/cli.js')
    if (existsSync(resourceCliPath)) {
      return resourceCliPath
    }
  }

  // 开发模式：通过 require.resolve 定位
  try {
    const require = createRequire(import.meta.url)
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
    return resolve(dirname(sdkEntry), 'cli.js')
  } catch {
    // fallback: 相对于项目根目录
    return resolve(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js')
  }
}

export class AgentRuntime {
  private config: AgentConfig
  private eventBus: EventBus
  private promptBuilder: PromptBuilder
  private compiler: AgentCompiler | null
  private hooksManager: HooksManager | null

  constructor(
    config: AgentConfig,
    eventBus: EventBus,
    promptBuilder: PromptBuilder,
    compiler?: AgentCompiler,
    hooksManager?: HooksManager,
  ) {
    this.config = config
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
    this.compiler = compiler ?? null
    this.hooksManager = hooksManager ?? null
  }

  /**
   * 处理用户消息，返回 agent 回复
   */
  async process(params: ProcessParams): Promise<string> {
    const { chatId, prompt, agentId } = params
    const logger = getLogger()
    const env = getEnv()

    // 通知开始处理
    this.emitProcessing(agentId, chatId, true)

    // on_session_start hook
    if (this.hooksManager) {
      await this.hooksManager.execute(agentId, 'on_session_start', {
        agentId,
        chatId,
        phase: 'on_session_start',
        payload: { chatId },
      })
    }

    // 查找已有 session
    const existingSessionId = getSession(agentId, chatId)
    logger.info({
      agentId, chatId,
      hasSession: !!existingSessionId,
      promptPreview: prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt,
      category: 'agent',
    }, '开始处理消息')

    const startTime = Date.now()
    try {
      // pre_process hook
      let finalPrompt = prompt
      if (this.hooksManager) {
        const preCtx = await this.hooksManager.execute(agentId, 'pre_process', {
          agentId,
          chatId,
          phase: 'pre_process',
          payload: { prompt, chatId },
        })
        if (preCtx.abort) {
          return preCtx.abortReason ?? '消息被 hook 拦截'
        }
        if (preCtx.modifiedPayload?.prompt) {
          finalPrompt = preCtx.modifiedPayload.prompt as string
        }
      }

      const { fullText, sessionId } = await this.executeQuery(
        finalPrompt,
        agentId,
        chatId,
        existingSessionId,
        env.AGENT_MODEL,
        params.requestedSkills,
        params.browserProfileId,
        params.attachments,
      )

      // 保存 session
      if (sessionId) {
        saveSession(agentId, chatId, sessionId)
      }

      // post_process hook
      let finalText = fullText
      if (this.hooksManager) {
        const postCtx = await this.hooksManager.execute(agentId, 'post_process', {
          agentId,
          chatId,
          phase: 'post_process',
          payload: { fullText, chatId },
        })
        if (postCtx.modifiedPayload?.fullText) {
          finalText = postCtx.modifiedPayload.fullText as string
        }
      }

      // 广播完成事件
      this.eventBus.emit({
        type: 'complete',
        agentId,
        chatId,
        fullText: finalText,
        sessionId,
      })

      const durationMs = Date.now() - startTime
      logger.info({ agentId, chatId, sessionId, responseLength: finalText.length, durationMs, category: 'agent' }, '消息处理完成')

      // on_session_end hook
      if (this.hooksManager) {
        await this.hooksManager.execute(agentId, 'on_session_end', {
          agentId,
          chatId,
          phase: 'on_session_end',
          payload: { sessionId, fullText: finalText },
        })
      }

      return finalText
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error({ agentId, chatId, error: errorMsg, durationMs: Date.now() - startTime, category: 'agent' }, '消息处理失败')

      // on_error hook
      if (this.hooksManager) {
        await this.hooksManager.execute(agentId, 'on_error', {
          agentId,
          chatId,
          phase: 'on_error',
          payload: { error: errorMsg },
        })
      }

      this.eventBus.emit({
        type: 'error',
        agentId,
        chatId,
        error: errorMsg,
      })

      return `Error: ${errorMsg}`
    } finally {
      this.emitProcessing(agentId, chatId, false)
    }
  }

  /**
   * 执行 SDK query 并流式处理消息
   */
  private async executeQuery(
    prompt: string,
    agentId: string,
    chatId: string,
    existingSessionId: string | null,
    model: string,
    requestedSkills?: string[],
    browserProfileId?: string,
    attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>,
  ): Promise<{ fullText: string; sessionId: string }> {
    const logger = getLogger()
    const abortController = new AbortController()
    let fullText = ''
    let sessionId = existingSessionId ?? ''

    // 实时构建系统提示词
    const systemPrompt = this.promptBuilder.build(
      this.config.workspaceDir,
      this.config,
      { agentId, chatId, requestedSkills, browserProfileId },
    )

    // 构建 query 选项
    const cwd = this.config.workspaceDir
    const mcpServerNames = this.config.mcpServers ? Object.keys(this.config.mcpServers) : []

    logger.info({
      agentId, chatId,
      systemPromptLength: systemPrompt.length,
      model,
      isResume: !!existingSessionId,
      mcpServers: mcpServerNames.length > 0 ? mcpServerNames : undefined,
      subAgents: this.config.agents ? Object.keys(this.config.agents).length : 0,
      maxTurns: this.config.maxTurns,
      category: 'agent',
    }, 'SDK query 启动')

    const queryOptions: Record<string, unknown> = {
      model,
      cwd,
      systemPrompt,
      abortController,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: resolveCliPath(),
      ...(existingSessionId ? { resume: existingSessionId } : {}),
    }

    // 子 Agent 配置（通过 AgentCompiler 编译 ref 引用）
    if (this.config.agents) {
      if (this.compiler) {
        queryOptions.agents = this.compiler.resolve(this.config.agents, agentId)
      } else {
        queryOptions.agents = this.config.agents
      }
    }

    // MCP 服务器（使用公共函数解析环境变量）
    if (this.config.mcpServers) {
      queryOptions.mcpServers = resolveMcpServers(this.config.mcpServers)
    }

    // 工具控制
    if (this.config.allowedTools) {
      queryOptions.allowedTools = this.config.allowedTools
    }
    if (this.config.disallowedTools) {
      queryOptions.disallowedTools = this.config.disallowedTools
    }

    // 其他 SDK 能力
    if (this.config.maxTurns) {
      queryOptions.maxTurns = this.config.maxTurns
    }

    const queryStartTime = Date.now()

    let q
    if (attachments && attachments.length > 0) {
      // 构建多模态 content blocks
      const content: Array<Record<string, unknown>> = [
        { type: 'text', text: prompt },
      ]
      for (const a of attachments) {
        if (a.mediaType.startsWith('image/')) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: a.mediaType, data: a.data },
          })
        } else {
          content.push({
            type: 'document',
            source: { type: 'base64', media_type: a.mediaType, data: a.data },
          })
        }
      }

      const userMessage = {
        type: 'user' as const,
        message: { role: 'user' as const, content },
        parent_tool_use_id: null,
        session_id: existingSessionId || '',
      }

      async function* singleMessage<T>(msg: T) { yield msg }

      q = query({
        prompt: singleMessage(userMessage) as Parameters<typeof query>[0]['prompt'],
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })
    } else {
      q = query({
        prompt,
        options: queryOptions as Parameters<typeof query>[0]['options'],
      })
    }

    // 流式处理 SDK 消息
    let firstResponseLogged = false
    let turnCount = 0
    for await (const message of q) {
      // 记录首次响应延迟（TTFT）
      if (!firstResponseLogged && message.type === 'assistant') {
        const ttftMs = Date.now() - queryStartTime
        logger.info({ agentId, chatId, ttftMs, category: 'agent' }, 'SDK 首次响应')
        firstResponseLogged = true
      }
      if (message.type === 'assistant') {
        turnCount++
      }
      await this.handleMessage(message, agentId, chatId, (text) => {
        fullText += text
      }, (sid) => {
        sessionId = sid
      })
    }

    logger.info({
      agentId, chatId,
      totalTurns: turnCount,
      totalDurationMs: Date.now() - queryStartTime,
      category: 'agent',
    }, 'SDK query 结束')

    return { fullText, sessionId }
  }

  /**
   * 处理 SDK 消息
   */
  private async handleMessage(
    message: SDKMessage,
    agentId: string,
    chatId: string,
    appendText: (text: string) => void,
    setSessionId: (sid: string) => void,
  ): Promise<void> {
    switch (message.type) {
      case 'assistant': {
        // 提取 session_id
        if (message.session_id) {
          setSessionId(message.session_id)
        }

        // 从 assistant message 中提取文本和工具使用
        for (const block of message.message.content) {
          if (block.type === 'text') {
            appendText(block.text)
            this.emitStream(agentId, chatId, block.text)
          } else if (block.type === 'tool_use') {
            // pre_tool_use hook
            if (this.hooksManager) {
              const preCtx = await this.hooksManager.execute(agentId, 'pre_tool_use', {
                agentId,
                chatId,
                phase: 'pre_tool_use',
                payload: { tool: block.name, input: block.input },
              })
              if (preCtx.abort) {
                this.emitStream(agentId, chatId, `\n[工具 ${block.name} 被 hook 拦截: ${preCtx.abortReason ?? '未知原因'}]\n`)
                continue
              }
            }
            const logger = getLogger()
            logger.info({
              agentId, chatId,
              tool: block.name,
              input: JSON.stringify(block.input).slice(0, 500),
              category: 'tool_use',
            }, `工具调用: ${block.name}`)
            this.emitToolUse(agentId, chatId, block.name, block.input)
          }
        }
        break
      }

      case 'result': {
        if (message.session_id) {
          setSessionId(message.session_id)
        }
        break
      }

      // 子 Agent 系统消息处理
      case 'system': {
        this.handleSystemMessage(message, agentId, chatId)
        break
      }
    }
  }

  /**
   * 处理 SDK system 类型消息（子 Agent 事件）
   */
  private handleSystemMessage(
    message: SDKMessage & { type: 'system' },
    agentId: string,
    chatId: string,
  ): void {
    const msg = message as Record<string, unknown>
    const subtype = msg.subtype as string | undefined

    switch (subtype) {
      case 'task_started': {
        const taskId = String(msg.taskId ?? '')
        const description = String(msg.description ?? '')
        this.eventBus.emit({
          type: 'subagent_started',
          agentId,
          chatId,
          taskId,
          description,
        })
        break
      }
      case 'task_progress': {
        const taskId = String(msg.taskId ?? '')
        const summary = msg.summary ? String(msg.summary) : undefined
        this.eventBus.emit({
          type: 'subagent_progress',
          agentId,
          chatId,
          taskId,
          summary,
        })
        break
      }
      case 'task_notification': {
        const taskId = String(msg.taskId ?? '')
        const status = String(msg.status ?? 'completed')
        const summary = String(msg.summary ?? '')
        this.eventBus.emit({
          type: 'subagent_completed',
          agentId,
          chatId,
          taskId,
          status,
          summary,
        })
        break
      }
    }
  }

  // --- Emit 辅助方法 ---

  private emitProcessing(agentId: string, chatId: string, isProcessing: boolean): void {
    this.eventBus.emit({ type: 'processing', agentId, chatId, isProcessing })
  }

  private emitStream(agentId: string, chatId: string, text: string): void {
    this.eventBus.emit({ type: 'stream', agentId, chatId, text })
  }

  private emitToolUse(agentId: string, chatId: string, tool: string, input: unknown): void {
    this.eventBus.emit({
      type: 'tool_use',
      agentId,
      chatId,
      tool,
      input: JSON.stringify(input).slice(0, 200),
    })
  }
}
