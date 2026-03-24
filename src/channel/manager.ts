import { getLogger } from '../logger/index.ts'
import { validateChannelConfig, maskSecretFields, CHANNEL_TYPE_REGISTRY } from './config-schema.ts'
import { createChannelFromRecord } from './factory.ts'
import {
  createChannelRecord, getChannelRecords, getChannelRecord,
  updateChannelRecord, deleteChannelRecord,
} from '../db/index.ts'
import type { ChannelRecord } from '../db/index.ts'
import type {
  Channel,
  ChannelAuthStatus,
  ChannelLoginStartResult,
  ChannelLoginWaitResult,
  OnInboundMessage,
  ChannelStatus,
} from './types.ts'
import type { MessageRouter } from './router.ts'
import type { EnvConfig } from '../config/index.ts'
import type { EventBus } from '../events/bus.ts'

interface ManagedChannel {
  record: ChannelRecord
  instance: Channel | null
  retryCount: number
  retryTimer: ReturnType<typeof setTimeout> | null
  lastError?: string
}

const MAX_RETRIES = 10
const BASE_RETRY_DELAY = 5000  // 5s
const MAX_RETRY_DELAY = 300000 // 5min

export class ChannelManager {
  private managed: Map<string, ManagedChannel> = new Map()
  private router: MessageRouter
  private onMessage: OnInboundMessage
  private eventBus: EventBus | null = null

  constructor(router: MessageRouter, onMessage: OnInboundMessage, eventBus?: EventBus) {
    this.router = router
    this.onMessage = onMessage
    this.eventBus = eventBus ?? null
  }

  /**
   * Load all enabled channels from the database and connect
   */
  async loadFromDatabase(): Promise<void> {
    const logger = getLogger()
    const records = getChannelRecords()

    for (const record of records) {
      if (!record.enabled) continue

      try {
        await this.startChannel(record, { autoConnect: true })
      } catch (err) {
        logger.error({ channelId: record.id, error: err instanceof Error ? err.message : String(err) }, 'Channel failed to start')
      }
    }

    logger.info({ count: this.managed.size }, 'Channels loaded')
  }

  /**
   * Seed channels from env vars on first start (backward compatibility)
   */
  async seedFromEnv(env: EnvConfig): Promise<void> {
    const logger = getLogger()
    const existing = getChannelRecords()

    // Skip migration if database already has channel records
    if (existing.length > 0) return

    let seeded = false

    // Migrate Telegram
    if (env.TELEGRAM_BOT_TOKEN) {
      createChannelRecord({
        id: 'telegram',
        type: 'telegram',
        label: 'Telegram',
        config: JSON.stringify({ botToken: env.TELEGRAM_BOT_TOKEN }),
        enabled: true,
      })
      seeded = true
      logger.info('Migrated Telegram channel config from env to database')
    }

    // Migrate Feishu
    if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
      createChannelRecord({
        id: 'feishu',
        type: 'feishu',
        label: 'Feishu / Lark',
        config: JSON.stringify({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET }),
        enabled: true,
      })
      seeded = true
      logger.info('Migrated Feishu channel config from env to database')
    }

    // Migrate QQ
    if (env.QQ_BOT_APP_ID && env.QQ_BOT_SECRET) {
      createChannelRecord({
        id: 'qq',
        type: 'qq',
        label: 'QQ',
        config: JSON.stringify({ botAppId: env.QQ_BOT_APP_ID, botSecret: env.QQ_BOT_SECRET }),
        enabled: true,
      })
      seeded = true
      logger.info('Migrated QQ channel config from env to database')
    }

    // Migrate WeCom
    if (env.WECOM_CORP_ID && env.WECOM_CORP_SECRET && env.WECOM_AGENT_ID && env.WECOM_TOKEN && env.WECOM_ENCODING_AES_KEY) {
      createChannelRecord({
        id: 'wecom',
        type: 'wecom',
        label: 'WeCom',
        config: JSON.stringify({
          corpId: env.WECOM_CORP_ID,
          corpSecret: env.WECOM_CORP_SECRET,
          agentId: env.WECOM_AGENT_ID,
          token: env.WECOM_TOKEN,
          encodingAESKey: env.WECOM_ENCODING_AES_KEY,
        }),
        enabled: true,
      })
      seeded = true
      logger.info('Migrated WeCom channel config from env to database')
    }

