import { TelegramChannel } from './telegram.ts'
import { FeishuChannel } from './feishu.ts'
import { QQChannel } from './qq.ts'
import { WeComChannel } from './wecom.ts'
import { DingTalkChannel } from './dingtalk.ts'
import { WechatOAChannel } from './wechat-oa.ts'
import { WechatPersonalChannel } from './wechat-personal.ts'
import type { Channel, OnInboundMessage } from './types.ts'
import type { ChannelRecord } from '../db/index.ts'
import type { EventBus } from '../events/bus.ts'

/**
 * Create a Channel instance from a database record
 */
export function createChannelFromRecord(record: ChannelRecord, onMessage: OnInboundMessage, eventBus?: EventBus): Channel {
  const config: Record<string, string> = JSON.parse(record.config)

  switch (record.type) {
    case 'telegram': {
      const channel = new TelegramChannel(config.botToken!, { onMessage })
      // Use record.id as name (supports multi-account distinction)
      channel.name = record.id
      return channel
    }
    case 'feishu': {
      const channel = new FeishuChannel(config.appId!, config.appSecret!, { onMessage, eventBus })
      channel.name = record.id
      return channel
    }
    case 'qq': {
      const channel = new QQChannel(config.botAppId!, config.botSecret!, { onMessage, eventBus })
      channel.name = record.id
      return channel
    }
    case 'wecom': {
      const channel = new WeComChannel(
        config.corpId!, config.corpSecret!, config.agentId!,
        config.token!, config.encodingAESKey!,
        { onMessage },
      )
      channel.name = record.id
      return channel
    }
    case 'dingtalk': {
      const channel = new DingTalkChannel(config.appKey!, config.appSecret!, { onMessage, eventBus })
      channel.name = record.id
      return channel
    }
    case 'wechat-oa': {
      const channel = new WechatOAChannel({ onMessage })
      channel.name = record.id
      return channel
    }
    case 'wechat-personal': {
      const channel = new WechatPersonalChannel(config, { onMessage, channelId: record.id })
      channel.name = record.id
      return channel
    }
    default:
      throw new Error(`Unsupported channel type: ${record.type}`)
  }
}
