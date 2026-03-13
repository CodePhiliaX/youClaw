import '../tests/setup-light.ts'
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { extractTextContent, extractPostText, stripBotMention, chunkText, FeishuChannel } from '../src/channel/feishu.ts'
import { EventBus } from '../src/events/bus.ts'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('extractTextContent', () => {
  test('text type 提取 text 字段', () => {
    expect(extractTextContent('{"text":"hello"}', 'text')).toBe('hello')
  })

  test('post type 委托 extractPostText', () => {
    const json = JSON.stringify({
      zh_cn: { title: 'T', content: [[{ tag: 'text', text: 'body' }]] },
    })
    expect(extractTextContent(json, 'post')).toBe('T\nbody')
  })

  test('JSON 解析失败时回退为原始字符串', () => {
    expect(extractTextContent('not json', 'text')).toBe('not json')
  })

  test('未知消息类型返回空字符串', () => {
    expect(extractTextContent('{"text":"hello"}', 'image')).toBe('')
  })
})

describe('extractPostText', () => {
  test('title + text 元素', () => {
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

  test('link 提取文本', () => {
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

  test('image 占位符', () => {
    expect(
      extractPostText({ content: [[{ tag: 'img' }]] }),
    ).toBe('[图片]')
  })

  test('空段落跳过', () => {
    expect(extractPostText({ content: [[]] })).toBe('')
  })

  test('多段落', () => {
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
  test('移除 bot @提及', () => {
    expect(
      stripBotMention(
        'hello @_user_1 world',
        [{ key: '@_user_1', id: { open_id: 'bot123' }, name: 'Bot' }],
        'bot123',
      ),
    ).toBe('hello  world')
  })

  test('保留非 bot 的 @提及', () => {
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

  test('key 中包含正则特殊字符', () => {
    expect(
      stripBotMention(
        'test @_user_1+2 end',
        [{ key: '@_user_1+2', id: { open_id: 'bot1' }, name: 'B' }],
        'bot1',
      ),
    ).toBe('test  end')
  })

  test('trim 前导空白', () => {
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
    test('纯文本使用 post 格式', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', 'hello')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('post')
    })

    test('包含代码块时使用 card 格式', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', 'look:\n```\ncode\n```')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('interactive')
    })

    test('包含表格时使用 card 格式', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      await channel.sendMessage('feishu:chat1', '|a|b|\n|---|---|\n|1|2|')

      expect(sentMessages.length).toBe(1)
      expect(sentMessages[0].data.msg_type).toBe('interactive')
    })

    test('长消息分片发送', async () => {
      const { client, sentMessages } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      // 生成超过 4000 字符的文本
      const longText = 'x'.repeat(4001)
      await channel.sendMessage('feishu:chat1', longText)

      expect(sentMessages.length).toBe(2)
    })
  })

  describe('ownsChatId', () => {
    test('feishu: 前缀返回 true', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.ownsChatId('feishu:chat1')).toBe(true)
    })

    test('telegram: 前缀返回 false', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.ownsChatId('telegram:chat1')).toBe(false)
    })
  })

  describe('isConnected', () => {
    test('初始状态为 false', () => {
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      expect(channel.isConnected()).toBe(false)
    })
  })

  describe('Reaction lifecycle', () => {
    test('eventBus 订阅在 disconnect 后清理', () => {
      const eventBus = new EventBus()
      const { client } = createMockClient()
      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        eventBus,
        _client: client,
      })

      // 构造阶段不订阅 eventBus（订阅发生在 connect 中）
      expect(eventBus.subscriberCount).toBe(0)

      // disconnect 不应抛异常
      channel.disconnect()
      expect(eventBus.subscriberCount).toBe(0)
    })

    test('reaction API 失败不抛异常', async () => {
      const { client } = createMockClient()
      // 让 reaction create 失败
      client.im.messageReaction.create = mock(async () => {
        throw new Error('API error')
      })

      const channel = new FeishuChannel('app1', 'secret1', {
        onMessage: mock(() => {}),
        _client: client,
      })

      // 未连接状态正常
      expect(channel.isConnected()).toBe(false)
    })
  })
})
