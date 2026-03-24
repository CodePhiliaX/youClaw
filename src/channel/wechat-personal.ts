import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import openClawWeixinEntry from '../openclaw-plugins/openclaw-weixin/index.ts'
import { getUpdates } from '../openclaw-plugins/openclaw-weixin/src/api/api.ts'
import type { MessageItem, WeixinMessage } from '../openclaw-plugins/openclaw-weixin/src/api/types.ts'
import { MessageItemType } from '../openclaw-plugins/openclaw-weixin/src/api/types.ts'
import {
  SESSION_EXPIRED_ERRCODE,
  assertSessionActive,
  getRemainingPauseMs,
  pauseSession,
} from '../openclaw-plugins/openclaw-weixin/src/api/session-guard.ts'
import {
  clearWeixinAccount,
  deriveRawAccountId,
  DEFAULT_BASE_URL,
  loadWeixinAccount,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
  unregisterWeixinAccountId,
} from '../openclaw-plugins/openclaw-weixin/src/auth/accounts.ts'
import { downloadMediaFromItem } from '../openclaw-plugins/openclaw-weixin/src/media/media-download.ts'
import {
  getContextToken,
  setContextToken,
  weixinMessageToMsgContext,
} from '../openclaw-plugins/openclaw-weixin/src/messaging/inbound.ts'
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from '../openclaw-plugins/openclaw-weixin/src/storage/sync-buf.ts'
import type { ResolvedWeixinAccount } from '../openclaw-plugins/openclaw-weixin/src/auth/accounts.ts'
import { activateOpenClawPluginEntry, createNoopPluginRuntime } from '../openclaw/host.ts'
import { normalizeAccountId } from '../openclaw/plugin-sdk.ts'
import type { OpenClawConfig } from '../openclaw/plugin-sdk.ts'
import { getPaths } from '../config/paths.ts'
import { getLogger } from '../logger/index.ts'
import type {
  Channel,
  ChannelAuthStatus,
  ChannelLoginStartResult,
  ChannelLoginWaitResult,
  InboundMessage,
  OnInboundMessage,
} from './types.ts'

const OPENCLAW_WEIXIN_PLUGIN = (() => {
  const loaded = activateOpenClawPluginEntry(openClawWeixinEntry, createNoopPluginRuntime())
  if (!loaded.channel) {
    throw new Error('Failed to activate bundled OpenClaw Weixin plugin')
  }
  return loaded.channel
})()

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const MAX_CONSECUTIVE_FAILURES = 3
const BACKOFF_DELAY_MS = 30_000
const RETRY_DELAY_MS = 2_000

type WechatPersonalConfig = {
  accountId?: string
  cdnBaseUrl?: string
}

function buildChatId(stateKey: string, peerId: string): string {
  return `wxp:${stateKey}:${peerId}`
}

function parseChatId(chatId: string): { stateKey: string; peerId: string } {
  if (!chatId.startsWith('wxp:')) {
    throw new Error(`Unsupported WeChat chatId: ${chatId}`)
  }
  const rest = chatId.slice(4)
  const firstColon = rest.indexOf(':')
  if (firstColon <= 0) {
    throw new Error(`Malformed WeChat chatId: ${chatId}`)
  }
  return {
    stateKey: rest.slice(0, firstColon),
    peerId: rest.slice(firstColon + 1),
  }
}

function firstMediaItem(msg: WeixinMessage): MessageItem | undefined {
  return msg.item_list?.find(
    (item) => item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param,
  ) ??
    msg.item_list?.find(
      (item) => item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param,
    ) ??
    msg.item_list?.find(
      (item) => item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param,
    ) ??
    msg.item_list?.find(
      (item) =>
        item.type === MessageItemType.VOICE &&
        item.voice_item?.media?.encrypt_query_param &&
        !item.voice_item.text,
    ) ??
    msg.item_list?.find(
      (item) =>
        item.type === MessageItemType.TEXT &&
        item.ref_msg?.message_item &&
        (
          item.ref_msg.message_item.type === MessageItemType.IMAGE ||
          item.ref_msg.message_item.type === MessageItemType.VIDEO ||
          item.ref_msg.message_item.type === MessageItemType.FILE ||
          item.ref_msg.message_item.type === MessageItemType.VOICE
        ),
    )?.ref_msg?.message_item
}

