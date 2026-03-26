import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { cleanTables } from './setup.ts'
import { getChats, getMessages } from '../src/db/index.ts'
import { EventBus } from '../src/events/bus.ts'
import { MessageRouter } from '../src/channel/router.ts'
import type { InboundMessage, Channel } from '../src/channel/types.ts'

function expectTimestampedPrompt(value: unknown, expectedMessage: string) {
  expect(value).toEqual(expect.stringMatching(
    new RegExp(`^\\[[A-Z][a-z]{2} \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} .+\\] ${expectedMessage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  ))
}

function createMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    chatId: 'web:chat-1',
    sender: 'user',
    senderName: 'Alice',
    content: 'hello',
    timestamp: '2026-03-10T10:00:00.000Z',
    isGroup: false,
    ...overrides,
  }
}

function createManagedAgent(configOverrides: Record<string, unknown> = {}) {
  return {
    config: {
      id: 'agent-1',
      name: 'Agent One',
      model: 'claude-sonnet-4-6',
      workspaceDir: '/tmp/agent-1',
      ...configOverrides,
    },
    workspaceDir: '/tmp/agent-1',
    runtime: {},
    state: {},
  }
}

function createChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    name: 'mock',
    connect: async () => {},
    sendMessage: async () => {},
    isConnected: () => true,
    ownsChatId: () => false,
    disconnect: async () => {},
    ...overrides,
  }
}

describe('MessageRouter.handleInbound', () => {
  beforeEach(() => cleanTables('messages', 'chats'))

  test('ignores message when no matching agent', async () => {
    const resolveAgent = mock(() => undefined)
    const enqueue = mock(() => Promise.resolve('unused'))
    const router = new MessageRouter(
      { resolveAgent } as any,
      { enqueue } as any,
      new EventBus(),
    )

    await router.handleInbound(createMessage())

    expect(resolveAgent).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledTimes(0)
    expect(getMessages('web:chat-1', 10)).toEqual([])
    expect(getChats()).toEqual([])
  })

  test('does not enqueue or persist when group message misses trigger', async () => {
    const enqueue = mock(() => Promise.resolve('unused'))
    const router = new MessageRouter(
      {
        resolveAgent: () => createManagedAgent({ trigger: '^@bot', requiresTrigger: true }),
      } as any,
      { enqueue } as any,
      new EventBus(),
    )

    await router.handleInbound(createMessage({
      chatId: 'tg:group-1',
      isGroup: true,
      content: 'ordinary group message',
    }))

    expect(enqueue).toHaveBeenCalledTimes(0)
    expect(getMessages('tg:group-1', 10)).toEqual([])
    expect(getChats()).toEqual([])
  })

  test('auto-parses skill invocations, saves message, and records daily log', async () => {
    const enqueue = mock(() => Promise.resolve('router reply'))
    const appendDailyLog = mock(() => {})
    const rememberTurn = mock(() => Promise.resolve([]))
    const getUsableSkillNamesForAgent = mock(() => new Set(['pdf', 'agent-browser']))
    const router = new MessageRouter(
      {
        resolveAgent: () => createManagedAgent(),
      } as any,
      { enqueue } as any,
      new EventBus(),
      { appendDailyLog, rememberTurn } as any,
      { getUsableSkillNamesForAgent } as any,
    )

    await router.handleInbound(createMessage({
      content: '/pdf /agent-browser summarize report',
    }))

    expect(getUsableSkillNamesForAgent).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]?.[0]).toBe('agent-1')
    expect(enqueue.mock.calls[0]?.[1]).toBe('web:chat-1')
    expectTimestampedPrompt(enqueue.mock.calls[0]?.[2], 'summarize report')
    expect(enqueue.mock.calls[0]?.[3]).toMatchObject({
      requestedSkills: ['pdf', 'agent-browser'],
    })
    const afterResult = enqueue.mock.calls[0]?.[3]?.afterResult as ((result: string) => Promise<void>) | undefined
    expect(typeof afterResult).toBe('function')
    await afterResult?.('router reply')
    expect(appendDailyLog).toHaveBeenCalledWith(
      'agent-1',
      'web:chat-1',
      '/pdf /agent-browser summarize report',
      'router reply',
      undefined,
    )
    expect(rememberTurn).toHaveBeenCalledWith(
      'agent-1',
      'web:chat-1',
      '/pdf /agent-browser summarize report',
      'router reply',
    )

    const chats = getChats()
    const messages = getMessages('web:chat-1', 10)
    expect(chats.length).toBe(1)
    expect(chats[0]?.name).toBe('/pdf /agent-browser summarize report')
    expect(chats[0]?.channel).toBe('web')
    expect(messages.length).toBe(2)
    expect(messages.some((message) => message.content === '/pdf /agent-browser summarize report')).toBe(true)
    expect(messages.some((message) => message.content === 'router reply')).toBe(true)
  })

  test('explicit requestedSkills take priority, prefix is not re-parsed', async () => {
    const enqueue = mock(() => Promise.resolve('ok'))
    const getUsableSkillNamesForAgent = mock(() => new Set(['pdf']))
    const router = new MessageRouter(
      {
        resolveAgent: () => createManagedAgent(),
      } as any,
      { enqueue } as any,
      new EventBus(),
      undefined,
      { getUsableSkillNamesForAgent } as any,
    )

    await router.handleInbound(createMessage({
      content: '/pdf keep raw content',
      requestedSkills: ['explicit-skill'],
    }))

    expect(getUsableSkillNamesForAgent).toHaveBeenCalledTimes(0)
    expectTimestampedPrompt(enqueue.mock.calls[0]?.[2], '/pdf keep raw content')
    expect(enqueue.mock.calls[0]?.[3]).toMatchObject({
      requestedSkills: ['explicit-skill'],
    })
  })

  test('injects a timestamp envelope for the agent prompt while storing raw message content', async () => {
    const enqueue = mock(() => Promise.resolve('ok'))
    const router = new MessageRouter(
      {
        resolveAgent: () => createManagedAgent(),
      } as any,
      { enqueue } as any,
      new EventBus(),
    )

    await router.handleInbound(createMessage({
      content: '现在几点了',
      timestamp: '2026-03-24T12:01:00.000Z',
    }))

    expectTimestampedPrompt(enqueue.mock.calls[0]?.[2], '现在几点了')

    const messages = getMessages('web:chat-1', 10)
    expect(messages.some((message) => message.content === '现在几点了')).toBe(true)
    expect(messages.some((message) => message.content.includes('[Tue 2026-03-24'))).toBe(false)
  })
})

describe('MessageRouter complete event outbound', () => {
  test('sends completion message only to the channel that owns the chatId', async () => {
    const eventBus = new EventBus()
    const firstSend = mock(() => Promise.resolve())
    const secondSend = mock(() => Promise.resolve())
    const router = new MessageRouter(
      { resolveAgent: () => createManagedAgent() } as any,
      { enqueue: mock(() => Promise.resolve('unused')) } as any,
      eventBus,
    )

    router.addChannel(createChannel({
      name: 'first',
      ownsChatId: () => false,
      sendMessage: firstSend,
    }))
    router.addChannel(createChannel({
      name: 'second',
      ownsChatId: (chatId) => chatId === 'tg:1',
      sendMessage: secondSend,
    }))

    eventBus.emit({ type: 'complete', agentId: 'agent-1', chatId: 'tg:1', fullText: 'done', sessionId: 'session-1' })
    await Promise.resolve()

    expect(firstSend).toHaveBeenCalledTimes(0)
    expect(secondSend).toHaveBeenCalledTimes(1)
    expect(secondSend).toHaveBeenCalledWith('tg:1', 'done')
  })
})
