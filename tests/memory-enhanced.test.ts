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

describe('MemoryManager 增强功能', () => {
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

  // === recentDays 参数测试 ===

  test('getMemoryContext 支持 recentDays 参数', () => {
    const agentId = createAgentId('mem-days')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '长期记忆')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-07.md'), '# 2026-03-07\nday7')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), '# 2026-03-08\nday8')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), '# 2026-03-09\nday9')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), '# 2026-03-10\nday10')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), '# 2026-03-11\nday11')

    // recentDays=2: 只包含最近 2 天
    const context2 = memoryManager.getMemoryContext(agentId, { recentDays: 2 })
    expect(context2).toContain('day11')
    expect(context2).toContain('day10')
    expect(context2).not.toContain('day9')
    expect(context2).not.toContain('day8')

    // recentDays=5: 包含全部 5 天
    const context5 = memoryManager.getMemoryContext(agentId, { recentDays: 5 })
    expect(context5).toContain('day11')
    expect(context5).toContain('day7')

    // recentDays=1: 只包含最近 1 天
    const context1 = memoryManager.getMemoryContext(agentId, { recentDays: 1 })
    expect(context1).toContain('day11')
    expect(context1).not.toContain('day10')
  })

  test('默认 recentDays=3', () => {
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

  // === maxContextChars 参数测试 ===

  test('getMemoryContext 支持 maxContextChars 截断', () => {
    const agentId = createAgentId('mem-chars')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'M'.repeat(100))
    // 每天 200 字符
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), 'A'.repeat(200))
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), 'B'.repeat(200))

    // maxContextChars=250: 长期记忆 100 + 第一天日志 200 = 300 > 250
    // 所以第一天的日志会被截断
    const context = memoryManager.getMemoryContext(agentId, { maxContextChars: 250 })
    expect(context).toContain('B') // 最近一天（11日）
    expect(context).toContain('日志已截断')
  })

  test('maxContextChars 足够大时不截断', () => {
    const agentId = createAgentId('mem-no-truncate')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'short memory')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-11.md'), 'short log')

    const context = memoryManager.getMemoryContext(agentId, { maxContextChars: 100000 })
    expect(context).toContain('short memory')
    expect(context).toContain('short log')
    expect(context).not.toContain('截断')
  })

  // === 会话归档测试 ===

  test('archiveConversation 创建归档文件', () => {
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

  test('getArchivedConversation 返回归档内容', () => {
    const agentId = createAgentId('mem-archive-get')

    memoryManager.archiveConversation(
      agentId,
      'web:chat-1',
      'session-xyz',
      '对话内容 A B C',
    )

    const content = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'session-xyz')
    expect(content).toContain('session-xyz')
    expect(content).toContain('对话内容 A B C')
  })

  test('getArchivedConversation 不存在时返回空字符串', () => {
    const agentId = createAgentId('mem-archive-missing')
    const content = memoryManager.getArchivedConversation(agentId, 'web:chat-1', 'nonexistent')
    expect(content).toBe('')
  })

  test('getArchivedConversations 按 chatId 过滤', () => {
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

  test('getArchivedConversations 无归档时返回空数组', () => {
    const agentId = createAgentId('mem-archive-empty')
    const conversations = memoryManager.getArchivedConversations(agentId)
    expect(conversations).toEqual([])
  })

  test('多次归档同一 chatId 的不同 session', () => {
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
