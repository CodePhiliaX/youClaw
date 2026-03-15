import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSession, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import { ErrorCode } from '../events/types.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentCompiler } from './compiler.ts'
import type { HooksManager } from './hooks.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import { getActiveModelConfig } from '../settings/manager.ts'
import { getAuthToken } from '../routes/auth.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

// Resolve claude-agent-sdk cli.js path
// - Tauri bundled mode: read from RESOURCES_DIR
// - Dev mode: locate via require.resolve in node_modules
function resolveCliPath(): string {
  // Tauri bundled mode: cli.js is in the resources directory
  const resourcesDir = process.env.RESOURCES_DIR
  if (resourcesDir) {
    const resourceCliPath = resolve(resourcesDir, '_up_/node_modules/@anthropic-ai/claude-agent-sdk/cli.js')
    if (existsSync(resourceCliPath)) {
      return resourceCliPath
    }
  }

  // Dev mode: locate via require.resolve
  try {
    const require = createRequire(import.meta.url)
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
    return resolve(dirname(sdkEntry), 'cli.js')
  } catch {
    // fallback: relative to project root
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
   * Process a user message and return the agent's reply
   */
  async process(params: ProcessParams): Promise<string> {
    const { chatId, prompt, agentId } = params
    const logger = getLogger()
    const env = getEnv()

    // Notify processing started
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

    // Look up existing session
    const existingSessionId = getSession(agentId, chatId)
    logger.info({
      agentId, chatId,
      hasSession: !!existingSessionId,
      promptPreview: prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt,
      category: 'agent',
    }, 'Processing message')

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
          return preCtx.abortReason ?? 'Message blocked by hook'
        }
        if (preCtx.modifiedPayload?.prompt) {
          finalPrompt = preCtx.modifiedPayload.prompt as string
        }
      }

      // Read model config from Settings API first, fall back to env vars
      const modelConfig = getActiveModelConfig()
      let model = env.AGENT_MODEL
      if (modelConfig) {
        model = modelConfig.modelId
        // Set env vars for the SDK
        process.env.ANTHROPIC_API_KEY = modelConfig.apiKey
        if (modelConfig.baseUrl) {
          process.env.ANTHROPIC_BASE_URL = modelConfig.baseUrl
        }
        logger.info({ provider: modelConfig.provider, model, baseUrl: modelConfig.baseUrl || '(default)' }, 'Model config loaded')
      } else {
        // 切回内置模型时，恢复环境变量原始值，避免 SDK 继续使用旧的自定义模型配置
        if (env.ANTHROPIC_API_KEY) {
          process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
        }
        // Restore ANTHROPIC_BASE_URL from .env if present, otherwise delete
        if (env.ANTHROPIC_BASE_URL) {
          process.env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL
        } else {
          delete process.env.ANTHROPIC_BASE_URL
        }
        logger.info({ model, baseUrl: env.ANTHROPIC_BASE_URL || '(default)' }, 'Using env var model config')
      }

      // 将用户 auth token 注入到 SDK 请求 header 中
      const authToken = getAuthToken()
      if (authToken) {
        process.env.ANTHROPIC_CUSTOM_HEADERS = `rdxtoken: ${authToken}`
      }

      const { fullText, sessionId } = await this.executeQuery(
        finalPrompt,
        agentId,
        chatId,
        existingSessionId,
        model,
        params.requestedSkills,
        params.browserProfileId,
        params.attachments,
      )

      // Save session
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

      // Broadcast completion event
      this.eventBus.emit({
        type: 'complete',
        agentId,
        chatId,
        fullText: finalText,
        sessionId,
      })

      const durationMs = Date.now() - startTime
      logger.info({ agentId, chatId, sessionId, responseLength: finalText.length, durationMs, category: 'agent' }, 'Message processing completed')

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
      const rawError = err instanceof Error ? err.message : String(err)
      logger.error({ agentId, chatId, error: rawError, durationMs: Date.now() - startTime, category: 'agent' }, 'Message processing failed')

      // Convert SDK internal errors to user-friendly messages
      const { message: userError, errorCode } = this.humanizeError(rawError)
      logger.info({ agentId, chatId, errorCode, userError, category: 'agent' }, '错误码识别结果')

      // on_error hook
      if (this.hooksManager) {
        await this.hooksManager.execute(agentId, 'on_error', {
          agentId,
          chatId,
          phase: 'on_error',
          payload: { error: rawError },
        })
      }

      this.eventBus.emit({
        type: 'error',
        agentId,
        chatId,
        error: userError,
        errorCode,
      })

      return `Error: ${userError}`
    } finally {
      this.emitProcessing(agentId, chatId, false)
    }
  }

  /**
   * Execute SDK query and stream-process messages
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

    // Build system prompt on the fly
    const systemPrompt = this.promptBuilder.build(
      this.config.workspaceDir,
      this.config,
      { agentId, chatId, requestedSkills, browserProfileId },
    )

    // Build query options
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
    }, 'SDK query started')

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

    // Sub-agent config (compile ref references via AgentCompiler)
    if (this.config.agents) {
      if (this.compiler) {
        queryOptions.agents = this.compiler.resolve(this.config.agents, agentId)
      } else {
        queryOptions.agents = this.config.agents
      }
    }

    // MCP servers (resolve env vars via shared utility)
    if (this.config.mcpServers) {
      queryOptions.mcpServers = resolveMcpServers(this.config.mcpServers)
    }

    // Tool access control
    if (this.config.allowedTools) {
      queryOptions.allowedTools = this.config.allowedTools
    }
    if (this.config.disallowedTools) {
      queryOptions.disallowedTools = this.config.disallowedTools
    }

    // Other SDK capabilities
    if (this.config.maxTurns) {
      queryOptions.maxTurns = this.config.maxTurns
    }

    const queryStartTime = Date.now()

    let q
    if (attachments && attachments.length > 0) {
      // Build multimodal content blocks
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

    // Stream-process SDK messages
    let firstResponseLogged = false
    let turnCount = 0
    try {
      for await (const message of q) {
        // Log time-to-first-token (TTFT)
        if (!firstResponseLogged && message.type === 'assistant') {
          const ttftMs = Date.now() - queryStartTime
          logger.info({ agentId, chatId, ttftMs, category: 'agent' }, 'SDK first response')
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
    } catch (err) {
      // SDK 进程崩溃时，fullText 中可能包含上游 API 返回的实际错误信息
      // 将 fullText 附加到错误消息中，以便 humanizeError 能匹配到具体错误类型
      const errMsg = err instanceof Error ? err.message : String(err)
      if (fullText.trim()) {
        throw new Error(`${errMsg} | upstream_response: ${fullText.trim().slice(0, 500)}`)
      }
      throw err
    }

    logger.info({
      agentId, chatId,
      totalTurns: turnCount,
      totalDurationMs: Date.now() - queryStartTime,
      category: 'agent',
    }, 'SDK query finished')

    return { fullText, sessionId }
  }

  /**
   * Handle an SDK message
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
        // Extract session_id
        if (message.session_id) {
          setSessionId(message.session_id)
        }

        // Extract text and tool_use blocks from assistant message
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
                this.emitStream(agentId, chatId, `\n[Tool ${block.name} blocked by hook: ${preCtx.abortReason ?? 'unknown reason'}]\n`)
                continue
              }
            }
            const logger = getLogger()
            logger.info({
              agentId, chatId,
              tool: block.name,
              input: JSON.stringify(block.input).slice(0, 500),
              category: 'tool_use',
            }, `Tool call: ${block.name}`)
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

      // Sub-agent system message handling
      case 'system': {
        this.handleSystemMessage(message, agentId, chatId)
        break
      }
    }
  }

  /**
   * Handle SDK system messages (sub-agent events)
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

  /**
   * Convert SDK internal errors to user-readable messages with error codes.
   * Order matters: specific errors first, generic fallback (process exited) last.
   */
  private humanizeError(raw: string): { message: string; errorCode: ErrorCode } {
    // Insufficient credits (highest priority — triggers top-up dialog)
    if (/insufficient|credit|balance|quota|insufficient_credits/i.test(raw)) {
      return { message: 'Insufficient credits or API quota. Please check your account balance.', errorCode: ErrorCode.INSUFFICIENT_CREDITS }
    }
    // API authentication failure
    if (/unauthorized|authentication_error|invalid.*token|invalid.*key/i.test(raw)) {
      return { message: 'Model authentication failed. Please check your API Key in Settings → Models.', errorCode: ErrorCode.AUTH_FAILED }
    }
    // Rate limiting
    if (/rate.?limit|too many requests|429/i.test(raw)) {
      return { message: 'Request rate limited. Please try again later.', errorCode: ErrorCode.RATE_LIMITED }
    }
    // Network error
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw)) {
      return { message: 'Cannot reach the model API. Please check your network connection and Base URL.', errorCode: ErrorCode.NETWORK_ERROR }
    }
    // SDK process crash (fallback — last to avoid masking specific errors in upstream_response)
    if (/process exited with code/i.test(raw)) {
      return { message: 'Model connection failed. Please check your model configuration (API Key, Base URL) in Settings → Models.', errorCode: ErrorCode.MODEL_CONNECTION_FAILED }
    }
    return { message: raw, errorCode: ErrorCode.UNKNOWN }
  }

  // --- Emit helper methods ---

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