    // Migrate DingTalk
    if (env.DINGTALK_CLIENT_ID && env.DINGTALK_SECRET) {
      createChannelRecord({
        id: 'dingtalk',
        type: 'dingtalk',
        label: 'DingTalk',
        config: JSON.stringify({ appKey: env.DINGTALK_CLIENT_ID, appSecret: env.DINGTALK_SECRET }),
        enabled: true,
      })
      seeded = true
      logger.info('Migrated DingTalk channel config from env to database')
    }

    if (seeded) {
      logger.info('Channel configs migrated to database; env vars can now be removed')
    }
  }

  /**
   * Create a new channel
   */
  async createChannel(opts: {
    id?: string
    type: string
    label: string
    config: Record<string, unknown>
    enabled?: boolean
  }): Promise<ChannelRecord> {
    // Validate type
    if (!CHANNEL_TYPE_REGISTRY[opts.type]) {
      throw new Error(`Unknown channel type: ${opts.type}`)
    }

    // Validate config
    const validation = validateChannelConfig(opts.type, opts.config)
    if (!validation.success) {
      throw new Error(`Config validation failed: ${validation.error}`)
    }

    const id = opts.id || `${opts.type}-${Math.random().toString(36).slice(2, 8)}`

    // Check ID uniqueness
    if (getChannelRecord(id)) {
      throw new Error(`Channel ID "${id}" already exists`)
    }

    const record = createChannelRecord({
      id,
      type: opts.type,
      label: opts.label,
      config: JSON.stringify(opts.config),
      enabled: opts.enabled !== false,
    })

    // Auto-connect if enabled
    if (record.enabled) {
      try {
        await this.startChannel(record, { autoConnect: true })
      } catch (err) {
        getLogger().error({ channelId: id, error: err instanceof Error ? err.message : String(err) }, 'Newly created channel failed to connect')
      }
    }

    return record
  }

  /**
   * Update channel config (triggers hot reconnect)
   */
  async updateChannel(id: string, opts: {
    label?: string
    config?: Record<string, unknown>
    enabled?: boolean
  }): Promise<ChannelRecord> {
    const existing = getChannelRecord(id)
    if (!existing) {
      throw new Error(`Channel "${id}" does not exist`)
    }

    // Merge then validate if config is updated (prevent partial update from losing other fields)
    let configToSave: string | undefined
    if (opts.config) {
      const existingConfig = JSON.parse(existing.config) as Record<string, unknown>
      const mergedConfig = { ...existingConfig, ...opts.config }
      const validation = validateChannelConfig(existing.type, mergedConfig)
      if (!validation.success) {
        throw new Error(`Config validation failed: ${validation.error}`)
      }
      configToSave = JSON.stringify(mergedConfig)
    }

    // Update database
    const record = updateChannelRecord(id, {
      label: opts.label,
      config: configToSave,
      enabled: opts.enabled,
    })

    if (!record) {
      throw new Error(`Failed to update channel "${id}"`)
    }

    // Hot reload: disconnect old -> create new connection
    const managed = this.managed.get(id)
    if (managed) {
      await this.stopChannel(id)
    }

    if (record.enabled) {
      try {
        await this.startChannel(record, { autoConnect: true })
      } catch (err) {
        getLogger().error({ channelId: id, error: err instanceof Error ? err.message : String(err) }, 'Channel hot reconnect failed')
      }
    }

    return record
  }

  /**
   * Delete a channel
   */
  async deleteChannel(id: string): Promise<void> {
    const managed = this.ensureChannelInstance(id)
    if (managed.instance?.logout) {
      await managed.instance.logout()
    }
    await this.stopChannel(id)
    deleteChannelRecord(id)
  }

  /**
   * Manually connect a channel
   */
  async connectChannel(id: string): Promise<void> {
    const record = getChannelRecord(id)
    if (!record) throw new Error(`Channel "${id}" does not exist`)

    const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)
    if (instance.getAuthStatus) {
      const authStatus = await instance.getAuthStatus()
      if (authStatus.supportsQrLogin && !authStatus.loggedIn) {
        throw new Error(`Channel "${id}" requires login before connecting`)
      }
    }

    // Disconnect existing connection first
    await this.stopChannel(id)
    await this.startChannel(record, { autoConnect: false })
  }

  /**
   * Manually disconnect a channel
   */
  async disconnectChannel(id: string): Promise<void> {
    await this.stopChannel(id)
  }

  async startQrLogin(id: string, params?: { force?: boolean; timeoutMs?: number; verbose?: boolean }): Promise<ChannelLoginStartResult> {
    const managed = this.ensureChannelInstance(id)
    if (!managed.instance?.loginWithQrStart) {
      throw new Error(`Channel "${id}" does not support QR login`)
    }
    return await managed.instance.loginWithQrStart(params)
  }

  async waitQrLogin(id: string, params?: { timeoutMs?: number }): Promise<ChannelLoginWaitResult> {
    const managed = this.ensureChannelInstance(id)
    if (!managed.instance?.loginWithQrWait) {
      throw new Error(`Channel "${id}" does not support QR login`)
    }

    const result = await managed.instance.loginWithQrWait(params)
    const record = getChannelRecord(id)
    if (!record) {
      return result
    }

    if (result.accountId !== undefined) {
      const existingConfig = JSON.parse(record.config) as Record<string, unknown>
      const mergedConfig = { ...existingConfig, accountId: result.accountId }
      const validation = validateChannelConfig(record.type, mergedConfig)
      if (!validation.success) {
        throw new Error(`Config validation failed: ${validation.error}`)
      }
      const updated = updateChannelRecord(id, { config: JSON.stringify(mergedConfig) })
      if (!updated) {
        throw new Error(`Failed to persist QR login result for channel "${id}"`)
      }
      managed.record = updated
    }

    if (result.connected && record.enabled) {
      await this.connectChannel(id)
    }

    return result
  }

  async logoutChannel(id: string): Promise<{ cleared: boolean; message?: string }> {
    const managed = this.ensureChannelInstance(id)
    if (!managed.instance?.logout) {
      throw new Error(`Channel "${id}" does not support logout`)
    }

    const result = await managed.instance.logout()
    await this.stopChannel(id)

    const record = getChannelRecord(id)
    if (record) {
      const existingConfig = JSON.parse(record.config) as Record<string, unknown>
      const mergedConfig = { ...existingConfig, accountId: '' }
      const validation = validateChannelConfig(record.type, mergedConfig)
      if (!validation.success) {
        throw new Error(`Config validation failed: ${validation.error}`)
      }
      updateChannelRecord(id, { config: JSON.stringify(mergedConfig) })
    }

    return result
  }

  async getChannelAuthStatus(id: string): Promise<ChannelAuthStatus> {
    const managed = this.ensureChannelInstance(id)
    if (!managed.instance?.getAuthStatus) {
      return {
        supportsQrLogin: false,
        loggedIn: false,
        connected: managed.instance?.isConnected() ?? false,
      }
    }
    return await managed.instance.getAuthStatus()
  }

  /**
   * Get all channel statuses
   */
  getStatuses(): ChannelStatus[] {
    const records = getChannelRecords()
    return records.map((record) => {
      const managed = this.managed.get(record.id)
      const config = JSON.parse(record.config) as Record<string, unknown>
      const { configuredFields } = maskSecretFields(record.type, config)

      return {
        id: record.id,
        type: record.type,
        label: record.label,
        connected: managed?.instance?.isConnected() ?? false,
        enabled: !!record.enabled,
        error: managed?.lastError,
        configuredFields,
      }
    })
  }

  /**
   * Get channel instance (used by webhook routing)
   */
  getChannelInstance(id: string): Channel | null {
    return this.managed.get(id)?.instance ?? null
  }

  getChannelForChat(chatId: string): Channel | null {
    for (const managed of this.managed.values()) {
      const instance = managed.instance
      if (instance?.ownsChatId(chatId)) {
        return instance
      }
    }
    return null
  }

  /**
   * Disconnect all channels
   */
  async disconnectAll(): Promise<void> {
    const ids = [...this.managed.keys()]
    for (const id of ids) {
      await this.stopChannel(id)
    }
  }

  private ensureChannelInstance(id: string): ManagedChannel {
    const existing = this.managed.get(id)
    if (existing?.instance) {
      return existing
    }

    const record = getChannelRecord(id)
    if (!record) {
      throw new Error(`Channel "${id}" does not exist`)
    }

    const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)
    const managed: ManagedChannel = existing ?? {
      record,
      instance,
      retryCount: 0,
      retryTimer: null,
    }
    managed.record = record
    managed.instance = instance
    this.managed.set(id, managed)
    return managed
  }

  /**
   * Start a single channel (create instance + connect + register with router)
   */
  private async startChannel(record: ChannelRecord, opts?: { autoConnect?: boolean }): Promise<void> {
    const logger = getLogger()

    const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)

    const managed: ManagedChannel = {
      record,
      instance,
      retryCount: 0,
      retryTimer: null,
    }
    this.managed.set(record.id, managed)

    if (opts?.autoConnect && instance.getAuthStatus) {
      try {
        const authStatus = await instance.getAuthStatus()
        if (authStatus.supportsQrLogin && !authStatus.loggedIn) {
          managed.lastError = undefined
          logger.info({ channelId: record.id, type: record.type }, 'Channel login required before auto-connect; leaving disconnected')
          return
        }
      } catch (err) {
        logger.warn({ channelId: record.id, error: err instanceof Error ? err.message : String(err) }, 'Failed to determine channel auth status before auto-connect')
      }
    }

    // Connect asynchronously, don't block startup
    instance.connect().then(() => {
      this.router.addChannel(instance)
      managed.retryCount = 0
      managed.lastError = undefined
      logger.info({ channelId: record.id, type: record.type }, 'Channel connected')
    }).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      managed.lastError = errMsg
      logger.error({ channelId: record.id, error: errMsg }, 'Channel connection failed')
      this.scheduleRetry(record.id)
    })
  }

  /**
   * Stop a single channel (disconnect + remove from router)
   */
  private async stopChannel(id: string): Promise<void> {
    const managed = this.managed.get(id)
    if (!managed) return

    // Clear retry timer
    if (managed.retryTimer) {
      clearTimeout(managed.retryTimer)
      managed.retryTimer = null
    }

    // Disconnect
    if (managed.instance) {
      try {
        await managed.instance.disconnect()
      } catch (err) {
        getLogger().warn({ channelId: id, error: err instanceof Error ? err.message : String(err) }, 'Error while disconnecting channel')
      }
      this.router.removeChannel(managed.instance.name)
    }

    this.managed.delete(id)
  }

  /**
   * Auto-retry on connection failure (exponential backoff)
   */
  private scheduleRetry(id: string): void {
    const managed = this.managed.get(id)
    if (!managed) return

    if (managed.lastError?.includes('not logged in') || managed.lastError?.includes('not configured')) {
      getLogger().info({ channelId: id }, 'Channel retry skipped until configuration is completed')
      return
    }

    if (managed.retryCount >= MAX_RETRIES) {
      getLogger().warn({ channelId: id, retries: managed.retryCount }, 'Channel retry attempts exhausted')
      return
    }

    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, managed.retryCount), MAX_RETRY_DELAY)
    managed.retryCount++

    getLogger().info({ channelId: id, retryCount: managed.retryCount, delayMs: delay }, 'Channel will retry after delay')

    managed.retryTimer = setTimeout(async () => {
      const current = this.managed.get(id)
      if (!current) return // already stopped

      // Re-read latest record from database
      const record = getChannelRecord(id)
      if (!record || !record.enabled) return

      try {
        const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)
        current.instance = instance
        current.record = record
        if (instance.getAuthStatus) {
          const authStatus = await instance.getAuthStatus()
          if (authStatus.supportsQrLogin && !authStatus.loggedIn) {
            current.lastError = undefined
            getLogger().info({ channelId: id }, 'Channel retry skipped until login is completed')
            return
          }
        }
        await instance.connect()
        this.router.addChannel(instance)
        current.retryCount = 0
        current.lastError = undefined
        getLogger().info({ channelId: id }, 'Channel retry connected successfully')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        current.lastError = errMsg
        getLogger().error({ channelId: id, error: errMsg }, 'Channel retry connection failed')
        this.scheduleRetry(id)
      }
    }, delay)
  }
}
