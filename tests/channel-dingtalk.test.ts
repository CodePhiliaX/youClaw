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
  test('normal text', () => {
    expect(extractDingTalkTextContent('hello world')).toBe('hello world')
  })

  test('empty text', () => {
    expect(extractDingTalkTextContent('')).toBe('')
  })

  test('whitespace-only text', () => {
    expect(extractDingTalkTextContent('  \n  ')).toBe('')
  })
})

describe('stripDingTalkAtMention', () => {
  test('removes @bot', () => {
    expect(stripDingTalkAtMention('@Bot hello')).toBe('hello')
  })

  test('preserves other content', () => {
    expect(stripDingTalkAtMention('hello world')).toBe('hello world')
  })

  test('multiple mentions', () => {
    expect(stripDingTalkAtMention('@Bot1 @Bot2 text')).toBe('text')
  })

  test('empty text', () => {
    expect(stripDingTalkAtMention('')).toBe('')
  })
})

describe('chunkText', () => {
  test('short text returns a single chunk', () => {
    expect(chunkText('hello', 10)).toEqual(['hello'])
  })

  test('splits correctly', () => {
    expect(chunkText('abcdefghij', 3)).toEqual(['abc', 'def', 'ghi', 'j'])
  })

  test('evenly divisible', () => {
    expect(chunkText('abcdef', 3)).toEqual(['abc', 'def'])
  })

  test('empty string', () => {
    expect(chunkText('', 10)).toEqual([''])
  })
})

describe('isTokenValid', () => {
  test('valid token', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() }
    expect(isTokenValid(token)).toBe(true)
  })

  test('expired token', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - 8000000 }
    expect(isTokenValid(token)).toBe(false)
  })

  test('null token', () => {
    expect(isTokenValid(null)).toBe(false)
  })

  test('about to expire (within buffer)', () => {
    // token has 4 minutes left, buffer is 5 minutes
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - (7200 - 240) * 1000 }
    expect(isTokenValid(token)).toBe(false)
  })

  test('custom buffer', () => {
    const token = { access_token: 'abc', expires_in: 7200, fetchedAt: Date.now() - 7100 * 1000 }
    // 100s left, buffer 50s -> still valid
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

    // token request
    if (urlStr.includes('oauth2/accessToken')) {
      return new Response(JSON.stringify({ accessToken: 'test_token', expireIn: 7200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 1:1 message
    if (urlStr.includes('oToMessages')) {
      return new Response(JSON.stringify({ processQueryKey: 'pqk1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // group message
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
    test('1:1 message uses oToMessages URL', async () => {
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

      // verify header
      const headers = msgCall!.init?.headers as Record<string, string>
      expect(headers['x-acs-dingtalk-access-token']).toBe('test_token')

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.userIds).toEqual(['staff123'])
      expect(body.robotCode).toBe('appkey1')
    })

    test('group message uses groupMessages URL', async () => {
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

    test('4000 character chunking', async () => {
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

    test('auto-refreshes token when expired', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new DingTalkChannel('appkey1', 'secret1', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
        _streamClient: createMockStreamClient(),
      })

      // set expired token
      ;(channel as any).accessToken = { access_token: 'old_token', expires_in: 7200, fetchedAt: Date.now() - 8000000 }

      await channel.sendMessage('dingtalk:user:staff1', 'hello')

      const tokenCall = calls.find(c => c.url.includes('oauth2/accessToken'))
      expect(tokenCall).toBeDefined()
    })

    test('correct headers', async () => {
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
    test('dingtalk: prefix returns true', () => {
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      expect(channel.ownsChatId('dingtalk:user:staff1')).toBe(true)
      expect(channel.ownsChatId('dingtalk:group:conv1')).toBe(true)
    })

    test('non-dingtalk: prefix returns false', () => {
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
    test('initial state is false', () => {
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('EventBus integration', () => {
    test('eventBus subscription is cleaned up after disconnect', async () => {
      const eventBus = new EventBus()
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      // no eventBus subscription during construction
      expect(eventBus.subscriberCount).toBe(0)

      // disconnect should not throw
      await channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })

    test('manually simulated eventBus subscription is cleaned up after disconnect', async () => {
      const eventBus = new EventBus()
      const channel = new DingTalkChannel('k', 's', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
        _streamClient: createMockStreamClient(),
      })

      // manually simulate the subscription logic from connect
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
    test('does not send for unknown chatId format', async () => {
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
