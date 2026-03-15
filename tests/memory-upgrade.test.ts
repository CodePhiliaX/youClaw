import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { MemoryManager } from '../src/memory/manager.ts'
import { ConversationArchiver } from '../src/memory/archiver.ts'
import { MemoryIndexer } from '../src/memory/indexer.ts'

const memoryManager = new MemoryManager()
const archiver = new ConversationArchiver(memoryManager)
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

async function waitFor(check: () => boolean, timeoutMs = 500) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('waitFor timeout')
}

function cleanup() {
  for (const agentId of createdAgentIds) {
    rmSync(resolve(getPaths().agents, agentId), { recursive: true, force: true })
  }
  // Clean up global memory
  const globalDir = resolve(getPaths().agents, '_global')
  if (existsSync(globalDir)) {
    rmSync(globalDir, { recursive: true, force: true })
  }
  createdAgentIds.clear()
}

describe('Global Memory', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('getGlobalMemory returns empty string when file does not exist', () => {
    expect(memoryManager.getGlobalMemory()).toBe('')
  })

  test('updateGlobalMemory writes and reads global memory', async () => {
    memoryManager.updateGlobalMemory('Global info: system preferences')

    const globalDir = resolve(getPaths().agents, '_global', 'memory')
    await waitFor(() => existsSync(resolve(globalDir, 'MEMORY.md')))

    expect(memoryManager.getGlobalMemory()).toBe('Global info: system preferences')
  })

  test('getMemoryContext includes global_memory section', () => {
    const agentId = createAgentId('global-ctx')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'Personal memory')
    memoryManager.updateGlobalMemory('Global shared info')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).toContain('<global_memory>')
    expect(context).toContain('Global shared info')
    expect(context).toContain('<long_term>')
    expect(context).toContain('Personal memory')
  })

  test('getMemoryContext does not include global_memory section when no global memory exists', () => {
    const agentId = createAgentId('no-global')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'Personal memory')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).not.toContain('<global_memory>')
    expect(context).toContain('<long_term>')
  })
})

describe('Log Truncation', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('appendDailyLog truncates overly long messages', async () => {
    const agentId = createAgentId('truncate')
    const longMessage = 'A'.repeat(1000)
    const longReply = 'B'.repeat(1000)

    memoryManager.appendDailyLog(agentId, 'web:chat-1', longMessage, longReply, 500)

    const today = new Date().toISOString().split('T')[0]!
    const logPath = resolve(getLogsDir(agentId), `${today}.md`)
    await waitFor(() => existsSync(logPath))

    const content = readFileSync(logPath, 'utf-8')
    // User message should be truncated to 300 (min(300, 500))
    expect(content).toContain('... *(1000 chars total)*')
    // Should not contain the full 1000 characters
    expect(content).not.toContain('A'.repeat(500))
  })
})

describe('Log Cleanup', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('pruneOldLogs deletes expired logs', () => {
    const agentId = createAgentId('prune')
    mkdirSync(getLogsDir(agentId), { recursive: true })

    // Create old and new logs
    writeFileSync(resolve(getLogsDir(agentId), '2020-01-01.md'), '# Old log')
    writeFileSync(resolve(getLogsDir(agentId), '2020-01-15.md'), '# Old log 2')
    writeFileSync(resolve(getLogsDir(agentId), '2099-12-31.md'), '# New log')

    const deleted = memoryManager.pruneOldLogs(agentId, 30)
    expect(deleted).toBe(2)
    expect(existsSync(resolve(getLogsDir(agentId), '2020-01-01.md'))).toBe(false)
    expect(existsSync(resolve(getLogsDir(agentId), '2099-12-31.md'))).toBe(true)
  })

  test('pruneOldLogs returns 0 for empty directory', () => {
    const agentId = createAgentId('prune-empty')
    expect(memoryManager.pruneOldLogs(agentId, 30)).toBe(0)
  })
})

describe('recentDays Configuration', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('getMemoryContext respects recentDays parameter', () => {
    const agentId = createAgentId('recent-days')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), '# 2026-03-10\nlog-10')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), '# 2026-03-09\nlog-09')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), '# 2026-03-08\nlog-08')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-07.md'), '# 2026-03-07\nold')

    // Only get the most recent 2 days
    const context = memoryManager.getMemoryContext(agentId, { recentDays: 2 })
    expect(context).toContain('log-10')
    expect(context).toContain('log-09')
    expect(context).not.toContain('log-08')
    expect(context).not.toContain('old')
  })
})

describe('Conversation Archive', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('saveConversationArchive writes and reads', () => {
    const agentId = createAgentId('archive')
    const filename = '2026-03-11-test-conversation.md'
    const content = '# Test\n\n**Chat**: web:123\n\n## User\nHello'

    memoryManager.saveConversationArchive(agentId, filename, content)

    expect(memoryManager.getConversationArchive(agentId, filename)).toBe(content)
  })

  test('getConversationArchives returns list', () => {
    const agentId = createAgentId('archive-list')
    const convDir = resolve(getAgentMemoryDir(agentId), 'conversations')
    mkdirSync(convDir, { recursive: true })
    writeFileSync(resolve(convDir, '2026-03-10-first.md'), '# First')
    writeFileSync(resolve(convDir, '2026-03-11-second.md'), '# Second')

    const archives = memoryManager.getConversationArchives(agentId)
    expect(archives).toHaveLength(2)
    expect(archives[0]!.date).toBe('2026-03-11')
    expect(archives[1]!.date).toBe('2026-03-10')
  })

  test('getConversationArchive prevents path traversal', () => {
    const agentId = createAgentId('archive-security')
    expect(memoryManager.getConversationArchive(agentId, '../../../etc/passwd')).toBe('')
    expect(memoryManager.getConversationArchive(agentId, 'foo/../../bar.md')).toBe('')
  })
})

