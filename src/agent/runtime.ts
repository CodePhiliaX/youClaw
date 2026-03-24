import { createAgentSession, createCodingTools, SessionManager, AuthStorage } from '@mariozechner/pi-coding-agent'
import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getMessages, getSessionEntry, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import { ErrorCode } from '../events/types.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { HooksManager } from './hooks.ts'
import { createBuiltinImageTool } from './builtin-mcp.ts'
import { createMessageTool } from './message-mcp.ts'
import { buildParsedDocumentsPrompt, createDocumentTools, ingestDocumentAttachments } from './document-mcp.ts'
import { preprocessAttachments } from './document-converter.ts'
import { abortRegistry } from './abort-registry.ts'
import { getActiveModelConfig } from '../settings/manager.ts'
import { getAuthToken } from '../routes/auth.ts'
import { resolvePiModel } from './model-resolver.ts'
import type { SkillsLoader } from '../skills/loader.ts'
import type { MemoryManager } from '../memory/index.ts'
import { buildRecoveredConversationPrompt, resolveStoredSessionFile, type StoredSessionEntry } from './context-utils.ts'
import { createSkillTool } from './tools/skill-tool.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

const COMPACTION_MEMORY_INSTRUCTIONS = [
  'Focus on durable context for future turns.',
  'Preserve user preferences, decisions, open questions, file paths, and unfinished work.',
  'Call out concrete TODOs and unresolved risks.',
].join(' ')

type CompactionSummary = {
  summary: string
  trigger: 'manual' | 'auto'
  sessionId?: string
}

type AssistantSessionMessage = {
  role?: string
  stopReason?: string
  errorMessage?: string
  content?: Array<{ type?: string; text?: string }>
}

type RuntimeAttachment = { filename: string; mediaType: string; filePath?: string; data?: string; size?: number }

export class AgentRuntime {
  private config: AgentConfig
  private eventBus: EventBus
  private promptBuilder: PromptBuilder
  private hooksManager: HooksManager | null
  private skillsLoader: SkillsLoader | null
  private memoryManager: MemoryManager | null

  constructor(
    config: AgentConfig,
    eventBus: EventBus,
    promptBuilder: PromptBuilder,
    hooksManager?: HooksManager,
    skillsLoader?: SkillsLoader,
    memoryManager?: MemoryManager,
  ) {
    this.config = config
    this.eventBus = eventBus
    this.promptBuilder = promptBuilder
    this.hooksManager = hooksManager ?? null
    this.skillsLoader = skillsLoader ?? null
    this.memoryManager = memoryManager ?? null
  }

