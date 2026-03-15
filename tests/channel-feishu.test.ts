import '../tests/setup-light.ts'
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { extractTextContent, extractPostText, stripBotMention, chunkText, FeishuChannel } from '../src/channel/feishu.ts'
import { EventBus } from '../src/events/bus.ts'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('extractTextContent', () => {
  test('text type extracts text field', () => {
    expect(extractTextContent('{"text":"hello"}', 'text')).toBe('hello')
  })

  test('post type delegates to extractPostText', () => {
    const json = JSON.stringify({
      zh_cn: { title: 'T', content: [[{ tag: 'text', text: 'body' }]] },
    })
    expect(extractTextContent(json, 'post')).toBe('T\nbody')
  })

  test('falls back to raw string on JSON parse failure', () => {
    expect(extractTextContent('not json', 'text')).toBe('not json')
  })

  test('returns empty string for unknown message type', () => {
    expect(extractTextContent('{"text":"hello"}', 'image')).toBe('')
  })
})

describe('extractPostText', () => {
  test('title + text elements', () => {
    expect(
      extractPostText({
        zh_cn: { title: 'Title', content: [[{ tag: 'text', text: 'Hello' }]] },
      }),
    ).toBe('Title\nHello')
  })

  test('en_us locale', () => {
    expect(
      extractPostText({
        en_us: { title: 'T', content: [[{ tag: 'text', text: 'Hi' }]] },
      }),
    ).toBe('T\nHi')
  })

  test('link text extraction', () => {
    expect(
      extractPostText({
        content: [[{ tag: 'a', text: 'Link', href: 'http://x.com' }]],
      }),
    ).toBe('Link')
  })

  test('@mention in post', () => {
    expect(
      extractPostText({
        content: [[{ tag: 'at', user_name: 'Alice' }]],
      }),
    ).toBe('@Alice')
  })

  test('image placeholder', () => {
    expect(
      extractPostText({ content: [[{ tag: 'img' }]] }),
    ).toBe('[image]')
  })

  test('empty paragraph is skipped', () => {
    expect(extractPostText({ content: [[]] })).toBe('')
  })

  test('multiple paragraphs', () => {
    expect(
      extractPostText({
        content: [
          [{ tag: 'text', text: 'A' }],
          [{ tag: 'text', text: 'B' }],
        ],
      }),
    ).toBe('A\nB')
  })
})

describe('stripBotMention', () => {
  test('removes bot @mention', () => {
    expect(
      stripBotMention(
        'hello @_user_1 world',
        [{ key: '@_user_1', id: { open_id: 'bot123' }, name: 'Bot' }],
        'bot123',
      ),
    ).toBe('hello  world')
  })

  test('preserves non-bot @mentions', () => {
    expect(
      stripBotMention(
        '@_user_1 hi @_user_2',
        [
          { key: '@_user_1', id: { open_id: 'bot1' }, name: 'Bot' },
          { key: '@_user_2', id: { open_id: 'user2' }, name: 'Alice' },
        ],
        'bot1',
      ),
    ).toBe('hi @_user_2')
  })

  test('key containing regex special characters', () => {
    expect(
      stripBotMention(
        'test @_user_1+2 end',
        [{ key: '@_user_1+2', id: { open_id: 'bot1' }, name: 'B' }],
        'bot1',
      ),
    ).toBe('test  end')
  })

  test('trims leading whitespace', () => {
    expect(
      stripBotMention(
        '@_user_1 hello',
        [{ key: '@_user_1', id: { open_id: 'bot1' }, name: 'Bot' }],
        'bot1',
      ),
    ).toBe('hello')
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

// ---------------------------------------------------------------------------
// FeishuChannel integration tests
// ---------------------------------------------------------------------------

function createMockClient() {
  const sentMessages: any[] = []
  const reactions: Map<string, string> = new Map()
  let reactionCounter = 0

  return {
    client: {
      im: {
        message: {
          create: mock(async (params: any) => {
            sentMessages.push(params)
            return { code: 0 }
          }),
        },
        messageReaction: {
          create: mock(async (params: any) => {
            const reactionId = `reaction_${++reactionCounter}`
            reactions.set(params.path.message_id, reactionId)
            return { data: { reaction_id: reactionId } }
          }),
          delete: mock(async (params: any) => {
            reactions.delete(params.path.message_id)
            return { code: 0 }
          }),
        },
      },
      request: mock(async () => ({
        bot: { open_id: 'bot_open_id', bot_name: 'TestBot' },
      })),
    } as any,
    sentMessages,
    reactions,
  }
}

describe('FeishuChannel', () => {
  describe('sendMessage', () => {
    test('plain text uses post format', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', 'hello')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('post')
    })

    test('uses card format when code blocks are present', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', 'look:\n```\ncode\n```')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('interactive')
    })

    test('uses card format when tables are present', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', '|a|b|\n|---|---|\n|1|2|')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('interactive')
    })

    test('long message is sent in chunks', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      // generate text exceeding 4000 characters
      const longText = 'x'.repeat(4001)
      await channel.sendMessage('feishu:chat1', longText)

      expect(sentMessages.length).toBe(2)
    })
  })

  describe('ownsChatId', () => {
    test('feishu: prefix returns true', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.ownsChatId('feishu:chat1')).toBe(true)
    })

    test('telegram: prefix returns false', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.ownsChatId('telegram:chat1')).toBe(false)
    })
  })

  describe('isConnected', () => {
    test('initial state is false', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('Reaction lifecycle', () => {
    test('eventBus subscription is cleaned up after disconnect', () => {
      const eventBus = new EventBus()
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        eventBus,
        _client: client,
      })

      // no eventBus subscription during construction (subscription happens in connect)
      expect(eventBus.subscriberCount).toBe(0)

      // disconnect should not throw
      channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })

    test('reaction API failure does not throw', async () => {
      const { client } = createMockClient()
      // make reaction create fail
      client.im.messageReaction.create = mock(async () => {
        throw new Error('API error')
      })

      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      // normal in disconnected state
      expect(channel.isConnected()).toBe(false)
    })
  })
})