function attachmentFromPath(filePath: string, mediaType: string): { filename: string; mediaType: string; filePath: string } {
  return {
    filename: path.basename(filePath),
    mediaType,
    filePath,
  }
}

function mimeExtension(mediaType?: string): string {
  switch (mediaType) {
    case 'audio/wav':
      return '.wav'
    case 'audio/silk':
      return '.silk'
    case 'video/mp4':
      return '.mp4'
    case 'image/*':
      return '.img'
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    default:
      return '.bin'
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

export class WechatPersonalChannel implements Channel {
  name = 'wechat-personal'

  private connected = false
  private abortController: AbortController | null = null
  private pollPromise: Promise<void> | null = null
  private pendingSessionKey: string | null = null
  private readonly stateKey: string

  constructor(
    private config: WechatPersonalConfig,
    private opts: { onMessage: OnInboundMessage; channelId: string },
  ) {
    this.stateKey = normalizeAccountId(opts.channelId)
  }

  isConnected(): boolean {
    return this.connected
  }

  ownsChatId(chatId: string): boolean {
    return chatId.startsWith('wxp:')
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const account = this.getResolvedAccount()
    if (!account.configured || !account.token) {
      throw new Error('WeChat personal channel is not logged in yet')
    }

    this.connected = true
    this.abortController = new AbortController()
    this.pollPromise = this.pollLoop(account, this.abortController.signal).finally(() => {
      this.connected = false
    })
  }

  async disconnect(): Promise<void> {
    this.connected = false
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.pollPromise) {
      await this.pollPromise.catch(() => undefined)
      this.pollPromise = null
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const { stateKey, peerId } = parseChatId(chatId)
    const contextToken = getContextToken(stateKey, peerId)
    await OPENCLAW_WEIXIN_PLUGIN.outbound?.sendText?.({
      cfg: this.buildCompatConfig(stateKey),
      to: peerId,
      text,
      accountId: stateKey,
    })
    if (!contextToken) {
      getLogger().warn({ stateKey, peerId }, 'WeChat outbound send had no cached context token')
    }
  }

  async sendMedia(chatId: string, text: string, mediaUrl: string): Promise<void> {
    const { stateKey, peerId } = parseChatId(chatId)
    const contextToken = getContextToken(stateKey, peerId)
    await OPENCLAW_WEIXIN_PLUGIN.outbound?.sendMedia?.({
      cfg: this.buildCompatConfig(stateKey),
      to: peerId,
      text,
      mediaUrl,
      accountId: stateKey,
    })
    if (!contextToken) {
      getLogger().warn({ stateKey, peerId, mediaUrl }, 'WeChat outbound media send had no cached context token')
    }
  }

  async loginWithQrStart(params?: { force?: boolean; timeoutMs?: number; verbose?: boolean }): Promise<ChannelLoginStartResult> {
    const result = await OPENCLAW_WEIXIN_PLUGIN.gateway?.loginWithQrStart?.({
      storageKey: this.stateKey,
      force: params?.force,
      timeoutMs: params?.timeoutMs,
      verbose: params?.verbose,
    })
    this.pendingSessionKey = result?.sessionKey ?? this.pendingSessionKey
    return {
      qrDataUrl: result?.qrDataUrl,
      message: result?.message ?? 'Failed to start WeChat login',
    }
  }

  async loginWithQrWait(params?: { timeoutMs?: number }): Promise<ChannelLoginWaitResult> {
    const result = await OPENCLAW_WEIXIN_PLUGIN.gateway?.loginWithQrWait?.({
      storageKey: this.stateKey,
      sessionKey: this.pendingSessionKey ?? undefined,
      timeoutMs: params?.timeoutMs,
    })
    this.pendingSessionKey = null

    const normalizedAccountId = result?.accountId ? normalizeAccountId(result.accountId) : undefined

    return {
      connected: !!result?.connected,
      message: result?.message ?? 'WeChat login did not complete',
      accountId: normalizedAccountId,
    }
  }

  async logout(): Promise<{ cleared: boolean; message?: string }> {
    await this.disconnect()
    this.pendingSessionKey = null

    this.ensureLegacyStateMigrated()

    if (!loadWeixinAccount(this.stateKey)) {
      return { cleared: true, message: 'No active WeChat account' }
    }

    clearWeixinAccount(this.stateKey)
    unregisterWeixinAccountId(this.stateKey)

    for (const id of [this.stateKey, deriveRawAccountId(this.stateKey)].filter((value): value is string => !!value)) {
      try {
        unlinkSync(getSyncBufFilePath(id))
      } catch {
        // ignore
      }
    }
    return { cleared: true, message: 'WeChat login data cleared' }
  }

  async getAuthStatus(): Promise<ChannelAuthStatus> {
    const account = this.getResolvedAccount()
    return {
      supportsQrLogin: true,
      loggedIn: account.configured,
      connected: this.connected,
      accountId: account.linkedAccountId,
      accountLabel: account.linkedAccountId || account.name || this.config.accountId,
    }
  }

  private getLegacyStateKey(): string | null {
    if (!this.config.accountId?.trim()) {
      return null
    }
    const legacyStateKey = normalizeAccountId(this.config.accountId)
    return legacyStateKey !== this.stateKey ? legacyStateKey : null
  }

  private ensureLegacyStateMigrated(): void {
    if (loadWeixinAccount(this.stateKey)) {
      return
    }

    const legacyStateKey = this.getLegacyStateKey()
    if (!legacyStateKey) {
      return
    }

    const legacyAccount = loadWeixinAccount(legacyStateKey)
    if (!legacyAccount) {
      return
    }

    saveWeixinAccount(this.stateKey, {
      token: legacyAccount.token,
      baseUrl: legacyAccount.baseUrl,
      userId: legacyAccount.userId,
      linkedAccountId: legacyAccount.linkedAccountId || legacyStateKey,
    })
    registerWeixinAccountId(this.stateKey)

    const legacyGetUpdatesBuf = loadGetUpdatesBuf(getSyncBufFilePath(legacyStateKey))
    if (legacyGetUpdatesBuf) {
      saveGetUpdatesBuf(getSyncBufFilePath(this.stateKey), legacyGetUpdatesBuf)
    }
  }

  private getResolvedAccount(): ResolvedWeixinAccount {
    this.ensureLegacyStateMigrated()
    return resolveWeixinAccount(this.buildCompatConfig(this.stateKey), this.stateKey)
  }

  private buildCompatConfig(stateKey?: string): OpenClawConfig {
    const normalizedStateKey = stateKey ? normalizeAccountId(stateKey) : undefined
    return {
      channels: {
        'openclaw-weixin': {
          accounts: normalizedStateKey
            ? {
                [normalizedStateKey]: {
                  enabled: true,
                  cdnBaseUrl: this.config.cdnBaseUrl,
                },
              }
            : {},
        },
      },
      commands: {
        useAccessGroups: false,
      },
    }
  }

  private async pollLoop(account: ResolvedWeixinAccount, signal: AbortSignal): Promise<void> {
    const logger = getLogger()
    const syncFilePath = getSyncBufFilePath(account.accountId)
    let getUpdatesBuf = loadGetUpdatesBuf(syncFilePath) ?? ''
    let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
    let consecutiveFailures = 0

    while (!signal.aborted) {
      try {
        assertSessionActive(account.accountId)
        const resp = await getUpdates({
          baseUrl: account.baseUrl || DEFAULT_BASE_URL,
          token: account.token,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
        })

        if (resp.longpolling_timeout_ms && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0)

        if (isApiError) {
          if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
            pauseSession(account.accountId)
            await sleep(getRemainingPauseMs(account.accountId), signal)
            consecutiveFailures = 0
            continue
          }

          consecutiveFailures += 1
          logger.warn({
            accountId: account.accountId,
            ret: resp.ret,
            errcode: resp.errcode,
            errmsg: resp.errmsg,
            consecutiveFailures,
          }, 'WeChat getUpdates returned an error')

          await sleep(
            consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS,
            signal,
          )

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0
          }
          continue
        }

        consecutiveFailures = 0

        if (resp.get_updates_buf) {
          getUpdatesBuf = resp.get_updates_buf
          saveGetUpdatesBuf(syncFilePath, getUpdatesBuf)
        }

        for (const full of resp.msgs ?? []) {
          if ((full.from_user_id ?? '') === account.accountId) {
            continue
          }
          await this.handleIncomingMessage(full, account)
        }
      } catch (err) {
        if (signal.aborted) return
        consecutiveFailures += 1
        logger.error({
          accountId: account.accountId,
          error: err instanceof Error ? err.message : String(err),
          consecutiveFailures,
        }, 'WeChat poll loop error')
        await sleep(
          consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS,
          signal,
        ).catch(() => undefined)
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0
        }
      }
    }
  }

  private async handleIncomingMessage(msg: WeixinMessage, account: ResolvedWeixinAccount): Promise<void> {
    const fromUserId = (msg.from_user_id ?? '').trim()
    if (!fromUserId) return

    if (msg.context_token) {
      setContextToken(account.accountId, fromUserId, msg.context_token)
    }

    const mediaItem = firstMediaItem(msg)
    const mediaOpts = mediaItem
      ? await downloadMediaFromItem(mediaItem, {
          cdnBaseUrl: account.cdnBaseUrl,
          saveMedia: async (buffer, contentType, subdir, maxBytes, originalFilename) =>
            this.saveInboundMedia(buffer, contentType, subdir, maxBytes, originalFilename),
          log: (line) => getLogger().debug({ accountId: account.accountId }, line),
          errLog: (line) => getLogger().warn({ accountId: account.accountId }, line),
          label: 'inbound',
        })
      : {}

    const ctx = weixinMessageToMsgContext(msg, account.accountId, mediaOpts)
    const attachments: InboundMessage['attachments'] = []

    if (mediaOpts.decryptedPicPath) {
      attachments.push(attachmentFromPath(mediaOpts.decryptedPicPath, 'image/*'))
    }
    if (mediaOpts.decryptedVideoPath) {
      attachments.push(attachmentFromPath(mediaOpts.decryptedVideoPath, 'video/mp4'))
    }
    if (mediaOpts.decryptedFilePath) {
      attachments.push(attachmentFromPath(mediaOpts.decryptedFilePath, mediaOpts.fileMediaType ?? 'application/octet-stream'))
    }
    if (mediaOpts.decryptedVoicePath) {
      attachments.push(attachmentFromPath(mediaOpts.decryptedVoicePath, mediaOpts.voiceMediaType ?? 'audio/wav'))
    }

    await this.opts.onMessage({
      id: msg.message_id ? String(msg.message_id) : randomUUID(),
      chatId: buildChatId(account.accountId, fromUserId),
      sender: fromUserId,
      senderName: fromUserId,
      content: ctx.Body ?? '',
      timestamp: msg.create_time_ms ? new Date(msg.create_time_ms).toISOString() : new Date().toISOString(),
      isGroup: false,
      channel: 'wechat-personal',
      attachments: attachments.length > 0 ? attachments : undefined,
    })
  }

  private async saveInboundMedia(
    buffer: Buffer,
    contentType?: string,
    subdir?: string,
    maxBytes?: number,
    originalFilename?: string,
  ): Promise<{ path: string }> {
    if (maxBytes && buffer.length > maxBytes) {
      throw new Error(`Inbound media exceeds max size (${buffer.length} > ${maxBytes})`)
    }

    const mediaRoot = path.join(getPaths().data, 'channel-media', 'wechat-personal', subdir || 'inbound')
    mkdirSync(mediaRoot, { recursive: true })
    const filename = originalFilename?.trim()
      ? path.basename(originalFilename)
      : `${Date.now()}-${randomUUID().slice(0, 8)}${mimeExtension(contentType)}`
    const targetPath = path.join(mediaRoot, filename)
    writeFileSync(targetPath, buffer)
    return { path: targetPath }
  }
}
