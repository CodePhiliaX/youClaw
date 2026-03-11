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
  // 清理全局 memory
  const globalDir = resolve(getPaths().agents, '_global')
  if (existsSync(globalDir)) {
    rmSync(globalDir, { recursive: true, force: true })
  }
  createdAgentIds.clear()
}

describe('全局 Memory', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('getGlobalMemory 在文件不存在时返回空字符串', () => {
    expect(memoryManager.getGlobalMemory()).toBe('')
  })

  test('updateGlobalMemory 写入并读取全局记忆', async () => {
    memoryManager.updateGlobalMemory('全局信息：系统偏好')

    const globalDir = resolve(getPaths().agents, '_global', 'memory')
    await waitFor(() => existsSync(resolve(globalDir, 'MEMORY.md')))

    expect(memoryManager.getGlobalMemory()).toBe('全局信息：系统偏好')
  })

  test('getMemoryContext 包含 global_memory 段', () => {
    const agentId = createAgentId('global-ctx')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '个人记忆')
    memoryManager.updateGlobalMemory('全局共享信息')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).toContain('<global_memory>')
    expect(context).toContain('全局共享信息')
    expect(context).toContain('<long_term>')
    expect(context).toContain('个人记忆')
  })

  test('getMemoryContext 在无全局记忆时不包含 global_memory 段', () => {
    const agentId = createAgentId('no-global')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '个人记忆')

    const context = memoryManager.getMemoryContext(agentId)
    expect(context).not.toContain('<global_memory>')
    expect(context).toContain('<long_term>')
  })
})

describe('日志截断', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('appendDailyLog 截断超长消息', async () => {
    const agentId = createAgentId('truncate')
    const longMessage = 'A'.repeat(1000)
    const longReply = 'B'.repeat(1000)

    memoryManager.appendDailyLog(agentId, 'web:chat-1', longMessage, longReply, { maxLogEntryLength: 500 })

    const today = new Date().toISOString().split('T')[0]!
    const logPath = resolve(getLogsDir(agentId), `${today}.md`)
    await waitFor(() => existsSync(logPath))

    const content = readFileSync(logPath, 'utf-8')
    // 用户消息应被截断到 300（min(300, 500)）
    expect(content).toContain('... *(1000 chars total)*')
    // 不应包含完整的 1000 个字符
    expect(content).not.toContain('A'.repeat(500))
  })
})

describe('日志清理', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('pruneOldLogs 删除超期日志', () => {
    const agentId = createAgentId('prune')
    mkdirSync(getLogsDir(agentId), { recursive: true })

    // 创建旧日志和新日志
    writeFileSync(resolve(getLogsDir(agentId), '2020-01-01.md'), '# 旧日志')
    writeFileSync(resolve(getLogsDir(agentId), '2020-01-15.md'), '# 旧日志2')
    writeFileSync(resolve(getLogsDir(agentId), '2099-12-31.md'), '# 新日志')

    const deleted = memoryManager.pruneOldLogs(agentId, 30)
    expect(deleted).toBe(2)
    expect(existsSync(resolve(getLogsDir(agentId), '2020-01-01.md'))).toBe(false)
    expect(existsSync(resolve(getLogsDir(agentId), '2099-12-31.md'))).toBe(true)
  })

  test('pruneOldLogs 空目录返回 0', () => {
    const agentId = createAgentId('prune-empty')
    expect(memoryManager.pruneOldLogs(agentId, 30)).toBe(0)
  })
})

describe('recentDays 配置', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('getMemoryContext 遵守 recentDays 参数', () => {
    const agentId = createAgentId('recent-days')
    mkdirSync(getLogsDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-10.md'), '# 2026-03-10\nlog-10')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-09.md'), '# 2026-03-09\nlog-09')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-08.md'), '# 2026-03-08\nlog-08')
    writeFileSync(resolve(getLogsDir(agentId), '2026-03-07.md'), '# 2026-03-07\nold')

    // 只取最近 2 天
    const context = memoryManager.getMemoryContext(agentId, 2)
    expect(context).toContain('log-10')
    expect(context).toContain('log-09')
    expect(context).not.toContain('log-08')
    expect(context).not.toContain('old')
  })
})