describe('ConversationArchiver', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('parseTranscript parses JSONL', () => {
    const raw = [
      JSON.stringify({ type: 'user', content: 'Hello' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello! I am an assistant.' }] } }),
      JSON.stringify({ type: 'user', content: 'How is the weather?' }),
    ].join('\n')

    const entries = archiver.parseTranscript(raw)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.role).toBe('user')
    expect(entries[0]!.content).toBe('Hello')
    expect(entries[1]!.role).toBe('assistant')
    expect(entries[1]!.content).toBe('Hello! I am an assistant.')
    expect(entries[2]!.role).toBe('user')
  })

  test('parseTranscript handles empty lines and invalid JSON', () => {
    const raw = '\n\ninvalid json\n' + JSON.stringify({ type: 'user', content: 'test' }) + '\n'
    const entries = archiver.parseTranscript(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('test')
  })

  test('archive creates a markdown archive file', async () => {
    const agentId = createAgentId('archiver')
    const transcriptContent = [
      JSON.stringify({ type: 'user', content: 'What is TypeScript?' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'TypeScript is a superset of JavaScript.' }] } }),
    ].join('\n')

    // Write temporary transcript file
    const tmpPath = `/tmp/transcript-${Date.now()}.jsonl`
    writeFileSync(tmpPath, transcriptContent)

    const filename = await archiver.archive(agentId, tmpPath, 'web:chat-1')
    expect(filename).toBeTruthy()
    expect(filename).toContain('what-is-typescript')

    const content = memoryManager.getConversationArchive(agentId, filename!)
    expect(content).toContain('# What is TypeScript?')
    expect(content).toContain('**Chat**: web:chat-1')
    expect(content).toContain('TypeScript is a superset of JavaScript.')

    // Cleanup
    rmSync(tmpPath, { force: true })
  })
})

describe('Snapshot', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('exportSnapshot includes global and personal memory', () => {
    const agentId = createAgentId('snapshot')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '## User Preferences\nLikes TypeScript')
    memoryManager.updateGlobalMemory('Global config')

    const snapshot = memoryManager.exportSnapshot(agentId)
    expect(snapshot).toContain('# Memory Snapshot')
    expect(snapshot).toContain('Global config')
    expect(snapshot).toContain('Likes TypeScript')
  })

  test('saveSnapshot and getSnapshot', () => {
    const agentId = createAgentId('snapshot-save')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'Test memory')

    memoryManager.saveSnapshot(agentId)
    const snapshot = memoryManager.getSnapshot(agentId)
    expect(snapshot).toContain('Test memory')
  })

  test('restoreFromSnapshot restores when MEMORY.md is empty', () => {
    const agentId = createAgentId('snapshot-restore')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })

    // Manually write snapshot
    const snapshotPath = resolve(getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
    writeFileSync(snapshotPath, '# Memory Snapshot\n\n## Long-term Memory\n\n## User Preferences\nLikes Rust\n\n## Recent Logs')

    const restored = memoryManager.restoreFromSnapshot(agentId)
    expect(restored).toBe(true)
    expect(memoryManager.getMemory(agentId)).toContain('Likes Rust')
  })

  test('restoreFromSnapshot does not restore when MEMORY.md has content', () => {
    const agentId = createAgentId('snapshot-no-restore')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), 'Existing content')

    const snapshotPath = resolve(getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
    writeFileSync(snapshotPath, '# Memory Snapshot\n\n## Long-term Memory\n\nOld content')

    const restored = memoryManager.restoreFromSnapshot(agentId)
    expect(restored).toBe(false)
    expect(memoryManager.getMemory(agentId)).toBe('Existing content')
  })
})

describe('MemoryIndexer', () => {
  const indexer = new MemoryIndexer()

  beforeEach(() => {
    cleanup()
    indexer.initTable()
  })
  afterEach(cleanup)

  test('initTable + rebuildIndex does not throw', () => {
    expect(() => indexer.rebuildIndex()).not.toThrow()
  })

  test('indexFile + search returns results', () => {
    const agentId = createAgentId('indexer')
    indexer.indexFile(agentId, 'memory', '/tmp/test.md', 'User likes TypeScript and Rust')

    const results = indexer.search('TypeScript')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.agentId).toBe(agentId)
    expect(results[0]!.snippet).toContain('TypeScript')
  })

  test('search returns empty for empty query', () => {
    expect(indexer.search('')).toEqual([])
    expect(indexer.search('   ')).toEqual([])
  })

  test('removeFile deletes index', () => {
    const agentId = createAgentId('indexer-rm')
    indexer.indexFile(agentId, 'memory', '/tmp/remove-test.md', 'content to be removed from index')

    const before = indexer.search('removed')
    expect(before.length).toBeGreaterThanOrEqual(1)

    indexer.removeFile('/tmp/remove-test.md')

    const after = indexer.search('removed')
    const found = after.find((r) => r.filePath === '/tmp/remove-test.md')
    expect(found).toBeUndefined()
  })

  test('search supports agentId filtering', () => {
    const agent1 = createAgentId('filter-1')
    const agent2 = createAgentId('filter-2')
    indexer.indexFile(agent1, 'memory', '/tmp/a1.md', 'Bun runtime')
    indexer.indexFile(agent2, 'memory', '/tmp/a2.md', 'Bun test framework')

    const all = indexer.search('Bun')
    expect(all.length).toBeGreaterThanOrEqual(2)

    const filtered = indexer.search('Bun', { agentId: agent1 })
    expect(filtered.length).toBe(1)
    expect(filtered[0]!.agentId).toBe(agent1)
  })
})
