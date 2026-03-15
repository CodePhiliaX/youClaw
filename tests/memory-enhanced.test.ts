import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup-light.ts'
import { getPaths } from '../src/config/index.ts'
import { MemoryManager } from '../src/memory/manager.ts'

const memoryManager = new MemoryManager()
const createdAgentIds = new Set<string>()

function createAgentId(prefix: string) {
  const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  createdAgentIds.add(agentId)
  return agentId
}

function getAgentMemoryDir(agentId: string) {
  return resolve(getPaths().agents, agentId, 'memory')
}

function getMemoryFile(agentId: string) {
  return resolve(getAgentMemoryDir(agentId), 'MEMORY.md')
}

function getLogsDir(agentId: string) {
  return resolve(getAgentMemoryDir(agentId), 'logs')
}

describe('MemoryManager enhanced features', () => {
  beforeEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  afterEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()
  })

  // === recentDays parameter tests ===

  test('getMemoryContext supports recentDays parameter', () => {
    const agentId = createAgentId('mem-days')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'long-term memory')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-07.md'), '# 2026-03-07\nday7')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), '# 2026-03-08\nday8')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), '# 2026-03-09\nday9')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), '# 2026-03-10\nday10')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), '# 2026-03-11\nday11')

    // recentDays=2: only includes the most recent 2 days
    const context2 = memoryManager.getMemoryContext(agentId, { recentDays: 2 })
    expect(context2).toContain('day11')
    expect(context2).toContain('day10')
    expect(context2).not.toContain('day9')
    expect(context2).not.toContain('day8')

    // recentDays=5: includes all 5 days
    const context5 = memoryManager.getMemoryContext(agentId, { recentDays: 5 })
    expect(context5).toContain('day11')
    expect(context5).toContain('day7')

    // recentDays=1: only includes the most recent 1 day
    const context1 = memoryManager.getMemoryContext(agentId, { recentDays: 1 })
    expect(context1).toContain('day11')
    expect(context1).not.toContain('day10')
  })

  test('default recentDays=3', () => {
    const agentId = createAgentId('mem-default-days')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), 'day8')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), 'day9')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), 'day10')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), 'day11')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).toContain('day11')
    expect(context).toContain('day10')
    expect(context).toContain('day9')
    expect(context).not.toContain('day8')
  })

  // === maxContextChars parameter tests ===

  test('getMemoryContext supports maxContextChars truncation', () => {
    const agentId = createAgentId('mem-chars')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'M'.repeat(100))
    // 200 characters per day
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), 'A'.repeat(200))
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), 'B'.repeat(200))

    // maxContextChars=250: long-term memory 100 + first day log 200 = 300 > 250
    // so the first day's log will be truncated
    const context = memoryManager.getMemoryContext(agentId, { maxContextChars: 250 })
    expect(context).toContain('B') // most recent day (11th)
    expect(context).toContain('logs truncated')
  })

  test('no truncation when maxContextChars is large enough', () => {
    const agentId = createAgentId('mem-no-truncate')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'short memory')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), 'short log')

    const context = memoryManager.getMemoryContext(agentId, { maxContextChars: 100000 })
    expect(context).toContain('short memory')
    expect(context).toContain('short log')
    expect(context).not.toContain('truncated')
  })

  // === conversation archive tests ===

  test('archiveConversation creates archive file', () => {
    const agentId = createAgentId('mem-archive')

    memoryManager.archiveConversation(
      agentId,
      'web:chat-1',
      'session-abc',
      'User: hello\nAssistant: hi',
    )

    const conversations = memoryManager.getArchivedConversations(agentId)
    expect(conversations.length).toBe(1)
    expect(conversations[0]!.sessionId).toBe('session-abc')
    expect(conversations[0]!.size).toBeGreaterThan(0)
  })

  test('getArchivedConversation returns archive content', () => {
    const agentId = createAgentId('mem-archive-get')

    memoryManager.archiveConversation(
      agentId,
      'web:chat-1',
      'session-xyz',
      'conversation content A B C',
    )

    const content = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'session-xyz')
    expect(content).toContain('session-xyz')
    expect(content).toContain('conversation content A B C')
  })

  test('getArchivedConversation returns empty string when not found', () => {
    const agentId = createAgentId('mem-archive-missing')
    const content = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'nonexistent')
    expect(content).toBe('')
  })

  test('getArchivedConversations filters by chatId', () => {
    const agentId = createAgentId('mem-archive-filter')

    memoryManager.archiveConversation(agentId, 'web:chat-1', 'session-1', 'content 1')
    memoryManager.archiveConversation(agentId, 'web:chat-2', 'session-2', 'content 2')
    memoryManager.archiveConversation(agentId, 'web:chat-1', 'session-3', 'content 3')

    const all = memoryManager.getArchivedConversations(agentId)
    expect(all.length).toBe(3)

    const chat1Only = memoryManager.getArchivedConversations(agentId, 'web:chat-1')
    expect(chat1Only.length).toBe(2)
    expect(chat1Only.every((c) => c.sessionId === 'session-1' || c.sessionId === 'session-3')).toBe(true)
  })

  test('getArchivedConversations returns empty array when no archives exist', () => {
    const agentId = createAgentId('mem-archive-empty')
    const conversations = memoryManager.getArchivedConversations(agentId)
    expect(conversations).toEqual([])
  })

  test('multiple archives of different sessions for the same chatId', () => {
    const agentId = createAgentId('mem-archive-multi')

    memoryManager.archiveConversation(agentId, 'web:chat-1', 'session-a', 'A')
    memoryManager.archiveConversation(agentId, 'web:chat-1', 'session-b', 'B')

    const conversations = memoryManager.getArchivedConversations(agentId, 'web:chat-1')
    expect(conversations.length).toBe(2)

    const contentA = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'session-a')
    const contentB = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'session-b')
    expect(contentA).toContain('A')
    expect(contentB).toContain('B')
  })
})
