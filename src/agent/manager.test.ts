import { describe, test, expect, mock } from 'bun:test'
import { AgentManager } from './manager.ts'

// Minimal mock dependencies
const mockEventBus = {} as any
const mockPromptBuilder = {} as any

// Create an AgentManager with preset agents
function createManager(agents: Array<{ id: string; chatIds?: string[] }>) {
  const manager = new AgentManager(mockEventBus, mockPromptBuilder)
  // Write directly to internal Map to avoid actual disk loading
  const map = (manager as any).agents as Map<string, any>
  for (const a of agents) {
    map.set(a.id, {
      config: {
        id: a.id,
        name: a.id,
        model: 'claude-sonnet-4-6',
        workspaceDir: '/tmp',
        telegram: a.chatIds ? { chatIds: a.chatIds } : undefined,
      },
      workspaceDir: '/tmp',
      runtime: {},
      state: {},
    })
  }
  return manager
}

describe('AgentManager.resolveAgent', () => {
  test('exact match on telegram chatId', () => {
    const manager = createManager([
      { id: 'agent-a', chatIds: ['tg:111'] },
      { id: 'agent-b', chatIds: ['tg:222'] },
    ])
    const result = manager.resolveAgent('tg:222')
    expect(result?.config.id).toBe('agent-b')
  })

  test('falls back to default agent when telegram chatId is not configured', () => {
    const manager = createManager([
      { id: 'default' },
    ])
    const result = manager.resolveAgent('tg:999')
    expect(result?.config.id).toBe('default')
  })

  test('web chatId falls back to default agent', () => {
    const manager = createManager([
      { id: 'default' },
    ])
    const result = manager.resolveAgent('web:abc-123')
    expect(result?.config.id).toBe('default')
  })

  test('falls back to first agent when no default agent exists', () => {
    const manager = createManager([
      { id: 'custom-agent' },
    ])
    const result = manager.resolveAgent('tg:999')
    expect(result?.config.id).toBe('custom-agent')
  })

  test('returns undefined when no agents exist', () => {
    const manager = createManager([])
    const result = manager.resolveAgent('tg:999')
    expect(result).toBeUndefined()
  })
})
