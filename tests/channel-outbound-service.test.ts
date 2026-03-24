import { describe, test, expect, mock } from 'bun:test'
import { registerChannelOutboundService, sendToChat } from '../src/channel/outbound-service.ts'
import type { Channel } from '../src/channel/types.ts'

function createChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    name: 'mock-channel',
    connect: async () => {},
    sendMessage: async () => {},
    isConnected: () => true,
    ownsChatId: () => true,
    disconnect: async () => {},
    ...overrides,
  }
}

describe('channel outbound service', () => {
  test('routes text sends to channel.sendMessage', async () => {
    const sendMessage = mock(async () => {})
    registerChannelOutboundService({
      getChannelForChat: () => createChannel({ sendMessage }),
    } as any)

    const result = await sendToChat({ chatId: 'wxp:test:user@im.wechat', text: 'hello' })

    expect(result).toEqual({ ok: true, mode: 'text' })
    expect(sendMessage).toHaveBeenCalledWith('wxp:test:user@im.wechat', 'hello')
  })

  test('routes media sends to channel.sendMedia', async () => {
    const sendMedia = mock(async () => {})
    registerChannelOutboundService({
      getChannelForChat: () => createChannel({ sendMedia }),
    } as any)

    const result = await sendToChat({
      chatId: 'wxp:test:user@im.wechat',
      text: 'caption',
      mediaUrl: '/tmp/file.zip',
    })

    expect(result).toEqual({ ok: true, mode: 'media' })
    expect(sendMedia).toHaveBeenCalledWith('wxp:test:user@im.wechat', 'caption', '/tmp/file.zip')
  })
})
