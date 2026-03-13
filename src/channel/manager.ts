import { getLogger } from '../logger/index.ts'
import { validateChannelConfig, maskSecretFields, CHANNEL_TYPE_REGISTRY } from './config-schema.ts'
import { createChannelFromRecord } from './factory.ts'
import {
  createChannelRecord, getChannelRecords, getChannelRecord,
  updateChannelRecord, deleteChannelRecord,
} from '../db/index.ts'
import type { ChannelRecord } from '../db/index.ts'
import type { Channel, OnInboundMessage, ChannelStatus } from './types.ts'
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
   * 从数据库加载所有 enabled 的 channel 并连接
   */
  async loadFromDatabase(): Promise<void> {
    const logger = getLogger()
    const records = getChannelRecords()

    for (const record of records) {
      if (!record.enabled) continue

      try {
        await this.startChannel(record)
      } catch (err) {
        logger.error({ channelId: record.id, error: err instanceof Error ? err.message : String(err) }, 'Channel 启动失败')
      }
    }

    logger.info({ count: this.managed.size }, 'Channels 加载完成')
  }

  /**
   * 首次启动时从 env 迁移到数据库（向后兼容）
   */
  async seedFromEnv(env: EnvConfig): Promise<void> {
    const logger = getLogger()
    const existing = getChannelRecords()

    // 如果数据库已有 channel 记录，跳过迁移
    if (existing.length > 0) return

    let seeded = false

    // 迁移 Telegram
    if (env.TELEGRAM_BOT_TOKEN) {
      createChannelRecord({
        id: 'telegram',
        type: 'telegram',
        label: 'Telegram',
        config: JSON.stringify({ botToken: env.TELEGRAM_BOT_TOKEN }),
        enabled: true,
      })
      seeded = true
      logger.info('已从 env 迁移 Telegram channel 配置到数据库')
    }

    // 迁移飞书
    if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET) {
      createChannelRecord({
        id: 'feishu',
        type: 'feishu',
        label: 'Feishu / Lark',
        config: JSON.stringify({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET }),
        enabled: true,
      })
      seeded = true
      logger.info('已从 env 迁移飞书 channel 配置到数据库')
    }

    if (seeded) {
      logger.info('Channel 配置已迁移到数据库，后续可从环境变量中移除 TELEGRAM_BOT_TOKEN / FEISHU_APP_ID / FEISHU_APP_SECRET')
    }
  }

  /**
   * 创建新 channel
   */
  async createChannel(opts: {
    id?: string
    type: string
    label: string
    config: Record<string, unknown>
    enabled?: boolean
  }): Promise<ChannelRecord> {
    // 校验类型
    if (!CHANNEL_TYPE_REGISTRY[opts.type]) {
      throw new Error(`未知的 channel 类型: ${opts.type}`)
    }

    // 校验配置
    const validation = validateChannelConfig(opts.type, opts.config)
    if (!validation.success) {
      throw new Error(`配置校验失败: ${validation.error}`)
    }

    const id = opts.id || `${opts.type}-${Math.random().toString(36).slice(2, 8)}`

    // 检查 ID 唯一
    if (getChannelRecord(id)) {
      throw new Error(`Channel ID "${id}" 已存在`)
    }

    const record = createChannelRecord({
      id,
      type: opts.type,
      label: opts.label,
      config: JSON.stringify(opts.config),
      enabled: opts.enabled !== false,
    })

    // 如果启用，自动连接
    if (record.enabled) {
      try {
        await this.startChannel(record)
      } catch (err) {
        getLogger().error({ channelId: id, error: err instanceof Error ? err.message : String(err) }, '新创建的 channel 连接失败')
      }
    }

    return record
  }

  /**
   * 更新 channel 配置（触发热重连）
   */
  async updateChannel(id: string, opts: {
    label?: string
    config?: Record<string, unknown>
    enabled?: boolean
  }): Promise<ChannelRecord> {
    const existing = getChannelRecord(id)
    if (!existing) {
      throw new Error(`Channel "${id}" 不存在`)
    }

    // 如果更新了 config，先合并再校验（避免部分更新丢失其他字段）
    let configToSave: string | undefined
    if (opts.config) {
      const existingConfig = JSON.parse(existing.config) as Record<string, unknown>
      const mergedConfig = { ...existingConfig, ...opts.config }
      const validation = validateChannelConfig(existing.type, mergedConfig)
      if (!validation.success) {
        throw new Error(`配置校验失败: ${validation.error}`)
      }
      configToSave = JSON.stringify(mergedConfig)
    }

    // 更新数据库
    const record = updateChannelRecord(id, {
      label: opts.label,
      config: configToSave,
      enabled: opts.enabled,
    })

    if (!record) {
      throw new Error(`更新 channel "${id}" 失败`)
    }

    // 热重载：断开旧连接 -> 重新创建连接
    const managed = this.managed.get(id)
    if (managed) {
      await this.stopChannel(id)
    }

    if (record.enabled) {
      try {
        await this.startChannel(record)
      } catch (err) {
        getLogger().error({ channelId: id, error: err instanceof Error ? err.message : String(err) }, 'Channel 热重连失败')
      }
    }

    return record
  }

  /**
   * 删除 channel
   */
  async deleteChannel(id: string): Promise<void> {
    await this.stopChannel(id)
    deleteChannelRecord(id)
  }

  /**
   * 手动连接
   */
  async connectChannel(id: string): Promise<void> {
    const record = getChannelRecord(id)
    if (!record) throw new Error(`Channel "${id}" 不存在`)

    // 先断开已有连接
    await this.stopChannel(id)
    await this.startChannel(record)
  }

  /**
   * 手动断开
   */
  async disconnectChannel(id: string): Promise<void> {
    await this.stopChannel(id)
  }

  /**
   * 获取所有 channel 状态
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
   * 关闭所有 channel
   */
  async disconnectAll(): Promise<void> {
    const ids = [...this.managed.keys()]
    for (const id of ids) {
      await this.stopChannel(id)
    }
  }

  /**
   * 启动单个 channel（创建实例 + 连接 + 注册到 router）
   */
  private async startChannel(record: ChannelRecord): Promise<void> {
    const logger = getLogger()

    const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)

    const managed: ManagedChannel = {
      record,
      instance,
      retryCount: 0,
      retryTimer: null,
    }
    this.managed.set(record.id, managed)

    // 异步连接，不阻塞启动流程
    instance.connect().then(() => {
      this.router.addChannel(instance)
      managed.retryCount = 0
      managed.lastError = undefined
      logger.info({ channelId: record.id, type: record.type }, 'Channel 已连接')
    }).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      managed.lastError = errMsg
      logger.error({ channelId: record.id, error: errMsg }, 'Channel 连接失败')
      this.scheduleRetry(record.id)
    })
  }

  /**
   * 停止单个 channel（断开 + 从 router 移除）
   */
  private async stopChannel(id: string): Promise<void> {
    const managed = this.managed.get(id)
    if (!managed) return

    // 清除重试定时器
    if (managed.retryTimer) {
      clearTimeout(managed.retryTimer)
      managed.retryTimer = null
    }

    // 断开连接
    if (managed.instance) {
      try {
        await managed.instance.disconnect()
      } catch (err) {
        getLogger().warn({ channelId: id, error: err instanceof Error ? err.message : String(err) }, 'Channel 断开时出错')
      }
      this.router.removeChannel(managed.instance.name)
    }

    this.managed.delete(id)
  }

  /**
   * 连接失败自动重试（指数退避）
   */
  private scheduleRetry(id: string): void {
    const managed = this.managed.get(id)
    if (!managed) return

    if (managed.retryCount >= MAX_RETRIES) {
      getLogger().warn({ channelId: id, retries: managed.retryCount }, 'Channel 重试次数已用完')
      return
    }

    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, managed.retryCount), MAX_RETRY_DELAY)
    managed.retryCount++

    getLogger().info({ channelId: id, retryCount: managed.retryCount, delayMs: delay }, 'Channel 将在延迟后重试连接')

    managed.retryTimer = setTimeout(async () => {
      const current = this.managed.get(id)
      if (!current) return // 已被停止

      // 重新从数据库读取最新记录
      const record = getChannelRecord(id)
      if (!record || !record.enabled) return

      try {
        const instance = createChannelFromRecord(record, this.onMessage, this.eventBus ?? undefined)
        current.instance = instance
        current.record = record
        await instance.connect()
        this.router.addChannel(instance)
        current.retryCount = 0
        current.lastError = undefined
        getLogger().info({ channelId: id }, 'Channel 重试连接成功')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        current.lastError = errMsg
        getLogger().error({ channelId: id, error: errMsg }, 'Channel 重试连接失败')
        this.scheduleRetry(id)
      }
    }, delay)
  }
}