  /**
   * Process a user message and return the agent's reply
   */
  async process(params: ProcessParams): Promise<string> {
    const { chatId, prompt, agentId } = params
    const logger = getLogger()

    this.emitProcessing(agentId, chatId, true)

    if (this.hooksManager) {
      await this.hooksManager.execute(agentId, 'on_session_start', {
        agentId,
        chatId,
        phase: 'on_session_start',
        payload: { chatId },
      })
    }

    const existingSession = getSessionEntry(agentId, chatId)
    logger.info({
      agentId,
      chatId,
      hasSession: !!existingSession?.sessionId,
      promptPreview: prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt,
      category: 'agent',
    }, 'Processing message')

    const startTime = Date.now()
    try {
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

      const modelConfig = getActiveModelConfig()
      if (!modelConfig) {
        throw new Error('No model config available. Please configure a model in Settings.')
      }

      if (modelConfig.provider === 'builtin') {
        const authToken = getAuthToken()
        if (!authToken) {
          throw new Error('Not logged in: Please log in to use built-in models')
        }
      }

      logger.info({
        provider: modelConfig.provider,
        model: modelConfig.modelId,
        baseUrl: modelConfig.baseUrl || '(default)',
      }, 'Model config loaded')

      const { fullText, sessionId, sessionFile } = await this.executeQuery(
        finalPrompt,
        agentId,
        chatId,
        existingSession,
        modelConfig,
        params.requestedSkills,
        params.attachments,
      )

      if (sessionId) {
        saveSession(agentId, chatId, sessionId, sessionFile)
      }

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

      this.eventBus.emit({
        type: 'complete',
        agentId,
        chatId,
        fullText: finalText,
        sessionId,
      })

      const durationMs = Date.now() - startTime
      logger.info({ agentId, chatId, sessionId, responseLength: finalText.length, durationMs, category: 'agent' }, 'Message processing completed')

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

      const { message: userError, errorCode } = this.humanizeError(rawError)
      logger.info({ agentId, chatId, errorCode, userError, category: 'agent' }, 'Error code identification result')

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
   * Execute agent query via pi-mono in-process session
   */
  private async executeQuery(
    prompt: string,
    agentId: string,
    chatId: string,
    existingSession: StoredSessionEntry | null,
    modelConfig: { apiKey: string; baseUrl: string; modelId: string; provider: string },
    requestedSkills?: string[],
    attachments?: Array<{ filename: string; mediaType: string; filePath?: string; data?: string; size?: number }>,
  ): Promise<{ fullText: string; sessionId: string; sessionFile: string | null }> {
    const logger = getLogger()
    const env = getEnv()
    const abortController = new AbortController()
    abortRegistry.register(chatId, abortController)

    let fullText = ''

    const systemPrompt = this.promptBuilder.build(
      this.config.workspaceDir,
      this.config,
      { agentId, chatId, requestedSkills },
    )

    const cwd = this.config.workspaceDir
    const model = resolvePiModel(modelConfig)

    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(model.provider, modelConfig.apiKey)

    if (modelConfig.provider === 'builtin') {
      const authToken = getAuthToken()
      if (authToken) {
        model.headers = { ...model.headers, rdxtoken: authToken }
      }
    }

    const sessionsDir = resolve(env.DATA_DIR, 'sessions', agentId)
    mkdirSync(sessionsDir, { recursive: true })
    const existingSessionFile = resolveStoredSessionFile(sessionsDir, existingSession)

    const sessionManager = existingSessionFile && existsSync(existingSessionFile)
      ? SessionManager.open(existingSessionFile, sessionsDir)
      : SessionManager.create(cwd, sessionsDir)

    const tools = this.filterConfiguredTools(createCodingTools(cwd))
    const customTools = this.filterConfiguredTools(this.buildCustomTools(chatId))

    logger.info({
      agentId,
      chatId,
      systemPromptLength: systemPrompt.length,
      model: model.id,
      provider: model.provider,
      isResume: !!existingSessionFile,
      sessionFile: existingSessionFile ?? sessionManager.getSessionFile(),
      category: 'agent',
    }, 'Creating agent session')

    const queryStartTime = Date.now()
    try {
      const { session } = await createAgentSession({
        cwd,
        model,
        tools,
        customTools,
        authStorage,
        sessionManager,
      })

      session.agent.setSystemPrompt(systemPrompt)

      const compactionSummaries: CompactionSummary[] = []
      await this.prepareSessionForPrompt(session, agentId, chatId, model.id, compactionSummaries)

      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        this.handleSessionEvent(event, agentId, chatId, (text) => {
          fullText += text
        }, compactionSummaries)
      })

      const promptWithFallback = (!existingSessionFile || !existsSync(existingSessionFile))
        ? this.buildRecoveredPrompt(chatId, prompt)
        : prompt
      const fileAttachments = attachments
        ?.filter((attachment) => typeof attachment.filePath === 'string' && attachment.filePath.length > 0)
        .map((attachment) => ({
          filename: attachment.filename,
          mediaType: attachment.mediaType,
          filePath: attachment.filePath!,
        })) ?? []
      const { parsedDocuments, remainingAttachments } = await ingestDocumentAttachments(
        chatId,
        fileAttachments,
        (event) => this.emitDocumentStatus(agentId, chatId, event.documentId, event.filename, event.status, event.error),
      )
      const promptWithDocuments = parsedDocuments.length > 0
        ? `${promptWithFallback}\n\n${buildParsedDocumentsPrompt(parsedDocuments)}`.trim()
        : promptWithFallback
      const processedAttachments = remainingAttachments.length > 0
        ? await preprocessAttachments(remainingAttachments)
        : []
      const promptWithAttachments = this.appendAttachmentInstructions(promptWithDocuments, processedAttachments)
      const remainingAttachmentPaths = new Set(remainingAttachments.map((attachment) => attachment.filePath).filter(Boolean))
      const promptImages = this.collectPromptImages(attachments, remainingAttachmentPaths)

      abortController.signal.addEventListener('abort', () => {
        session.abort().catch(() => {})
      }, { once: true })

      try {
        try {
          if (promptImages.length > 0) {
            await session.prompt(promptWithAttachments, { images: promptImages })
          } else {
            await session.prompt(promptWithAttachments)
          }
        } catch (err) {
          if (abortController.signal.aborted) {
            logger.info({ agentId, chatId, category: 'agent' }, 'Agent session aborted by user, returning partial text')
            const finalSessionId = session.sessionManager.getSessionId()
            const finalSessionFile = session.sessionManager.getSessionFile() ?? null
            saveSession(agentId, chatId, finalSessionId, finalSessionFile)
            return { fullText, sessionId: finalSessionId, sessionFile: finalSessionFile }
          }
          throw err
        }

        const sessionError = getLatestAssistantError(session.sessionManager.getEntries())
        if (sessionError) {
          throw new Error(sessionError)
        }
      } finally {
        unsubscribe()
      }

      this.finalizeSession(agentId, chatId, session, model.id, compactionSummaries)

      const finalSessionId = session.sessionManager.getSessionId()
      const finalSessionFile = session.sessionManager.getSessionFile() ?? null

      const durationMs = Date.now() - queryStartTime
      logger.info({
        agentId,
        chatId,
        totalDurationMs: durationMs,
        finalSessionId,
        finalSessionFile,
        category: 'agent',
      }, 'Agent session finished')

      return { fullText, sessionId: finalSessionId, sessionFile: finalSessionFile }
    } finally {
      abortRegistry.unregister(chatId)
    }
  }