describe('对话存档', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('saveConversationArchive 写入并读取', () => {
    const agentId = createAgentId('archive')
    const filename = '2026-03-11-test-conversation.md'
    const content = '# Test\n\n**Chat**: web:123\n\n## User\nHello'

    memoryManager.saveConversationArchive(agentId, filename, content)

    expect(memoryManager.getConversationArchive(agentId, filename)).toBe(content)
  })

  test('getConversationArchives 返回列表', () => {
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

  test('getConversationArchive 阻止路径遍历', () => {
    const agentId = createAgentId('archive-security')
    expect(memoryManager.getConversationArchive(agentId, '../../../etc/passwd')).toBe('')
    expect(memoryManager.getConversationArchive(agentId, 'foo/../../bar.md')).toBe('')
  })
})

describe('ConversationArchiver', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('parseTranscript 解析 JSONL', () => {
    const raw = [
      JSON.stringify({ type: 'user', content: '你好' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好！我是助手。' }] } }),
      JSON.stringify({ type: 'user', content: '天气怎样？' }),
    ].join('\n')

    const entries = archiver.parseTranscript(raw)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.role).toBe('user')
    expect(entries[0]!.content).toBe('你好')
    expect(entries[1]!.role).toBe('assistant')
    expect(entries[1]!.content).toBe('你好！我是助手。')
    expect(entries[2]!.role).toBe('user')
  })

  test('parseTranscript 处理空行和无效 JSON', () => {
    const raw = '\n\ninvalid json\n' + JSON.stringify({ type: 'user', content: 'test' }) + '\n'
    const entries = archiver.parseTranscript(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('test')
  })

  test('archive 创建 markdown 归档文件', async () => {
    const agentId = createAgentId('archiver')
    const transcriptContent = [
      JSON.stringify({ type: 'user', content: '什么是 TypeScript？' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'TypeScript 是 JavaScript 的超集。' }] } }),
    ].join('\n')

    // 写入临时 transcript 文件
    const tmpPath = `/tmp/transcript-${Date.now()}.jsonl`
    writeFileSync(tmpPath, transcriptContent)

    const filename = await archiver.archive(agentId, tmpPath, 'web:chat-1')
    expect(filename).toBeTruthy()
    expect(filename).toContain('什么是-typescript')

    const content = memoryManager.getConversationArchive(agentId, filename!)
    expect(content).toContain('# 什么是 TypeScript？')
    expect(content).toContain('**Chat**: web:chat-1')
    expect(content).toContain('TypeScript 是 JavaScript 的超集。')

    // 清理
    rmSync(tmpPath, { force: true })
  })
})

describe('快照', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  test('exportSnapshot 包含全局和个人记忆', () => {
    const agentId = createAgentId('snapshot')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '## 用户偏好\n喜欢 TypeScript')
    memoryManager.updateGlobalMemory('全局配置')

    const snapshot = memoryManager.exportSnapshot(agentId)
    expect(snapshot).toContain('# Memory Snapshot')
    expect(snapshot).toContain('全局配置')
    expect(snapshot).toContain('喜欢 TypeScript')
  })

  test('saveSnapshot 和 getSnapshot', () => {
    const agentId = createAgentId('snapshot-save')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '测试记忆')

    memoryManager.saveSnapshot(agentId)
    const snapshot = memoryManager.getSnapshot(agentId)
    expect(snapshot).toContain('测试记忆')
  })

  test('restoreFromSnapshot 当 MEMORY.md 为空时恢复', () => {
    const agentId = createAgentId('snapshot-restore')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })

    // 手动写入快照
    const snapshotPath = resolve(getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
    writeFileSync(snapshotPath, '# Memory Snapshot\n\n## Long-term Memory\n\n## 用户偏好\n喜欢 Rust\n\n## Recent Logs')

    const restored = memoryManager.restoreFromSnapshot(agentId)
    expect(restored).toBe(true)
    expect(memoryManager.getMemory(agentId)).toContain('喜欢 Rust')
  })

  test('restoreFromSnapshot 当 MEMORY.md 有内容时不恢复', () => {
    const agentId = createAgentId('snapshot-no-restore')
    mkdirSync(getAgentMemoryDir(agentId), { recursive: true })
    writeFileSync(getMemoryFile(agentId), '已有内容')

    const snapshotPath = resolve(getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
    writeFileSync(snapshotPath, '# Memory Snapshot\n\n## Long-term Memory\n\n旧内容')

    const restored = memoryManager.restoreFromSnapshot(agentId)
    expect(restored).toBe(false)
    expect(memoryManager.getMemory(agentId)).toBe('已有内容')
  })
})

describe('MemoryIndexer', () => {
  const indexer = new MemoryIndexer()

  beforeEach(() => {
    cleanup()
    indexer.initTable()
  })
  afterEach(cleanup)

  test('initTable + rebuildIndex 不报错', () => {
    expect(() => indexer.rebuildIndex()).not.toThrow()
  })

  test('indexFile + search 返回结果', () => {
    const agentId = createAgentId('indexer')
    indexer.indexFile(agentId, 'memory', '/tmp/test.md', '用户喜欢 TypeScript 和 Rust')

    const results = indexer.search('TypeScript')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.agentId).toBe(agentId)
    expect(results[0]!.snippet).toContain('TypeScript')
  })

  test('search 空查询返回空', () => {
    expect(indexer.search('')).toEqual([])
    expect(indexer.search('   ')).toEqual([])
  })

  test('removeFile 删除索引', () => {
    const agentId = createAgentId('indexer-rm')
    indexer.indexFile(agentId, 'memory', '/tmp/remove-test.md', 'content to be removed from index')

    const before = indexer.search('removed')
    expect(before.length).toBeGreaterThanOrEqual(1)

    indexer.removeFile('/tmp/remove-test.md')

    const after = indexer.search('removed')
    const found = after.find((r) => r.filePath === '/tmp/remove-test.md')
    expect(found).toBeUndefined()
  })

  test('search 支持 agentId 过滤', () => {
    const agent1 = createAgentId('filter-1')
    const agent2 = createAgentId('filter-2')
    indexer.indexFile(agent1, 'memory', '/tmp/a1.md', 'Bun 运行时')
    indexer.indexFile(agent2, 'memory', '/tmp/a2.md', 'Bun 测试框架')

    const all = indexer.search('Bun')
    expect(all.length).toBeGreaterThanOrEqual(2)

    const filtered = indexer.search('Bun', { agentId: agent1 })
    expect(filtered.length).toBe(1)
    expect(filtered[0]!.agentId).toBe(agent1)
  })
})
