import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { MemoryManager } from '../src/memory/manager.ts'
import { MemoryIndexer } from '../src/memory/indexer.ts'
import type { MemoryExtractionRunner } from '../src/memory/extractor.ts'

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
  return resolve(getPaths().agents, agentId, 'MEMORY.md')
}

function getLogsDir(agentId: string) {
  return resolve(getAgentMemoryDir(agentId), 'logs')
}

async function waitFor(check: () => boolean, timeoutMs = 500) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('waitFor timeout')
}

describe('MemoryManager', () => {
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

  test('getMemory returns empty string when file does not exist', () => {
    const agentId = createAgentId('memory-empty')
    expect(memoryManager.getMemory(agentId)).toBe('')
  })

  test('updateMemory creates directory and writes MEMORY.md', async () => {
    const agentId = createAgentId('memory-write')

    memoryManager.updateMemory(agentId, 'long-term memory content')

    await waitFor(() => existsSync(getMemoryFile(agentId)))
    expect(memoryManager.getMemory(agentId)).toBe('long-term memory content')
  })

  test('appendDailyLog creates daily log and appends content', async () => {
    const agentId = createAgentId('memory-log')
    const today = new Date().toISOString().split('T')[0]!
    const todayLog = resolve(getLogsDir(agentId), `${today}.md`)

    memoryManager.appendDailyLog(agentId, 'web:chat-1', 'first question', 'first answer')
    memoryManager.appendDailyLog(agentId, 'web:chat-1', 'second question', 'second answer')

    await waitFor(() => existsSync(todayLog) && readFileSync(todayLog, 'utf-8').includes('second answer'))

    const content = readFileSync(todayLog, 'utf-8')
    expect(content).toContain(`# ${today}`)
    expect(content).toContain('first question')
    expect(content).toContain('first answer')
    expect(content).toContain('second question')
    expect(content).toContain('second answer')
  })

  test('getDailyLogDates returns in descending order, getMemoryContext only includes last 2 days of logs by default', () => {
    const agentId = createAgentId('memory-context')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'long-term memory A')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-07.md'), '# 2026-03-07\nold')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), '# 2026-03-08\nlog-08')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), '# 2026-03-09\nlog-09')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), '# 2026-03-10\nlog-10')

    expect(memoryManager.getDailyLogDates(agentId)).toEqual([
      '2026-03-10',
      '2026-03-09',
      '2026-03-08',
      '2026-03-07',
    ])
    expect(memoryManager.getDailyLog(agentId, '2026-03-09')).toContain('log-09')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).toContain('<long_term>')
    expect(context).toContain('long-term memory A')
    expect(context).toContain('log-10')
    expect(context).toContain('log-09')
    expect(context).not.toContain('log-08')
    expect(context).not.toContain('old')
  })

  test('rememberTurn appends durable facts to today daily memory note without mutating MEMORY.md', async () => {
    const agentId = createAgentId('memory-remember')
    const extractor: MemoryExtractionRunner = {
      extractTurnMemory: async () => ({
        dailyMemories: [
          { text: 'The user is a programmer.' },
          { text: 'The user usually finishes work at 22:00.' },
          { text: 'The user likes 焖面.' },
        ],
        curatedUpdates: [
          { section: 'Profile', key: 'occupation', value: '程序员' },
          { section: 'Schedule', key: 'work_end_time', value: '每天 22 点下班' },
          { section: 'Preferences', key: 'food_preferences', value: '喜欢吃焖面' },
        ],
      }),
    }
    const manager = new MemoryManager(extractor)

    const result = await manager.rememberTurn(
      agentId,
      'web:chat-1',
      '我是一个程序员，我每天 22 点下班，我喜欢吃焖面。',
      '收到，我会按这些信息更好地帮助你。',
    )

    expect(result.dailyMemories).toHaveLength(3)
    expect(result.curatedUpdates).toHaveLength(3)
    const memory = manager.getMemory(agentId)
    expect(memory).toContain('`occupation`: 程序员')
    expect(memory).toContain('`work_end_time`: 每天 22 点下班')
    expect(memory).toContain('`food_preferences`: 喜欢吃焖面')

    const today = new Date().toISOString().split('T')[0]!
    const notePath = resolve(getAgentMemoryDir(agentId), `${today}.md`)
    expect(existsSync(notePath)).toBe(true)
    const note = readFileSync(notePath, 'utf-8')
    expect(note).toContain('The user is a programmer.')
    expect(note).toContain('The user usually finishes work at 22:00.')
    expect(note).toContain('The user likes 焖面.')
  })

  test('rememberTurn skips duplicate daily memory items already present today', async () => {
    const agentId = createAgentId('memory-remember-dedupe')
    const extractor: MemoryExtractionRunner = {
      extractTurnMemory: async () => ({
        dailyMemories: [{ text: 'The user is a programmer.' }],
        curatedUpdates: [{ section: 'Profile', key: 'occupation', value: '程序员' }],
      }),
    }
    const manager = new MemoryManager(extractor)
    const today = new Date().toISOString().split('T')[0]!
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(resolve(getAgentMemoryDir(agentId), `${today}.md`), [
      `# ${today}`,
      '',
      '## 10:00 [web:chat-1]',
      '- Source: 之前已经记录过',
      '- The user is a programmer.',
      '',
    ].join('\n'))
    manager.updateMemory(agentId, [
      '# Long-term Memory',
      '',
      '## Profile',
      '',
      '- `occupation`: 程序员',
      '',
      '## Schedule',
      '',
      '<!-- empty -->',
      '',
      '## Preferences',
      '',
      '<!-- empty -->',
      '',
      '## Relationships',
      '',
      '<!-- empty -->',
      '',
      '## Projects',
      '',
      '<!-- empty -->',
      '',
      '## Notes',
      '',
      '<!-- empty -->',
      '',
    ].join('\n'))

    const result = await manager.rememberTurn(
      agentId,
      'web:chat-1',
      '我是一个程序员。',
      '记住了。',
    )

    expect(result.dailyMemories).toEqual([{ text: 'The user is a programmer.' }])
    expect(result.curatedUpdates).toEqual([])
    const note = readFileSync(resolve(getAgentMemoryDir(agentId), `${today}.md`), 'utf-8')
    expect(note.match(/The user is a programmer\./g)?.length).toBe(1)
  })

  test('getMemoryContext includes relevant memory hits for the current query when indexer is attached', () => {
    const agentId = createAgentId('memory-query')
    const indexer = new MemoryIndexer()
    indexer.initTable()
    memoryManager.attachIndexer(indexer)

    memoryManager.updateMemory(agentId, [
      '# Long-term Memory',
      '',
      '## Projects',
      '',
      '- `stack`: TypeScript backend',
      '',
      '## Notes',
      '',
      '- `focus`: MCP integration work',
      '',
    ].join('\n'))
    memoryManager.appendDailyLog(agentId, 'web:chat-1', 'Tell me about TypeScript plans', 'We are using TypeScript')

    const context = memoryManager.getMemoryContext(agentId, {
      query: 'TypeScript',
      recentDays: 2,
      maxContextChars: 8000,
    })

    expect(context).toContain('<relevant_memory_hits>')
    expect(context).toContain('TypeScript')
  })
})