  /**
   * Handle a pi-mono session event and map to YouClaw EventBus events
   */
  private handleSessionEvent(
    event: AgentSessionEvent,
    agentId: string,
    chatId: string,
    appendText: (text: string) => void,
    compactionSummaries: CompactionSummary[],
  ): void {
    switch (event.type) {
      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent
        if (assistantEvent.type === 'text_delta') {
          appendText(assistantEvent.delta)
          this.emitStream(agentId, chatId, assistantEvent.delta)
        }
        break
      }

      case 'tool_execution_start': {
        const logger = getLogger()
        logger.info({
          agentId,
          chatId,
          tool: event.toolName,
          input: JSON.stringify(event.args).slice(0, 500),
          category: 'tool_use',
        }, `Tool call: ${event.toolName}`)

        if (this.hooksManager) {
          this.hooksManager.execute(agentId, 'pre_tool_use', {
            agentId,
            chatId,
            phase: 'pre_tool_use',
            payload: { tool: event.toolName, input: event.args },
          }).then((ctx) => {
            if (ctx.abort) {
              this.emitStream(agentId, chatId, `\n[Tool ${event.toolName} blocked by hook: ${ctx.abortReason ?? 'unknown reason'}]\n`)
            }
          }).catch(() => {
            // Hook errors should not affect main flow
          })
        }

        this.emitToolUse(agentId, chatId, event.toolName, event.args)
        break
      }

      case 'auto_compaction_end':
        if (event.result?.summary) {
          compactionSummaries.push({ summary: event.result.summary, trigger: 'auto' })
        }
        break

      case 'agent_end':
      case 'auto_compaction_start':
        break
    }
  }

  private buildRecoveredPrompt(chatId: string, prompt: string): string {
    const limit = this.config.memory?.historyFallbackMessages ?? 12
    if (limit <= 0) return prompt

    const messages = getMessages(chatId, limit + 4).reverse().map((message) => ({
      content: message.content ?? '',
      isBotMessage: message.is_bot_message === 1,
    }))

    return buildRecoveredConversationPrompt(messages, prompt, limit)
  }

  private shouldCompactSession(sessionFile: string | undefined | null): boolean {
    const maxSessionBytes = this.config.memory?.maxSessionBytes ?? 262144
    if (!sessionFile || maxSessionBytes <= 0 || !existsSync(sessionFile)) {
      return false
    }

    try {
      return statSync(sessionFile).size > maxSessionBytes
    } catch {
      return false
    }
  }

  private async prepareSessionForPrompt(
    session: AgentSession,
    agentId: string,
    chatId: string,
    modelId: string,
    compactionSummaries: CompactionSummary[],
  ): Promise<void> {
    if (!this.shouldCompactSession(session.sessionManager.getSessionFile())) {
      return
    }

    const logger = getLogger()
    try {
      const previousSessionFile = session.sessionManager.getSessionFile()
      const previousSessionId = session.sessionManager.getSessionId()
      const result = await session.compact(COMPACTION_MEMORY_INSTRUCTIONS)
      if (result.summary) {
        compactionSummaries.push({ summary: result.summary, trigger: 'manual', sessionId: previousSessionId })
      }
      session.sessionManager.newSession({ parentSession: previousSessionFile ?? undefined })
    } catch (err) {
      logger.warn({ agentId, chatId, error: err instanceof Error ? err.message : String(err) }, 'Failed to compact oversized session before prompt')
    }
  }

  private finalizeSession(
    agentId: string,
    chatId: string,
    session: AgentSession,
    modelId: string,
    compactionSummaries: CompactionSummary[],
  ): void {
    const previousSessionFile = session.sessionManager.getSessionFile()
    const sessionId = session.sessionManager.getSessionId()

    for (const item of compactionSummaries.splice(0)) {
      this.memoryManager?.saveSessionSummary(agentId, chatId, item.sessionId ?? sessionId, item.summary, {
        trigger: item.trigger,
        model: modelId,
      })
    }

    if (!this.shouldCompactSession(previousSessionFile)) {
      return
    }

    try {
      session.sessionManager.newSession({ parentSession: previousSessionFile ?? undefined })
    } catch (err) {
      getLogger().warn({ agentId, chatId, error: err instanceof Error ? err.message : String(err) }, 'Failed to roll over session after prompt')
    }
  }

  /**
   * Convert errors to user-readable messages with error codes
   */
  private humanizeError(raw: string): { message: string; errorCode: ErrorCode } {
    const normalizedRaw = normalizeAssistantErrorMessage(raw) ?? raw

    if (/request interrupted by user/i.test(raw) || /request was aborted/i.test(normalizedRaw)) {
      return { message: normalizedRaw, errorCode: ErrorCode.UNKNOWN }
    }
    if (/insufficient|credit|balance|quota|insufficient_credits/i.test(raw) || /insufficient|credit|balance|quota|insufficient_credits/i.test(normalizedRaw)) {
      return { message: 'Insufficient credits or API quota. Please check your account balance.', errorCode: ErrorCode.INSUFFICIENT_CREDITS }
    }
    if (/not logged in|please log in/i.test(raw) || /not logged in|please log in/i.test(normalizedRaw)) {
      return { message: 'Please log in to use built-in models.', errorCode: ErrorCode.AUTH_FAILED }
    }
    if (/unauthorized|authentication_error|invalid.*token|invalid.*key|\b401\b/i.test(raw) || /unauthorized|authentication_error|invalid.*token|invalid.*key|\b401\b/i.test(normalizedRaw)) {
      return { message: 'Model authentication failed. Please check your API Key in Settings → Models.', errorCode: ErrorCode.AUTH_FAILED }
    }
    if (/rate.?limit|too many requests|429/i.test(raw) || /rate.?limit|too many requests|429/i.test(normalizedRaw)) {
      return { message: 'Request rate limited. Please try again later.', errorCode: ErrorCode.RATE_LIMITED }
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(raw) || /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(normalizedRaw)) {
      return { message: 'Cannot reach the model API. Please check your network connection and Base URL.', errorCode: ErrorCode.NETWORK_ERROR }
    }
    if (/\b50[0-9]\b|server error|bad gateway|service unavailable/i.test(raw) || /\b50[0-9]\b|server error|bad gateway|service unavailable/i.test(normalizedRaw)) {
      return { message: 'The model API returned a server error. This is usually temporary — please retry.', errorCode: ErrorCode.MODEL_CONNECTION_FAILED }
    }
    return { message: normalizedRaw, errorCode: ErrorCode.UNKNOWN }
  }

  private appendAttachmentInstructions(
    prompt: string,
    attachments: Array<{ filename: string; mediaType: string; filePath: string }>,
  ): string {
    if (attachments.length === 0) {
      return prompt
    }

    const parts: string[] = []
    const imageFiles = attachments.filter((attachment) => attachment.mediaType.startsWith('image/'))
    const otherFiles = attachments.filter((attachment) => !attachment.mediaType.startsWith('image/'))

    if (imageFiles.length > 0) {
      const list = imageFiles
        .map((attachment) => `- ${attachment.filePath} (${attachment.mediaType}, ${attachment.filename})`)
        .join('\n')
      parts.push(`[Attached images]\n${list}\nImage files are attached at these local paths.`)
    }

    if (otherFiles.length > 0) {
      const list = otherFiles
        .map((attachment) => `- ${attachment.filePath} (${attachment.mediaType}, ${attachment.filename})`)
        .join('\n')
      parts.push(`[Attached files]\n${list}\nPlease read these files before answering.`)
    }

    if (parts.length === 0) {
      return prompt
    }

    return `${prompt}\n\n${parts.join('\n\n')}`.trim()
  }

  private buildCustomTools(chatId: string): ToolDefinition[] {
    const customTools: ToolDefinition[] = [
      createBuiltinImageTool(),
      createMessageTool(chatId),
      ...createDocumentTools(chatId),
    ]
    if (this.skillsLoader) {
      customTools.push(createSkillTool(this.skillsLoader))
    }
    return customTools
  }

  private filterConfiguredTools<T extends { name: string }>(tools: T[]): T[] {
    const allowedTools = this.config.allowedTools
      ? new Set(this.config.allowedTools.map((name) => this.normalizeToolName(name)))
      : null
    const disallowedTools = new Set((this.config.disallowedTools ?? []).map((name) => this.normalizeToolName(name)))

    if (allowedTools) {
      allowedTools.add(this.normalizeToolName('Skill'))
    }

    return tools.filter((tool) => {
      const normalized = this.normalizeToolName(tool.name)
      if (disallowedTools.has(normalized)) {
        return false
      }
      if (allowedTools && !allowedTools.has(normalized)) {
        return false
      }
      return true
    })
  }

  private normalizeToolName(name: string): string {
    return name.trim().toLowerCase()
  }

  private collectPromptImages(
    attachments: RuntimeAttachment[] | undefined,
    remainingAttachmentPaths: Set<string>,
  ): Array<{ type: 'image'; data: string; mimeType: string }> {
    if (!attachments || attachments.length === 0) {
      return []
    }

    return attachments
      .filter((attachment) => {
        if (!attachment.mediaType.startsWith('image/')) return false
        if (typeof attachment.data !== 'string' || attachment.data.length === 0) return false
        if (!attachment.filePath) return true
        return remainingAttachmentPaths.has(attachment.filePath)
      })
      .map((attachment) => ({
        type: 'image' as const,
        data: attachment.data!,
        mimeType: attachment.mediaType,
      }))
  }

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

  private emitDocumentStatus(
    agentId: string,
    chatId: string,
    documentId: string,
    filename: string,
    status: 'parsing' | 'parsed' | 'failed',
    error?: string,
  ): void {
    this.eventBus.emit({
      type: 'document_status',
      agentId,
      chatId,
      documentId,
      filename,
      status,
      error,
    })
  }
}

