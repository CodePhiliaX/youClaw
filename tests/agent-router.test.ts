import { describe, test, expect, beforeEach } from 'bun:test'
import './setup-light.ts'
import { AgentRouter } from '../src/agent/router.ts'
import type { AgentInstance } from '../src/agent/types.ts'
import type { Binding } from '../src/agent/schema.ts'

function createAgent(
  id: string,
  bindings?: Binding[],
  overrides: Partial<AgentInstance['config']> = {},
): AgentInstance {
  return {
    config: {
      id,
      name: `Agent ${id}`,
      model: 'claude-sonnet-4-6',
      workspaceDir: `/tmp/${id}`,
      bindings,
      ...overrides,
    } as any,
    workspaceDir: `/tmp/${id}`,
    runtime: {} as any,
    state: {
      sessionId: null,
      isProcessing: false,
      lastProcessedAt: null,
      totalProcessed: 0,
      lastError: null,
      queueDepth: 0,
    },
  }
}

function buildAgentsMap(...agents: AgentInstance[]): Map<string, AgentInstance> {
  const map = new Map<string, AgentInstance>()
  for (const agent of agents) {
    map.set(agent.config.id, agent)
  }
  return map
}

describe('AgentRouter', () => {
  let router: AgentRouter

  beforeEach(() => {
    router = new AgentRouter()
  })

  test('falls back to default agent when no bindings exist', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('other'),
    )
    router.buildRouteTable(agents)

    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result?.config.id).toBe('default')
  })

  test('falls back to first agent when no default agent exists', () => {
    const agents = buildAgentsMap(
      createAgent('custom-1'),
    )
    router.buildRouteTable(agents)

    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result?.config.id).toBe('custom-1')
  })

  test('returns undefined when no agents exist', () => {
    router.buildRouteTable(new Map())
    const result = router.resolve({ channel: 'web', chatId: 'web:abc' })
    expect(result).toBeUndefined()
  })

  test('chatIds exact match', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('support', [
        { channel: 'telegram', chatIds: ['tg:111', 'tg:222'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:222' })?.config.id).toBe('support')
    // non-matching chatId falls back to default
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:999' })?.config.id).toBe('default')
  })

  test('non-matching chatIds do not fall back to other conditions in same binding', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('specific', [
        { channel: 'telegram', chatIds: ['tg:111'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    // tg:222 is not in chatIds, should fall back to default not specific
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:222' })?.config.id).toBe('default')
  })

  test('channel matching', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('web-agent', [
        { channel: 'web', priority: 50 },
      ]),
      createAgent('tg-agent', [
        { channel: 'telegram', priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('web-agent')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('tg-agent')
  })

  test('skips binding when channel does not match', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('web-only', [
        { channel: 'web', priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    // telegram channel does not match web-only binding
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('default')
  })

  test('wildcard channel "*" matches all channels', () => {
    const agents = buildAgentsMap(
      createAgent('catch-all', [
        { channel: '*', priority: 0 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('catch-all')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123' })?.config.id).toBe('catch-all')
    expect(router.resolve({ channel: 'api', chatId: 'api:xyz' })?.config.id).toBe('catch-all')
  })

  test('tags matching', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('support', [
        { channel: 'web', tags: ['support', 'help'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    // matching tag
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['support'] })?.config.id).toBe('support')
    // no tag does not match
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
    // different tag does not match
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['billing'] })?.config.id).toBe('default')
  })

  test('condition.isGroup matching', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('group-handler', [
        { channel: 'telegram', condition: { isGroup: true }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', isGroup: true })?.config.id).toBe('group-handler')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', isGroup: false })?.config.id).toBe('default')
  })

  test('condition.sender matching', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('vip', [
        { channel: 'telegram', condition: { sender: 'user-vip' }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', sender: 'user-vip' })?.config.id).toBe('vip')
    expect(router.resolve({ channel: 'telegram', chatId: 'tg:123', sender: 'user-normal' })?.config.id).toBe('default')
  })

  test('condition.trigger regex matching', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('translate', [
        { channel: '*', condition: { trigger: '^(trans|translate)' }, priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: 'translate this paragraph' })?.config.id).toBe('translate')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: 'Translate this' })?.config.id).toBe('translate')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', content: 'hello' })?.config.id).toBe('default')
    // no content does not match trigger condition
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
  })

  test('higher priority number takes precedence', () => {
    const agents = buildAgentsMap(
      createAgent('low', [
        { channel: 'web', priority: 10 },
      ]),
      createAgent('high', [
        { channel: 'web', priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('high')
  })

  test('chatIds exact match > channel match > wildcard', () => {
    const agents = buildAgentsMap(
      createAgent('wildcard', [
        { channel: '*', priority: 0 },
      ]),
      createAgent('web-general', [
        { channel: 'web', priority: 50 },
      ]),
      createAgent('web-specific', [
        { channel: 'web', chatIds: ['web:vip'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'web', chatId: 'web:vip' })?.config.id).toBe('web-specific')
    expect(router.resolve({ channel: 'web', chatId: 'web:normal' })?.config.id).toBe('web-general')
    expect(router.resolve({ channel: 'api', chatId: 'api:xyz' })?.config.id).toBe('wildcard')
  })

  test('multiple bindings on the same agent', () => {
    const agents = buildAgentsMap(
      createAgent('default'),
      createAgent('multi', [
        { channel: 'telegram', chatIds: ['tg:111'], priority: 100 },
        { channel: 'web', tags: ['support'], priority: 50 },
      ]),
    )
    router.buildRouteTable(agents)

    expect(router.resolve({ channel: 'telegram', chatId: 'tg:111' })?.config.id).toBe('multi')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc', tags: ['support'] })?.config.id).toBe('multi')
    expect(router.resolve({ channel: 'web', chatId: 'web:abc' })?.config.id).toBe('default')
  })

  test('getRouteTable returns the complete route table', () => {
    const agents = buildAgentsMap(
      createAgent('a', [
        { channel: 'web', priority: 10 },
      ]),
      createAgent('b', [
        { channel: 'telegram', chatIds: ['tg:123'], priority: 100 },
      ]),
    )
    router.buildRouteTable(agents)

    const table = router.getRouteTable()
    expect(table.length).toBe(2)

    // sorted by priority descending
    expect(table[0]!.agentId).toBe('b')
    expect(table[0]!.binding.priority).toBe(100)
    expect(table[1]!.agentId).toBe('a')
    expect(table[1]!.binding.priority).toBe(10)

    // includes agentName
    expect(table[0]!.agentName).toBe('Agent b')
  })

  test('empty route table returns empty array', () => {
    router.buildRouteTable(new Map())
    expect(router.getRouteTable()).toEqual([])
  })
})
