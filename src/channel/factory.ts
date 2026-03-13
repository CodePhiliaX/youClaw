import { TelegramChannel } from './telegram.ts'
import { FeishuChannel } from './feishu.ts'
import type { Channel, OnInboundMessage } from './types.ts'
import type { ChannelRecord } from '../db/index.ts'
import type { EventBus } from '../events/bus.ts'

/**
 * 根据数据库记录创建 Channel 实例
 */
export function createChannelFromRecord(record: ChannelRecord, onMessage: OnInboundMessage, eventBus?: EventBus): Channel {
  const config: Record<string, string> = JSON.parse(record.config)

  switch (record.type) {
    case 'telegram': {
      const channel = new TelegramChannel(config.botToken!, { onMessage })
      // 用 record.id 作为 name（支持多账号区分）
      channel.name = record.id
      return channel
    }
    case 'feishu': {
      const channel = new FeishuChannel(config.appId!, config.appSecret!, { onMessage, eventBus })
      channel.name = record.id
      return channel
    }
    default:
      throw new Error(`不支持的 channel 类型: ${record.type}`)
  }
}
