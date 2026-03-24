import { describe, test, expect } from 'bun:test'
import { WechatPersonalChannel } from './wechat-personal.ts'

// Helper to build a channel with no real account
function createChannel(config: { accountId?: string; cdnBaseUrl?: string } = {}) {
  const messages: Array<{ chatId: string; sender: string; content: string }> = []
  const channel = new WechatPersonalChannel(config, {
    onMessage: (msg) => {
      messages.push({ chatId: msg.chatId, sender: msg.sender, content: msg.content })
    },
  })
  return { channel, messages }
}

describe('WechatPersonalChannel', () => {
  test('initial state is disconnected', () => {
    const { channel } = createChannel()
    expect(channel.isConnected()).toBe(false)
  })

  test('ownsChatId matches wxp: prefix', () => {
    const { channel } = createChannel()
    expect(channel.ownsChatId('wxp:acc1:user1')).toBe(true)
    expect(channel.ownsChatId('wxp:')).toBe(true)
    expect(channel.ownsChatId('tg:12345')).toBe(false)
    expect(channel.ownsChatId('web:abc')).toBe(false)
    expect(channel.ownsChatId('')).toBe(false)
  })

  test('connect throws when not logged in', async () => {
    const { channel } = createChannel()
    await expect(channel.connect()).rejects.toThrow()
  })

  test('connect throws with empty accountId', async () => {
    const { channel } = createChannel({ accountId: '' })
    await expect(channel.connect()).rejects.toThrow()
  })

  test('disconnect is safe when not connected', async () => {
    const { channel } = createChannel()
    await channel.disconnect()
    expect(channel.isConnected()).toBe(false)
  })

  test('getAuthStatus returns supportsQrLogin true', async () => {
    const { channel } = createChannel()
    const status = await channel.getAuthStatus()
    expect(status.supportsQrLogin).toBe(true)
    expect(status.loggedIn).toBe(false)
    expect(status.connected).toBe(false)
  })

  test('getAuthStatus with unconfigured accountId', async () => {
    const { channel } = createChannel({ accountId: 'nonexistent_account_id' })
    const status = await channel.getAuthStatus()
    expect(status.supportsQrLogin).toBe(true)
    // Account file does not exist, so not logged in
    expect(status.loggedIn).toBe(false)
  })

  test('logout clears state when no active account', async () => {
    const { channel } = createChannel()
    const result = await channel.logout()
    expect(result.cleared).toBe(true)
    expect(result.message).toBeDefined()
    expect(channel.isConnected()).toBe(false)
  })

  test('name defaults to wechat-personal', () => {
    const { channel } = createChannel()
    expect(channel.name).toBe('wechat-personal')
  })

  test('name can be overridden', () => {
    const { channel } = createChannel()
    channel.name = 'my-wechat'
    expect(channel.name).toBe('my-wechat')
  })

  test('sendMessage throws for invalid chatId prefix', async () => {
    const { channel } = createChannel()
    await expect(channel.sendMessage('tg:123', 'hello')).rejects.toThrow('Unsupported WeChat chatId')
  })

  test('sendMessage throws for malformed chatId', async () => {
    const { channel } = createChannel()
    await expect(channel.sendMessage('wxp:nocolon', 'hello')).rejects.toThrow('Malformed WeChat chatId')
  })
})