export function getBunRuntimeDir(): string | null {
  const runtimeDir = resolve(process.cwd(), 'src-tauri', 'resources', 'bun-runtime')
  return existsSync(runtimeDir) ? runtimeDir : null
}

export function ensureBunRuntime(): string | null {
  const runtimeDir = getBunRuntimeDir()
  if (!runtimeDir) return null

  const executable = resolve(runtimeDir, process.platform === 'win32' ? 'bun.exe' : 'bun')
  return existsSync(executable) ? executable : null
}

function getLatestAssistantMessage(entries: SessionEntry[]): AssistantSessionMessage | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry) continue
    if (entry.type !== 'message') continue

    const message = entry.message as AssistantSessionMessage
    if (message.role === 'assistant') {
      return message
    }
  }

  return null
}

function combineErrorParts(summary: string | null, detail: string | null): string | null {
  if (summary && detail && summary !== detail) {
    return `${summary}: ${detail}`
  }
  return detail ?? summary
}

function extractStructuredErrorMessage(value: Record<string, unknown>): string | null {
  const summary = typeof value.error === 'string'
    ? value.error.trim() || null
    : extractNestedErrorMessage(value.error)
  const detail = extractNestedErrorMessage(value.message ?? value.errorMessage ?? value.detail)

  return combineErrorParts(summary, detail)
}

