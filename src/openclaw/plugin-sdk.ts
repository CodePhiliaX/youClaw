import { mkdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { getPaths, resolvePathInput } from '../config/paths.ts'
import type { OpenClawConfig } from './plugin-sdk-core.ts'

export type { OpenClawConfig }

export type ReplyPayload = {
  text?: string
  mediaUrl?: string
  mediaUrls?: string[]
}

export type ChannelAccountSnapshot = {
  accountId?: string
  name?: string
  enabled?: boolean
  configured?: boolean
  connected?: boolean
  running?: boolean
  lastError?: string | null
  lastEventAt?: number
  lastInboundAt?: number
  lastOutboundAt?: number
  lastStartAt?: number
  [key: string]: unknown
}

export type ChannelPlugin<ResolvedAccount = unknown> = {
  id: string
  meta?: Record<string, unknown>
  capabilities?: Record<string, unknown>
  reload?: {
    configPrefixes: string[]
    noopPrefixes?: string[]
  }
  configSchema?: {
    schema: Record<string, unknown>
    uiHints?: Record<string, unknown>
  }
  messaging?: Record<string, unknown>
  agentPrompt?: Record<string, unknown>
  config: {
    listAccountIds: (cfg: OpenClawConfig) => string[]
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => ResolvedAccount
    isConfigured?: (account: ResolvedAccount, cfg: OpenClawConfig) => boolean | Promise<boolean>
    describeAccount?: (account: ResolvedAccount, cfg: OpenClawConfig) => ChannelAccountSnapshot
  }
  outbound?: {
    deliveryMode: string
    textChunkLimit?: number
    sendText?: (ctx: {
      cfg: OpenClawConfig
      to: string
      text: string
      accountId?: string | null
    }) => Promise<{ channel: string; messageId: string }>
    sendMedia?: (ctx: {
      cfg: OpenClawConfig
      to: string
      text: string
      mediaUrl?: string
      accountId?: string | null
    }) => Promise<{ channel: string; messageId: string }>
  }
  status?: {
    defaultRuntime?: ChannelAccountSnapshot
    collectStatusIssues?: (accounts: ChannelAccountSnapshot[]) => unknown[]
    buildChannelSummary?: (params: {
      account: ResolvedAccount
      cfg: OpenClawConfig
      defaultAccountId: string
      snapshot: ChannelAccountSnapshot
    }) => Record<string, unknown> | Promise<Record<string, unknown>>
    buildAccountSnapshot?: (params: {
      account: ResolvedAccount
      cfg: OpenClawConfig
      runtime?: ChannelAccountSnapshot
    }) => ChannelAccountSnapshot | Promise<ChannelAccountSnapshot>
  }
  auth?: {
    login?: (params: {
      cfg: OpenClawConfig
      accountId?: string | null
      runtime: {
        log?: (msg: string) => void
        error?: (msg: string) => void
      }
      verbose?: boolean
      channelInput?: string | null
    }) => Promise<void>
  }
  gateway?: {
    startAccount?: (ctx: unknown) => Promise<unknown>
    stopAccount?: (ctx: unknown) => Promise<void>
    loginWithQrStart?: (params: {
      accountId?: string
      storageKey?: string
      force?: boolean
      timeoutMs?: number
      verbose?: boolean
      sessionKey?: string
    }) => Promise<{ qrDataUrl?: string; message: string; sessionKey?: string }>
    loginWithQrWait?: (params: {
      accountId?: string
      storageKey?: string
      timeoutMs?: number
      sessionKey?: string
    }) => Promise<{ connected: boolean; message: string; accountId?: string }>
    logoutAccount?: (ctx: unknown) => Promise<unknown>
  }
}

export type PluginRuntime = {
  channel: {
    commands: {
      shouldComputeCommandAuthorized: (rawBody: string, cfg: OpenClawConfig) => boolean
      resolveCommandAuthorizedFromAuthorizers: (params: {
        useAccessGroups: boolean
        authorizers: Array<{ configured: boolean; allowed: boolean }>
      }) => boolean
    }
    media: {
      saveMediaBuffer: (
        buffer: Buffer,
        contentType?: string,
        subdir?: string,
        maxBytes?: number,
        originalFilename?: string,
      ) => Promise<{ path: string }>
    }
    routing: {
      resolveAgentRoute: (params: Record<string, unknown>) => {
        agentId?: string
        sessionKey: string
        mainSessionKey: string
      }
    }
    session: {
      resolveStorePath: (storePath: string | undefined, params: { agentId?: string }) => string
      recordInboundSession: (params: Record<string, unknown>) => Promise<void>
    }
    reply: {
      finalizeInboundContext: <T>(ctx: T) => T
      resolveHumanDelayConfig: (cfg: OpenClawConfig, agentId?: string) => { enabled: false }
      createReplyDispatcherWithTyping: (params: Record<string, unknown>) => {
        dispatcher: unknown
        replyOptions: Record<string, unknown>
        markDispatchIdle: () => void
      }
      withReplyDispatcher: (params: Record<string, unknown>) => Promise<void>
      dispatchReplyFromConfig: (params: Record<string, unknown>) => Promise<void>
    }
  }
}

export type OpenClawPluginApi = {
  runtime: PluginRuntime
  registrationMode?: 'full' | 'snapshot'
  registerChannel: (params: { plugin: ChannelPlugin }) => void
  registerCli: (
    register: (params: { program: unknown; config: OpenClawConfig }) => void,
    opts?: { commands?: string[] },
  ) => void
}

export function buildChannelConfigSchema(schema: Record<string, unknown>) {
  return { schema }
}

const DEFAULT_ACCOUNT_ID = 'default'
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g
const LEADING_DASH_RE = /^-+/g
const TRAILING_DASH_RE = /-+$/g
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function normalizeAccountId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return DEFAULT_ACCOUNT_ID
  const normalized = VALID_ID_RE.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, '-')
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '')
      .slice(0, 64)
  if (!normalized || BLOCKED_KEYS.has(normalized)) {
    return DEFAULT_ACCOUNT_ID
  }
  return normalized
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\|[\s:|-]+\|$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>\s]+/gm, '')
    .replace(/[*_~`]+/g, '')
    .trim()
}

export function resolvePreferredOpenClawTmpDir(): string {
  let preferred: string
  try {
    preferred = path.resolve(getPaths().data, 'tmp', 'openclaw')
  } catch {
    const dataDir = process.env.DATA_DIR?.trim()
    preferred = dataDir
      ? path.resolve(resolvePathInput(dataDir), 'tmp', 'openclaw')
      : path.resolve(tmpdir(), 'youclaw-openclaw-tmp')
  }
  mkdirSync(preferred, { recursive: true })
  return preferred
}

export type FileLockOptions = {
  retries: {
    retries: number
    factor: number
    minTimeout: number
    maxTimeout: number
    randomize?: boolean
  }
  stale: number
}

type HeldLock = {
  count: number
  handle: fs.FileHandle
  lockPath: string
}

const HELD_LOCKS = new Map<string, HeldLock>()

function computeDelayMs(retries: FileLockOptions['retries'], attempt: number): number {
  const base = Math.min(
    retries.maxTimeout,
    Math.max(retries.minTimeout, retries.minTimeout * retries.factor ** attempt),
  )
  const jitter = retries.randomize ? 1 + Math.random() : 1
  return Math.min(retries.maxTimeout, Math.round(base * jitter))
}

async function readLockPayload(lockPath: string): Promise<{ pid: number; createdAt: string } | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<{ pid: number; createdAt: string }>
    if (typeof parsed.pid !== 'number' || typeof parsed.createdAt !== 'string') {
      return null
    }
    return { pid: parsed.pid, createdAt: parsed.createdAt }
  } catch {
    return null
  }
}

async function resolveNormalizedFilePath(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath)
  const dir = path.dirname(resolved)
  await fs.mkdir(dir, { recursive: true })
  try {
    const realDir = await fs.realpath(dir)
    return path.join(realDir, path.basename(resolved))
  } catch {
    return resolved
  }
}

async function isStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  const payload = await readLockPayload(lockPath)
  if (payload?.pid && payload.pid > 0) {
    try {
      process.kill(payload.pid, 0)
    } catch {
      return true
    }
  }
  if (payload?.createdAt) {
    const createdAt = Date.parse(payload.createdAt)
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > staleMs) {
      return true
    }
  }
  try {
    const stat = await fs.stat(lockPath)
    return Date.now() - stat.mtimeMs > staleMs
  } catch {
    return true
  }
}

async function releaseHeldLock(normalizedFile: string): Promise<void> {
  const current = HELD_LOCKS.get(normalizedFile)
  if (!current) return
  current.count -= 1
  if (current.count > 0) return
  HELD_LOCKS.delete(normalizedFile)
  await current.handle.close().catch(() => undefined)
  await fs.rm(current.lockPath, { force: true }).catch(() => undefined)
}

export async function withFileLock<T>(
  filePath: string,
  options: FileLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const normalizedFile = await resolveNormalizedFilePath(filePath)
  const lockPath = `${normalizedFile}.lock`
  const held = HELD_LOCKS.get(normalizedFile)
  if (held) {
    held.count += 1
    try {
      return await fn()
    } finally {
      await releaseHeldLock(normalizedFile)
    }
  }

  const attempts = Math.max(1, options.retries.retries + 1)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
        'utf8',
      )
      HELD_LOCKS.set(normalizedFile, { count: 1, handle, lockPath })
      try {
        return await fn()
      } finally {
        await releaseHeldLock(normalizedFile)
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'EEXIST') {
        throw err
      }
      if (await isStaleLock(lockPath, options.stale)) {
        await fs.rm(lockPath, { force: true }).catch(() => undefined)
        continue
      }
      if (attempt >= attempts - 1) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, computeDelayMs(options.retries, attempt)))
    }
  }

  throw new Error(`file lock timeout for ${normalizedFile}`)
}

export function resolveDirectDmAuthorizationOutcome(params: {
  isGroup: boolean
  dmPolicy: string
  senderAllowedForCommands: boolean
}): 'disabled' | 'unauthorized' | 'allowed' {
  if (params.isGroup) return 'allowed'
  if (params.dmPolicy === 'disabled') return 'disabled'
  if (params.dmPolicy !== 'open' && !params.senderAllowedForCommands) {
    return 'unauthorized'
  }
  return 'allowed'
}

export async function resolveSenderCommandAuthorizationWithRuntime(params: {
  cfg: OpenClawConfig
  rawBody: string
  isGroup: boolean
  dmPolicy: string
  configuredAllowFrom: string[]
  configuredGroupAllowFrom?: string[]
  senderId: string
  isSenderAllowed: (senderId: string, allowFrom: string[]) => boolean
  readAllowFromStore: () => Promise<string[]>
  runtime: PluginRuntime['channel']['commands']
}) {
  const shouldComputeAuth = params.runtime.shouldComputeCommandAuthorized(params.rawBody, params.cfg)
  const storeAllowFrom =
    !params.isGroup &&
    params.dmPolicy !== 'allowlist' &&
    (params.dmPolicy !== 'open' || shouldComputeAuth)
      ? await params.readAllowFromStore().catch(() => [])
      : []

  const effectiveAllowFrom = Array.from(new Set([...params.configuredAllowFrom, ...storeAllowFrom]))
  const effectiveGroupAllowFrom = params.configuredGroupAllowFrom ?? []
  const senderAllowedForCommands = params.isSenderAllowed(
    params.senderId,
    params.isGroup ? effectiveGroupAllowFrom : effectiveAllowFrom,
  )

  const commandAuthorized = shouldComputeAuth
    ? params.runtime.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: params.cfg.commands?.useAccessGroups !== false,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: params.isSenderAllowed(params.senderId, effectiveAllowFrom) },
          { configured: effectiveGroupAllowFrom.length > 0, allowed: params.isSenderAllowed(params.senderId, effectiveGroupAllowFrom) },
        ],
      })
    : undefined

  return {
    shouldComputeAuth,
    effectiveAllowFrom,
    effectiveGroupAllowFrom,
    senderAllowedForCommands,
    commandAuthorized,
  }
}

export type TypingCallbacks = {
  onReplyStart: () => Promise<void>
  onIdle?: () => void
  onCleanup?: () => void
}

export function createTypingCallbacks(params: {
  start: () => Promise<void>
  stop?: () => Promise<void>
  onStartError: (err: unknown) => void
  onStopError?: (err: unknown) => void
  keepaliveIntervalMs?: number
}): TypingCallbacks {
  const intervalMs = params.keepaliveIntervalMs ?? 3000
  let interval: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stopLoop = () => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
  }

  const fireStop = () => {
    if (closed) return
    closed = true
    stopLoop()
    if (params.stop) {
      void params.stop().catch((err) => (params.onStopError ?? params.onStartError)(err))
    }
  }

  return {
    onReplyStart: async () => {
      if (closed) return
      stopLoop()
      try {
        await params.start()
      } catch (err) {
        params.onStartError(err)
      }
      interval = setInterval(() => {
        if (closed) return
        void params.start().catch(params.onStartError)
      }, intervalMs)
    },
    onIdle: fireStop,
    onCleanup: fireStop,
  }
}
