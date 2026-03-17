import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { existsSync, copyFileSync, mkdirSync, statSync, chmodSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { getEnv } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { getSession, saveSession } from '../db/index.ts'
import type { EventBus } from '../events/index.ts'
import { ErrorCode } from '../events/types.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentCompiler } from './compiler.ts'
import type { HooksManager } from './hooks.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import { abortRegistry } from './abort-registry.ts'
import { getActiveModelConfig } from '../settings/manager.ts'
import { getAuthToken } from '../routes/auth.ts'
import type { AgentConfig, ProcessParams } from './types.ts'

// Safe logger wrapper — resolveCliPath() may run before logger is initialised
function safeLog(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  try {
    const logger = getLogger()
    logger[level]({ ...extra, category: 'agent' }, msg)
  } catch {
    // Logger not yet initialised — fall back to console
    // eslint-disable-next-line no-console
    console[level](`[agent] ${msg}`, extra ?? '')
  }
}

// Resolve claude-agent-sdk cli.js path
// - Tauri bundled mode: copy from RESOURCES_DIR to DATA_DIR/sdk-cache (quarantine bypass)
// - Dev mode: locate via require.resolve in node_modules
function resolveCliPath(): string {
  // Tauri bundled mode: cli.js is in the resources directory
  const resourcesDir = process.env.RESOURCES_DIR
  if (resourcesDir) {
    const resourceCliPath = resolve(resourcesDir, '_up_/node_modules/@anthropic-ai/claude-agent-sdk/cli.js')
    if (existsSync(resourceCliPath)) {
      // Copy to DATA_DIR/sdk-cache to escape quarantine on macOS
      const dataDir = process.env.DATA_DIR
      if (dataDir) {
        try {
          const cacheDir = resolve(dataDir, 'sdk-cache')
          const cachedCliPath = resolve(cacheDir, 'cli.js')

          // Version-aware cache: only copy if file size differs (new SDK version)
          let needsCopy = true
          if (existsSync(cachedCliPath)) {
            try {
              const srcSize = statSync(resourceCliPath).size
              const dstSize = statSync(cachedCliPath).size
              needsCopy = srcSize !== dstSize
            } catch {
              needsCopy = true
            }
          }

          if (needsCopy) {
            mkdirSync(cacheDir, { recursive: true })
            copyFileSync(resourceCliPath, cachedCliPath)
            safeLog('info', `Copied cli.js to sdk-cache (quarantine bypass)`, { src: resourceCliPath, dst: cachedCliPath })
          }

          // Strip macOS quarantine attribute from the cached copy
          if (process.platform === 'darwin') {
            try {
              execSync(`xattr -d com.apple.quarantine "${cachedCliPath}"`, { timeout: 5000 })
              safeLog('info', 'Stripped quarantine from cached cli.js')
            } catch {
              // Attribute may not exist — that's fine
            }
          }

          return cachedCliPath
        } catch (copyErr) {
          safeLog('warn', 'Failed to copy cli.js to sdk-cache, falling back to resource path', {
            error: copyErr instanceof Error ? copyErr.message : String(copyErr),
          })
          return resourceCliPath
        }
      }
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

/**
 * Validate that the resolved cli.js is executable.
 * Logs diagnostics but never throws — failures are advisory only.
 */
function validateCliExecutable(cliPath: string): void {
  // Check file exists
  if (!existsSync(cliPath)) {
    safeLog('error', 'SDK cli.js not found', { cliPath })
    return
  }

  // macOS: check quarantine attribute
  if (process.platform === 'darwin') {
    try {
      const xattrOutput = execSync(`xattr -l "${cliPath}"`, { timeout: 3000, encoding: 'utf-8' })
      if (xattrOutput.includes('com.apple.quarantine')) {
        safeLog('warn', 'SDK cli.js still has quarantine attribute — Gatekeeper may block execution', { cliPath })
      }
    } catch {
      // xattr command failed — likely no attributes at all, which is fine
    }
  }

  // Quick spawn test: verify the CLI can at least start
  // Uses resolveRuntimeExecutable() which returns embedded bun if available,
  // falling back to system bun or process.execPath in dev mode.
  const runtime = resolveRuntimeExecutable()
  try {
    execSync(`"${runtime}" "${cliPath}" --help`, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' })
    safeLog('info', 'SDK cli.js validation passed', { cliPath, runtime })
  } catch (spawnErr) {
    safeLog('warn', 'SDK cli.js quick-test failed — the agent may not start correctly', {
      cliPath,
      runtime,
      error: spawnErr instanceof Error ? spawnErr.message : String(spawnErr),
    })
  }
}

/**
 * Detect macOS system proxy settings and inject into process env.
 * Only runs on macOS; silently skips on other platforms.
 */
function detectSystemProxy(): void {
  if (process.platform !== 'darwin') return

  // Skip if proxy env vars are already set
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    safeLog('info', 'Proxy env vars already set, skipping system proxy detection', {
      HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || '(not set)',
      HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || '(not set)',
    })
    return
  }

  try {
    const output = execSync('networksetup -getsecurewebproxy Wi-Fi', { timeout: 3000, encoding: 'utf-8' })
    const enabledMatch = output.match(/^Enabled:\s*(Yes|No)/im)
    if (enabledMatch && enabledMatch[1] === 'Yes') {
      const serverMatch = output.match(/^Server:\s*(.+)/im)
      const portMatch = output.match(/^Port:\s*(\d+)/im)
      if (serverMatch?.[1] && portMatch?.[1]) {
        const proxyUrl = `http://${serverMatch[1].trim()}:${portMatch[1].trim()}`
        process.env.HTTPS_PROXY = proxyUrl
        process.env.HTTP_PROXY = proxyUrl
        safeLog('info', 'Detected macOS system proxy', { proxyUrl })
      }
    }
  } catch (proxyErr) {
    safeLog('info', 'System proxy detection failed or unavailable', {
      error: proxyErr instanceof Error ? proxyErr.message : String(proxyErr),
    })
  }
  safeLog('info', 'No system proxy detected')
}

/**
 * Ensure Bun runtime is available for SDK subprocess.
 * In bundled mode, extracts embedded Bun from resources to DATA_DIR/bun-runtime/.
 * Returns the resolved path to the bun executable, or null if not needed / unavailable.
 */
export function ensureBunRuntime(): string | null {
  const isBundled = process.execPath.includes('.app/') || process.execPath.includes('youclaw-server')
  if (!isBundled) return null  // Dev mode: use process.execPath directly

  const dataDir = process.env.DATA_DIR
  if (!dataDir) return null

  const ext = process.platform === 'win32' ? '.exe' : ''
  const targetDir = resolve(dataDir, 'bun-runtime')
  const targetPath = resolve(targetDir, `bun${ext}`)

  // Already extracted?
  if (existsSync(targetPath)) {
    _bunRuntimePath = targetPath
    return targetPath
  }

  // Try to extract from resources
  const resourcesDir = process.env.RESOURCES_DIR
  if (resourcesDir) {
    // Tauri 2 converts ../ to _up_/, so the bun-runtime dir could be at multiple locations
    const candidates = [
      resolve(resourcesDir, '_up_/src-tauri/resources/bun-runtime', `bun${ext}`),
      resolve(resourcesDir, 'bun-runtime', `bun${ext}`),
    ]
    for (const src of candidates) {
      if (existsSync(src)) {
        mkdirSync(targetDir, { recursive: true })
        copyFileSync(src, targetPath)
        chmodSync(targetPath, 0o755)
        // macOS: strip quarantine
        if (process.platform === 'darwin') {
          try { execSync(`xattr -d com.apple.quarantine "${targetPath}"`, { timeout: 5000 }) } catch {}
        }
        safeLog('info', 'Extracted embedded Bun runtime', { src, dst: targetPath })
        _bunRuntimePath = targetPath
        return targetPath
      }
    }
  }

  // No embedded runtime found
  safeLog('warn', 'No embedded Bun runtime in resources')
  return null
}

// Module-level cache set by ensureBunRuntime() or lazy init
let _bunRuntimePath: string | null | undefined = undefined

/**
 * Find Node.js executable on Windows.
 * cli.js is a Node.js program — Bun's Node.js compat on Windows is insufficient.
 */
function findNodeExecutable(): string | null {
  if (process.platform !== 'win32') return null

  try {
    const whereOutput = execSync('where node', { timeout: 5000, encoding: 'utf-8' }).trim()
    const nodePath = whereOutput.split('\n')[0]?.trim() ?? ''
    if (nodePath && existsSync(nodePath)) {
      return nodePath
    }
  } catch {
    // node not in PATH
  }

  // Check common install locations
  const candidates = [
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\nodejs\\node.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\fnm_multishells\\node.exe`,
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return null
}

function resolveRuntimeExecutable(): string {
  const isBundled = process.execPath.includes('.app/') || process.execPath.includes('youclaw-server')
  if (!isBundled) return process.execPath

  // Windows: prefer node.exe because cli.js is a Node.js app
  // Bun's Node.js compat on Windows is insufficient for Claude Code CLI
  if (process.platform === 'win32') {
    const nodePath = findNodeExecutable()
    if (nodePath) {
      safeLog('info', 'Using Node.js for SDK subprocess on Windows', { nodePath })
      return nodePath
    }
    safeLog('warn', 'Node.js not found on Windows, falling back to embedded Bun')
  }

  // Use cached embedded bun path (macOS/Linux, or Windows fallback)
  if (_bunRuntimePath === undefined) {
    _bunRuntimePath = ensureBunRuntime()
  }
  if (_bunRuntimePath && existsSync(_bunRuntimePath)) {
    return _bunRuntimePath
  }

  // Fallback: system bun
  return 'bun'
}

// Deferred startup checks — run once on first executeQuery() call
let _startupChecksDone = false
function ensureStartupChecks(cliPath: string): void {
  if (_startupChecksDone) return
  _startupChecksDone = true
  detectSystemProxy()
  validateCliExecutable(cliPath)
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

      // Read model config from Settings (built-in uses .env, custom requires user input)
      const modelConfig = getActiveModelConfig()
      let model = env.AGENT_MODEL
      if (modelConfig) {
        model = modelConfig.modelId
        // Set env vars for the SDK
        process.env.ANTHROPIC_API_KEY = modelConfig.apiKey
        if (modelConfig.baseUrl) {
          process.env.ANTHROPIC_BASE_URL = modelConfig.baseUrl
        } else {
          delete process.env.ANTHROPIC_BASE_URL
        }
        logger.info({ provider: modelConfig.provider, model, baseUrl: modelConfig.baseUrl || '(default)' }, 'Model config loaded')
        logger.debug({
          agentId, chatId,
          provider: modelConfig.provider,
          modelId: modelConfig.modelId,
          baseUrl: modelConfig.baseUrl || '(default)',
          apiKeyPrefix: modelConfig.apiKey ? modelConfig.apiKey.slice(0, 8) + '***' : '(not set)',
          category: 'agent',
        }, 'Model config details')
      } else {
        // No model config available, clear env vars to prevent using user's system env vars
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.ANTHROPIC_BASE_URL
        logger.warn('No model config available. Agent features will not work. Please configure a model in Settings.')
      }

      // Handle auth headers based on provider
      if (modelConfig?.provider === 'builtin') {
        const authToken = getAuthToken()
        if (!authToken) {
          throw new Error('Not logged in: Please log in to use built-in models')
        }
        process.env.ANTHROPIC_CUSTOM_HEADERS = `rdxtoken: ${authToken}`
      } else {
        // Custom model: clean up rdxtoken header to prevent leaking from previous builtin requests
        delete process.env.ANTHROPIC_CUSTOM_HEADERS
      }

      // Pre-flight check: verify API connectivity before spawning SDK subprocess
      if (modelConfig?.baseUrl) {
        const preflightHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': modelConfig.apiKey,
        }
        // Attach rdxtoken for builtin provider
        const authToken = getAuthToken()
        if (modelConfig.provider === 'builtin' && authToken) {
          preflightHeaders['rdxtoken'] = authToken
        }
        const preflightUrl = `${modelConfig.baseUrl}/v1/messages`
        const preflightBody = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
        const preflightStartTime = Date.now()
        logger.debug({
          agentId, chatId,
          url: preflightUrl,
          headers: {
            'Content-Type': preflightHeaders['Content-Type'],
            'anthropic-version': preflightHeaders['anthropic-version'],
            'x-api-key': preflightHeaders['x-api-key'] ? preflightHeaders['x-api-key'].slice(0, 8) + '***' : '(not set)',
            rdxtoken: preflightHeaders['rdxtoken'] ? '(set)' : '(not set)',
          },
          bodyLength: preflightBody.length,
          category: 'agent',
        }, 'Pre-flight request starting')
        try {
          const preflight = await fetch(preflightUrl, {
            method: 'POST',
            headers: preflightHeaders,
            body: preflightBody,
            signal: AbortSignal.timeout(15000),
          })
          const preflightDurationMs = Date.now() - preflightStartTime
          logger.debug({
            agentId, chatId,
            status: preflight.status,
            statusText: preflight.statusText,
            durationMs: preflightDurationMs,
            responseHeaders: {
              'content-type': preflight.headers.get('content-type'),
              'x-request-id': preflight.headers.get('x-request-id'),
              'retry-after': preflight.headers.get('retry-after'),
            },
            category: 'agent',
          }, 'Pre-flight response received')
          logger.info({
            agentId, chatId,
            preflightStatus: preflight.status,
            baseUrl: modelConfig.baseUrl,
            category: 'agent',
          }, 'API pre-flight check completed')
          if (preflight.status === 401 || preflight.status === 403) {
            const body = await preflight.text().catch(() => '')
            throw new Error(`API authentication failed (HTTP ${preflight.status}): ${body.slice(0, 200)}`)
          }
          if (preflight.status >= 500) {
            const body = await preflight.text().catch(() => '')
            logger.warn({ agentId, chatId, status: preflight.status, body: body.slice(0, 200), category: 'agent' }, 'API server error in pre-flight')
          }
        } catch (err) {
          const preflightErrorDurationMs = Date.now() - preflightStartTime
          if (err instanceof Error && err.message.startsWith('API authentication failed')) {
            throw err
          }
          if (err instanceof Error && (err.name === 'TimeoutError' || err.message.includes('timeout'))) {
            logger.warn({
              agentId, chatId,
              errorType: 'timeout',
              durationMs: preflightErrorDurationMs,
              url: preflightUrl,
              category: 'agent',
            }, 'Pre-flight request timed out, proceeding with SDK anyway')
          } else if (err instanceof Error && /ECONNREFUSED|ENOTFOUND|fetch failed/.test(err.message)) {
            logger.warn({
              agentId, chatId,
              errorType: 'network',
              errorName: err.name,
              errorMessage: err.message,
              durationMs: preflightErrorDurationMs,
              url: preflightUrl,
              category: 'agent',
            }, 'Pre-flight network error, proceeding with SDK anyway')
          }
          logger.warn({
            agentId, chatId,
            error: String(err),
            errorType: err instanceof Error ? err.name : 'unknown',
            durationMs: preflightErrorDurationMs,
            category: 'agent',
          }, 'API pre-flight check failed, proceeding with SDK anyway')
        }
      }

      logger.info({
        agentId, chatId,
        model,
        baseUrl: process.env.ANTHROPIC_BASE_URL || '(default)',
        hasCustomHeaders: !!process.env.ANTHROPIC_CUSTOM_HEADERS,
        category: 'agent',
      }, 'SDK env config before query')

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
      logger.info({ agentId, chatId, errorCode, userError, category: 'agent' }, 'Error code identification result')

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
      // Clean up custom headers to prevent leaking between requests
      delete process.env.ANTHROPIC_CUSTOM_HEADERS
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
    abortRegistry.register(chatId, abortController)
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

    // Ensure HOME is set on Windows (cli.js needs it)
    if (process.platform === 'win32' && !process.env.HOME && process.env.USERPROFILE) {
      process.env.HOME = process.env.USERPROFILE
    }

    // Auto-detect Git Bash on Windows (claude-agent-sdk requires it for shell commands)
    if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      // Priority 1: Bundled MinGit in resources directory
      const resourcesDir = process.env.RESOURCES_DIR
      if (resourcesDir) {
        const mingitCandidates = [
          resolve(resourcesDir, 'mingit', 'usr', 'bin', 'bash.exe'),
          resolve(resourcesDir, '_up_', 'src-tauri', 'resources', 'mingit', 'usr', 'bin', 'bash.exe'),
        ]
        for (const candidate of mingitCandidates) {
          if (existsSync(candidate)) {
            logger.info({ path: candidate, category: 'agent' }, 'Bundled MinGit detected on Windows')
            process.env.CLAUDE_CODE_GIT_BASH_PATH = candidate
            break
          }
        }
      }

      // Priority 2: System Git installation
      if (!process.env.CLAUDE_CODE_GIT_BASH_PATH) {
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
        const localAppData = process.env.LOCALAPPDATA || ''

        const candidates = [
          `${programFiles}\\Git\\bin\\bash.exe`,
          `${programFilesX86}\\Git\\bin\\bash.exe`,
          `${localAppData}\\Programs\\Git\\bin\\bash.exe`,
        ]

        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            logger.info({ path: candidate, category: 'agent' }, 'Git Bash auto-detected on Windows')
            process.env.CLAUDE_CODE_GIT_BASH_PATH = candidate
            break
          }
        }
      }
    }

    const cliPath = resolveCliPath()
    ensureStartupChecks(cliPath)
    // Determine JS runtime executable for SDK subprocess
    // Uses resolveRuntimeExecutable() which returns embedded bun if available,
    // falling back to system bun or process.execPath in dev mode.
    const executable = resolveRuntimeExecutable()

    // Capture SDK subprocess stderr for diagnostics
    let stderrOutput = ''

    const queryOptions: Record<string, unknown> = {
      model,
      cwd,
      systemPrompt,
      abortController,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: cliPath,
      executable,
      settingSources: ['project'],
      ...(existingSessionId ? { resume: existingSessionId } : {}),
      stderr: (data: string) => {
        stderrOutput += data
        logger.debug({ agentId, chatId, stderr: data.slice(0, 500), category: 'agent' }, 'SDK subprocess stderr')
      },
    }
    logger.info({ cliPath, executable, category: 'agent' }, 'SDK executable config')

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

    // Tool access control (ensure Skill tool is always included)
    if (this.config.allowedTools) {
      const tools = [...this.config.allowedTools]
      if (!tools.includes('Skill')) {
        tools.push('Skill')
      }
      queryOptions.allowedTools = tools
    }
    // Always disable SDK built-in cron tools — YouClaw uses IPC-based persistent tasks instead
    const BUILTIN_DISALLOWED_TOOLS = ['CronCreate', 'CronDelete', 'CronList']
    const disallowed = [
      ...BUILTIN_DISALLOWED_TOOLS,
      ...(this.config.disallowedTools ?? []),
    ]
    queryOptions.disallowedTools = disallowed

    // Other SDK capabilities
    if (this.config.maxTurns) {
      queryOptions.maxTurns = this.config.maxTurns
    }

    const queryStartTime = Date.now()

    // Log full query options and env snapshot for debugging
    logger.debug({
      agentId, chatId,
      queryOptions: {
        model: queryOptions.model,
        cwd: queryOptions.cwd,
        systemPromptLength: systemPrompt.length,
        systemPromptPreview: systemPrompt.slice(0, 200) + (systemPrompt.length > 200 ? '...' : ''),
        permissionMode: queryOptions.permissionMode,
        hasResume: !!queryOptions.resume,
        resumeSessionId: queryOptions.resume || '(new session)',
        hasAgents: !!queryOptions.agents,
        hasMcpServers: !!queryOptions.mcpServers,
        maxTurns: queryOptions.maxTurns || '(default)',
        allowedTools: queryOptions.allowedTools || '(all)',
        disallowedTools: queryOptions.disallowedTools || '(none)',
      },
      envSnapshot: {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(not set)',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.slice(0, 8) + '***' : '(not set)',
        ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS ? '(set)' : '(not set)',
        HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || '(not set)',
        HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || '(not set)',
      },
      category: 'agent',
    }, 'Full SDK query options and env snapshot')

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

    abortRegistry.setQuery(chatId, q as AsyncIterable<unknown> & { close?: () => void })

    // Stream-process SDK messages with first-message timeout
    logger.info({ agentId, chatId, category: 'agent' }, 'SDK query created, starting to consume messages')
    let firstMessageReceived = false
    let firstResponseLogged = false
    let turnCount = 0

    // 60s timeout for first message — if SDK subprocess hangs, fail fast
    const FIRST_MESSAGE_TIMEOUT_MS = 60_000
    let firstMessageTimer: ReturnType<typeof setTimeout> | null = null
    const firstMessagePromise = new Promise<never>((_, reject) => {
      firstMessageTimer = setTimeout(() => {
        reject(new Error(`SDK subprocess did not respond within ${FIRST_MESSAGE_TIMEOUT_MS / 1000}s. The model API may be unreachable. (baseUrl: ${process.env.ANTHROPIC_BASE_URL || 'default'})`))
      }, FIRST_MESSAGE_TIMEOUT_MS)
    })

    try {
      const iterator = q[Symbol.asyncIterator]()
      logger.debug({ agentId, chatId, category: 'agent' }, 'SDK async iterator created, waiting for first message')
      let messageIndex = 0
      let lastMessageTime = Date.now()
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Race between next message and first-message timeout (only before first message)
        const nextPromise = iterator.next()
        const result = firstMessageReceived
          ? await nextPromise
          : await Promise.race([nextPromise, firstMessagePromise])

        if (result.done) {
          logger.debug({ agentId, chatId, totalMessages: messageIndex, category: 'agent' }, 'SDK message stream ended')
          break
        }
        const message = result.value
        const now = Date.now()
        const gapMs = now - lastMessageTime
        lastMessageTime = now
        messageIndex++
        logger.debug({
          agentId, chatId,
          messageType: message.type,
          messageIndex,
          gapMs,
          category: 'agent',
        }, `SDK message #${messageIndex}: ${message.type}`)

        if (!firstMessageReceived) {
          firstMessageReceived = true
          if (firstMessageTimer) {
            clearTimeout(firstMessageTimer)
            firstMessageTimer = null
          }
        }

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
      // User-initiated abort — return partial text gracefully instead of throwing
      if (abortController.signal.aborted) {
        logger.info({ agentId, chatId, category: 'agent' }, 'SDK query aborted by user, returning partial text')
        return { fullText, sessionId }
      }

      // When SDK process crashes, fullText may contain actual error info from upstream API
      const errMsg = err instanceof Error ? err.message : String(err)
      const timeSinceStart = Date.now() - queryStartTime

      // Detailed diagnostic logging for SDK subprocess failures
      logger.error({
        agentId, chatId,
        error: errMsg,
        durationMs: timeSinceStart,
        firstMessageReceived,
        cliPath,
        executable,
        processExecPath: process.execPath,
        cwd,
        model,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL || '(default)',
        resourcesDir: process.env.RESOURCES_DIR || '(not set)',
        dataDir: process.env.DATA_DIR || '(not set)',
        platform: process.platform,
        fullTextPreview: fullText.trim().slice(0, 300) || '(empty)',
        stderrPreview: stderrOutput.trim().slice(0, 500) || '(empty)',
        category: 'agent',
      }, 'SDK query failed — full diagnostic')

      // If SDK crashed before producing any output and within 5s, likely a startup issue
      if (!firstMessageReceived && timeSinceStart < 5000 && /process exited/i.test(errMsg)) {
        const cliExists = existsSync(cliPath)
        let hasQuarantine = false
        if (process.platform === 'darwin' && cliExists) {
          try {
            const xattr = execSync(`xattr -l "${cliPath}"`, { timeout: 3000, encoding: 'utf-8' })
            hasQuarantine = xattr.includes('com.apple.quarantine')
          } catch { /* no attributes */ }
        }
        logger.error({
          cliPath, cliExists, hasQuarantine,
          timeSinceStart,
          category: 'agent',
        }, 'SDK subprocess failed immediately — possible quarantine or missing binary')
      }

      // Append fullText or stderr to the error message so humanizeError can match specific error types
      if (fullText.trim() || stderrOutput.trim()) {
        const detail = fullText.trim() || stderrOutput.trim()
        throw new Error(`${errMsg} | upstream_response: ${detail.slice(0, 500)}`)
      }
      throw err
    } finally {
      if (firstMessageTimer) {
        clearTimeout(firstMessageTimer)
      }
      abortRegistry.unregister(chatId)
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
    // Pass through raw message directly for unrecognized/upstream errors — no humanization needed
    if (/request interrupted by user/i.test(raw)) {
      return { message: raw, errorCode: ErrorCode.UNKNOWN }
    }
    // Insufficient credits (highest priority — triggers top-up dialog)
    if (/insufficient|credit|balance|quota|insufficient_credits/i.test(raw)) {
      return { message: 'Insufficient credits or API quota. Please check your account balance.', errorCode: ErrorCode.INSUFFICIENT_CREDITS }
    }
    // Built-in model auth (user not logged in or token expired)
    if (/not logged in|please log in/i.test(raw)) {
      return { message: 'Please log in to use built-in models.', errorCode: ErrorCode.AUTH_FAILED }
    }
    // API authentication failure (401, invalid key/token)
    if (/unauthorized|authentication_error|invalid.*token|invalid.*key|\b401\b/i.test(raw)) {
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
    // Server error (5xx from proxy/API)
    if (/\b50[0-9]\b|server error|bad gateway|service unavailable/i.test(raw)) {
      return { message: 'The model API returned a server error. This is usually temporary — please retry.', errorCode: ErrorCode.MODEL_CONNECTION_FAILED }
    }
    // Windows SDK subprocess crash — hint about Node.js
    if (process.platform === 'win32' && /process exited with code/i.test(raw) && !/upstream_response/i.test(raw)) {
      return {
        message: 'Agent process failed to start on Windows. Please ensure Node.js is installed (https://nodejs.org). If already installed, please check the logs for details.',
        errorCode: ErrorCode.MODEL_CONNECTION_FAILED,
      }
    }
    // SDK process crash (fallback — last to avoid masking specific errors in upstream_response)
    if (/process exited with code/i.test(raw)) {
      // Extract upstream_response detail if available
      const upstreamMatch = raw.match(/upstream_response:\s*(.{1,200})/) as RegExpMatchArray | null
      const detail = upstreamMatch?.[1] ? ` (${upstreamMatch[1].trim()})` : ''
      return { message: `Model process exited unexpectedly${detail}. This may be a temporary issue — please retry.`, errorCode: ErrorCode.MODEL_CONNECTION_FAILED }
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
