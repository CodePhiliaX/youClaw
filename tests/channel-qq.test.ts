import '../tests/setup-light.ts'
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { extractQQTextContent, stripQQBotMention, chunkText, isTokenValid, QQChannel } from '../src/channel/qq.ts'
import { EventBus } from '../src/events/bus.ts'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('extractQQTextContent', () => {
  test('plain text', () => {
    expect(extractQQTextContent('hello world')).toBe('hello world')
  })

  test('empty text', () => {
    expect(extractQQTextContent('')).toBe('')
  })

  test('text with leading and trailing spaces', () => {
    expect(extractQQTextContent('  hello  ')).toBe('hello')
  })
})

describe('stripQQBotMention', () => {
  test('removes <@!botid>', () => {
    expect(stripQQBotMention('<@!abc123> hello')).toBe('hello')
  })

  test('preserves other content', () => {
    expect(stripQQBotMention('hello <@!bot> world')).toBe('hello  world')
  })

  test('returns as-is when no @mention present', () => {
    expect(stripQQBotMention('hello world')).toBe('hello world')
  })

  test('empty content', () => {
    expect(stripQQBotMention('')).toBe('')
  })

  test('multiple @mentions', () => {
    expect(stripQQBotMention('<@!a> <@!b> text')).toBe('text')
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
    // 100s left, buffer 50s → still valid
    expect(isTokenValid(token, 50000)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// QQChannel integration tests (mock fetch injection)
// ---------------------------------------------------------------------------

function createMockFetch(responses?: Record<string, any>) {
  const calls: { url: string; init?: RequestInit }[] = []

  const mockFetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString()
    calls.push({ url: urlStr, init })

    // token request
    if (urlStr.includes('getAppAccessToken')) {
      return new Response(JSON.stringify({ access_token: 'test_token', expires_in: '7200' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // gateway request
    if (urlStr.includes('/gateway/bot')) {
      return new Response(JSON.stringify({ url: 'wss://mock.qq.com/ws' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // send message
    if (urlStr.includes('/messages')) {
      return new Response(JSON.stringify({ id: 'msg_resp_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // custom responses
    if (responses) {
      for (const [pattern, resp] of Object.entries(responses)) {
        if (urlStr.includes(pattern)) {
          return new Response(JSON.stringify(resp), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    }

    return new Response('Not Found', { status: 404 })
  }) as any

  return { fetch: mockFetch, calls }
}

describe('QQChannel', () => {
  describe('sendMessage', () => {
    test('C2C message uses correct URL', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // manually set token to skip connect
      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      // set recentMsgIds to simulate passive reply
      ;(channel as any).recentMsgIds.set('qq:c2c:user123', { msgId: 'msg1', msgSeq: 0 })

      await channel.sendMessage('qq:c2c:user123', 'hello')

      const msgCall = calls.find(c => c.url.includes('/v2/users/user123/messages'))
      expect(msgCall).toBeDefined()
      expect(msgCall!.init?.method).toBe('POST')

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.content).toBe('hello')
      expect(body.msg_type).toBe(0)
      expect(body.msg_id).toBe('msg1')
    })

    test('group message uses correct URL', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }
      ;(channel as any).recentMsgIds.set('qq:group:group456', { msgId: 'msg2', msgSeq: 0 })

      await channel.sendMessage('qq:group:group456', 'group hello')

      const msgCall = calls.find(c => c.url.includes('/v2/groups/group456/messages'))
      expect(msgCall).toBeDefined()

      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.content).toBe('group hello')
      expect(body.msg_id).toBe('msg2')
    })

    test('long message is sent in chunks', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }
      ;(channel as any).recentMsgIds.set('qq:c2c:user1', { msgId: 'msg1', msgSeq: 0 })

      const longText = 'x'.repeat(4001)
      await channel.sendMessage('qq:c2c:user1', longText)

      const msgCalls = calls.filter(c => c.url.includes('/messages'))
      expect(msgCalls.length).toBe(2)

      // verify msg_seq increments
      const body1 = JSON.parse(msgCalls[0].init?.body as string)
      const body2 = JSON.parse(msgCalls[1].init?.body as string)
      expect(body1.msg_seq).toBe(1)
      expect(body2.msg_seq).toBe(2)
    })

    test('auto-refreshes token when expired', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      // set an expired token
      ;(channel as any).accessToken = { access_token: 'old_token', expires_in: 7200, fetchedAt: Date.now() - 8000000 }
      ;(channel as any).recentMsgIds.set('qq:c2c:user1', { msgId: 'msg1', msgSeq: 0 })

      await channel.sendMessage('qq:c2c:user1', 'hello')

      // should refresh token first, then send message
      const tokenCall = calls.find(c => c.url.includes('getAppAccessToken'))
      expect(tokenCall).toBeDefined()
    })
  })

  describe('ownsChatId', () => {
    test('qq: prefix returns true', () => {
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
      })

      expect(channel.ownsChatId('qq:c2c:user1')).toBe(true)
      expect(channel.ownsChatId('qq:group:g1')).toBe(true)
    })

    test('non-qq: prefix returns false', () => {
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
      })

      expect(channel.ownsChatId('tg:123')).toBe(false)
      expect(channel.ownsChatId('feishu:chat1')).toBe(false)
      expect(channel.ownsChatId('web:uuid')).toBe(false)
    })
  })

  describe('isConnected', () => {
    test('initial state is false', () => {
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mock(async () => new Response()) as any,
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('EventBus integration', () => {
    test('eventBus subscription is cleaned up after disconnect', async () => {
      const eventBus = new EventBus()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
      })

      // no eventBus subscription during construction
      expect(eventBus.subscriberCount).toBe(0)

      // disconnect should not throw
      await channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })

    test('manually simulated eventBus subscription is cleaned up after disconnect', async () => {
      const eventBus = new EventBus()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        eventBus,
        _fetchFn: mock(async () => new Response()) as any,
      })

      // manually simulate the subscription logic from connect
      const unsub = eventBus.subscribe(
        { types: ['complete', 'error'] },
        () => {}
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
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }

      await channel.sendMessage('unknown:chat1', 'hello')

      const msgCalls = calls.filter(c => c.url.includes('/messages'))
      expect(msgCalls.length).toBe(0)
    })

    test('does not include msg_id when no recentMsgId exists', async () => {
      const { fetch: mockFetch, calls } = createMockFetch()
      const channel = new QQChannel('appid', 'secret', {
        onMessage: mock(() => {}),
        _fetchFn: mockFetch,
      })

      ;(channel as any).accessToken = { access_token: 'test_token', expires_in: 7200, fetchedAt: Date.now() }
      // do not set recentMsgIds

      await channel.sendMessage('qq:c2c:user1', 'hello')

      const msgCall = calls.find(c => c.url.includes('/messages'))
      expect(msgCall).toBeDefined()
      const body = JSON.parse(msgCall!.init?.body as string)
      expect(body.msg_id).toBeUndefined()
    })
  })
})