function extractNestedErrorMessage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value !== 'object') return null

  return extractStructuredErrorMessage(value as Record<string, unknown>)
}

export function normalizeAssistantErrorMessage(raw: string | undefined, stopReason?: string): string | null {
  const trimmed = raw?.trim()
  if (trimmed) {
    const jsonStart = trimmed.indexOf('{')
    if (jsonStart >= 0) {
      const prefix = trimmed.slice(0, jsonStart).trim().replace(/[:\s]+$/, '')
      const jsonText = trimmed.slice(jsonStart)
      try {
        const parsed = JSON.parse(jsonText)
        const nested = extractNestedErrorMessage(parsed)
        if (nested && prefix && prefix !== nested) {
          return `${prefix}: ${nested}`
        }
        if (nested) return nested
      } catch {
        // Fall through to the raw message when the provider returned non-JSON text.
      }
    }

    return extractNestedErrorMessage(trimmed) ?? trimmed
  }

  if (stopReason === 'aborted') {
    return 'Request was aborted.'
  }
  if (stopReason === 'error') {
    return 'Model returned an error without details.'
  }

  return null
}

export function getLatestAssistantError(entries: SessionEntry[]): string | null {
  const message = getLatestAssistantMessage(entries)
  if (!message) return null

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined
  const normalized = normalizeAssistantErrorMessage(message.errorMessage, stopReason)
  if (stopReason === 'error' || stopReason === 'aborted') {
    return normalized
  }

  const hasTextContent = message.content?.some((item) => item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0) ?? false
  if (!hasTextContent && normalized) {
    return normalized
  }

  return null
}
