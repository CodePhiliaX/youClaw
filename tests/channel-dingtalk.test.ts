import '../tests/setup-light.ts'
import { describe, test, expect, mock } from 'bun:test'
import {
  extractDingTalkTextContent, stripDingTalkAtMention,
  chunkText, isTokenValid, DingTalkChannel,
} from '../src/channel/dingtalk.ts'
import { EventBus } from '../src/events/bus.ts'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('extractDingTalkTextContent', () => {
  test('正常文本', () => {
    expect(extractDingTalkTextContent('hello world')).toBe('hello world')
  })

  test('空文本', () => {
    expect(extractDingTalkTextContent('')).toBe('')
  })

  test('空白文本', () => {
    expect(extractDingTalkTextContent('  \n  ')).toBe('')
  })
})

describe('stripDingTalkAtMention', () => {
  test('去除 @bot', () => {
    expect(stripDingTalkAtMention('@Bot hello')).toBe('hello')
  })

  test('保留其他内容', () => {
    expect(stripDingTalkAtMention('hello world')).toBe('hello world')
  })

  test('多个提及', () => {
    expect(stripDingTalkAtMention('@Bot1 @Bot2 text')).toBe('text')
  })

  test('空文本', () => {
    expect(stripDingTalkAtMention('')).toBe('')
  })
})

describe('chunkText', () => {
  test('短文本返回单个分片', () => {
    expect(chunkText('hello', 10)).toEqual(['hello'])
  })

  test('正确拆分', () => {
    expect(chunkText('abcdefghij', 3)).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  test('恰好整除', () => {
    expect(chunkText('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('空字符串', () => {
    expect(chunkText('', 10)).toEqual([''])
  })
})

describe('isTokenValid', () => {
  test('有效 token', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() }
    expect(isTokenValid(token)).toBe(true)
  })

  test('过期 token', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - 8000000 }
    expect(isTokenValid(token)).toBe(false)
  })

  test('null token', () => {
    expect(isTokenValid(null)).toBe(false)
  })

  test('即将过期（在 buffer 内）', () => {
    // token 还有 4 分钟过期，buffer 是 5 分钟
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - (7200 - 240) * 1000 }
    expect(isTokenValid(token)).toBe(false)
  })

  test('自定义 buffer', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - 7100 * 1000 }
    // 100s left, buffer 50s → still valid
    expect(isTokenValid(token, 50000)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DingTalkChannel integration tests (mock fetch + mock stream client)
// ---------------------------------------------------------------------------

function createMockFetch() {
  const calls: { url: string; init?: RequestInit }[] = []

  const mockFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString()
    calls.push({ url: urlStr, init })

    // token 请求
    if (urlStr.includes('oauth2/accessToken')) {
      return new Response(JSON.stringify({ accessToken: 'test_token', expireIn: 7200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 1:1 消息
    if (urlStr.includes('oToMessages')) {
      return new Response(JSON.stringify({ processQueryKey: 'pqk1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 群聊消息
    if (urlStr.includes('groupMessages')) {
      return new Response(JSON.stringify({ processQueryKey: 'pqk2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }) as any

  return { fetch: mockFetch, calls }
}

function createMockStreamClient() {
  return {
    start: mock(async () => {}),
    registerCallbackListener: mock(() => {}),
  }
}

describe('DingTalkChannel', () => {
  describe('sendMessage', () => {
    test('1:1 消息使用 oToMessages URL', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('dingtalk:user:staff123', 'hello')

      const msgCall = calls.find(c => c.url.includes('oToMessages'))
      expect(msgCall).toBeDefined()
      expect(msgCall!.init?.method).toBe('POST')

      // 验证 header
      const headers = msgCall!.init?.headers as Record<string, string>
      expect(headers['x-acs-dingtalk-access-token']).toBe('test_token')

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.userIds).toEqual(['staff123'])
      expect(body.robotCode).toBe('appkey1')
    })

    test('群聊消息使用 groupMessages URL', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('dingtalk:group:conv456', 'group hello')

      const msgCall = calls.find(c => c.url.includes('groupMessages'))
      expect(msgCall).toBeDefined()

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.openConversationId).toBe('conv456')
      expect(body.robotCode).toBe('appkey1')
    })

    test('4000 字符分片', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      const longText = 'x'.repeat(4001)
      await channel.sendMessage('dingtalk:user:staff1', longText)

      const msgCalls = calls.filter(c => c.url.includes('oToMessages'))
      expect(msgCalls.length).toBe(2)
    })

    test('token 过期时自动刷新', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      // 设置过期 token
      ;(channel as any).accessToken = { access_token: 'old_token', expires_in: 7200, fetchedAt: Date.now() - 8000000 }

      await channel.sendMessage('dingtalk:user:staff1', 'hello')

      const tokenCall = calls.find(c => c.url.includes('oauth2/accessToken'))
      expect(tokenCall).toBeDefined()
    })

    test('正确的 header', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      ;(channel as any).accessToken = { access_token: 'my_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('dingtalk:user:staff1', 'hello')

      const msgCall = calls.find(c => c.url.includes('oToMessages'))
      const headers = msgCall!.init?.headers as Record<string, string>
      expect(headers['x-acs-dingtalk-access-token']).toBe('my_token')
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('ownsChatId', () => {
    test('dingtalk: 前缀返回 true', () => {
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      expect(channel.ownsChatId('dingtalk:user:staff1')).toBe(true)
      expect(channel.ownsChatId('dingtalk:group:conv1')).toBe(true)
    })

    test('非 dingtalk: 前缀返回 false', () => {
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      expect(channel.ownsChatId('tg:123')).toBe(false)
      expect(channel.ownsChatId('wecom:user1')).toBe(false)
      expect(channel.ownsChatId('qq:c2c:user1')).toBe(false)
    })
  })

  describe('isConnected', () => {
    test('初始状态为 false', () => {
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('EventBus integration', () => {
    test('eventBus 订阅在 disconnect 后清理', async () => {
      const eventBus = new EventBus()
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      // 构造阶段不订阅 eventBus
      expect(eventBus.subscriberCount).toBe(0)

      // disconnect 不应抛异常
      await channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })

    test('手动模拟 eventBus 订阅后 disconnect 清理', async () => {
      const eventBus = new EventBus()
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      // 手动模拟 connect 中的订阅逻辑
      const unsub = eventBus.subscribe(
        { types: ['complete', 'error'] },
        () => {},
      )
      ;(channel as any).unsubscribeEvents = unsub

      expect(eventBus.subscriberCount).toBe(1)

      await channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })
  })

  describe('sendMessage edge cases', () => {
    test('未知 chatId 格式不发送', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('unknown:chat1', 'hello')

      const msgCalls = calls.filter(c => c.url.includes('oToMessages') || c.url.includes('groupMessages'))
      expect(msgCalls.length).toBe(0)
    })
  })
})
