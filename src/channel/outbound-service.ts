import { getLogger } from '../logger/index.ts'
import type { ChannelManager } from './manager.ts'

let channelManagerRef: ChannelManager | null = null

function logInfo(message: string, extra: Record<string, unknown>): void {
  try {
    getLogger().info(extra, message)
  } catch {
    // Logger is not always initialized in isolated unit tests.
  }
}

export function registerChannelOutboundService(channelManager: ChannelManager): void {
  channelManagerRef = channelManager
}

export async function sendToChat(params: {
  chatId: string
  text?: string
  mediaUrl?: string
}): Promise<{ ok: true; mode: 'text' | 'media' }> {
  const { chatId, text = '', mediaUrl } = params
  const manager = channelManagerRef
  if (!manager) {
    throw new Error('Channel outbound service is not initialized')
  }

  const channel = manager.getChannelForChat(chatId)
  if (!channel) {
    throw new Error(`No connected channel found for chatId: ${chatId}`)
  }

  if (mediaUrl) {
    if (!channel.sendMedia) {
      throw new Error(`Channel "${channel.name}" does not support media sending`)
    }
    await channel.sendMedia(chatId, text, mediaUrl)
    logInfo('Outbound media sent via channel service', { chatId, channel: channel.name, mediaUrl })
    return { ok: true, mode: 'media' }
  }

  await channel.sendMessage(chatId, text)
  logInfo('Outbound text sent via channel service', { chatId, channel: channel.name })
  return { ok: true, mode: 'text' }
}
