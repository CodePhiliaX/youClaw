import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSession, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

export class AgentRuntime {
  private config: AgentConfig
  private eventBus: EventBus
  private promptBuilder: PromptBuilder

  constructor(config: AgentConfig, eventBus: EventBus, promptBuilder: PromptBuilder) {
    this.config = config
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
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

    // 查找已有 session
    const existingSessionId = getSession(agentId, chatId)
    logger.info({ agentId, chatId, hasSession: !!existingSessionId }, '开始处理消息')

    try {
      const { fullText, sessionId } = await this.executeQuery(
        prompt,
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

      // 广播完成事件
      this.eventBus.emit({
        type: 'complete',
        agentId,
        chatId,
        fullText,
        sessionId,
      })

      logger.info({ agentId, chatId, responseLength: fullText.length }, '消息处理完成')
      return fullText
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error({ agentId, chatId, error: errorMsg }, '消息处理失败')

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

    // Phase 3: 子 Agent 配置
    if (this.config.agents) {
      queryOptions.agents = this.config.agents
    }

    // Phase 4: 工具控制
    if (this.config.allowedTools) {
      queryOptions.allowedTools = this.config.allowedTools
    }
    if (this.config.disallowedTools) {
      queryOptions.disallowedTools = this.config.disallowedTools
    }

    // Phase 4: 其他 SDK 能力
    if (this.config.maxTurns) {
      queryOptions.maxTurns = this.config.maxTurns
    }

    const q = query({
      prompt,
      options: queryOptions as Parameters<typeof query>[0]['options'],
    })

    // 流式处理 SDK 消息
    for await (const message of q) {
      this.handleMessage(message, agentId, chatId, (text) => {
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
  private handleMessage(
    message: SDKMessage,
    agentId: string,
    chatId: string,
    appendText: (text: string) => void,
    setSessionId: (sid: string) => void,
  ): void {
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

      // Phase 3: 子 Agent 系统消息处理
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
