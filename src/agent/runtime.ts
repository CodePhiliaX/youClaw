import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSession, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentCompiler } from './compiler.ts'
import type { HooksManager } from './hooks.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

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
    logger.info({ agentId, chatId, hasSession: !!existingSessionId }, '开始处理消息')

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

      logger.info({ agentId, chatId, responseLength: finalText.length }, '消息处理完成')

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
      logger.error({ agentId, chatId, error: errorMsg }, '消息处理失败')

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
  ): Promise<{ fullText: string; sessionId: string }> {
    const abortController = new AbortController()
    let fullText = ''
    let sessionId = existingSessionId ?? ''

    // 实时构建系统提示词
    const systemPrompt = this.promptBuilder.build(
      this.config.workspaceDir,
      this.config,
      { agentId, chatId, requestedSkills },
    )

    // 构建 query 选项
    const queryOptions: Record<string, unknown> = {
      model,
      cwd: this.config.workspaceDir,
      systemPrompt,
      abortController,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
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

    const q = query({
      prompt,
      options: queryOptions as Parameters<typeof query>[0]['options'],
    })

    // 流式处理 SDK 消息
    for await (const message of q) {
      await this.handleMessage(message, agentId, chatId, (text) => {
        fullText += text
      }, (sid) => {
        sessionId = sid
      })
    }

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
