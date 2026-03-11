import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnv } from '../config/env.ts'
import { getLogDates, readLogEntries, cleanOldLogs } from './reader.ts'

// 构造测试用临时目录，mock getPaths() 返回的 logs 路径
const testDir = resolve(tmpdir(), `youclaw-test-logs-${Date.now()}`)
const logsDir = resolve(testDir, 'logs')

// 初始化环境变量，让 getPaths 正常工作
// 必须在 import reader 触发模块之前设置好环境变量
process.env.DATA_DIR = testDir
process.env.LOG_LEVEL = 'info'
loadEnv()

before(() => {
  mkdirSync(logsDir, { recursive: true })
})

after(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// 示例日志行
function makeLogLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg: 'test message',
    ...overrides,
  })
}

describe('getLogDates', () => {
  beforeEach(() => {
    // 清空 logsDir
    for (const f of readdirSync(logsDir)) {
      rmSync(resolve(logsDir, f))
    }
  })

  it('返回空数组当目录无日志文件', () => {
    const dates = getLogDates()
    assert.deepEqual(dates, [])
  })

  it('返回按降序排列的日期', () => {
    writeFileSync(resolve(logsDir, '2026-03-09.log'), '')
    writeFileSync(resolve(logsDir, '2026-03-11.log'), '')
    writeFileSync(resolve(logsDir, '2026-03-10.log'), '')
    // 非日志文件应被忽略
    writeFileSync(resolve(logsDir, 'random.txt'), '')

    const dates = getLogDates()
    assert.deepEqual(dates, ['2026-03-11', '2026-03-10', '2026-03-09'])
  })
})

describe('readLogEntries', () => {
  beforeEach(() => {
    for (const f of readdirSync(logsDir)) {
      rmSync(resolve(logsDir, f))
    }
  })

  it('文件不存在时返回空结果', async () => {
    const result = await readLogEntries('2099-01-01', {})
    assert.deepEqual(result, { entries: [], total: 0, hasMore: false })
  })

  it('读取并解析所有日志行', async () => {
    const lines = [
      makeLogLine({ msg: 'first', time: 1000 }),
      makeLogLine({ msg: 'second', time: 2000 }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', {})
    assert.equal(result.total, 2)
    assert.equal(result.entries.length, 2)
    assert.equal(result.entries[0]!.msg, 'first')
    assert.equal(result.entries[1]!.msg, 'second')
    assert.equal(result.hasMore, false)
  })

  it('按级别过滤', async () => {
    const lines = [
      makeLogLine({ level: 20, msg: 'debug msg' }),
      makeLogLine({ level: 30, msg: 'info msg' }),
      makeLogLine({ level: 40, msg: 'warn msg' }),
      makeLogLine({ level: 50, msg: 'error msg' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { level: 'warn' })
    assert.equal(result.total, 2)
    assert.equal(result.entries[0]!.msg, 'warn msg')
    assert.equal(result.entries[1]!.msg, 'error msg')
  })

  it('按类别过滤 - agent', async () => {
    const lines = [
      makeLogLine({ msg: 'system log' }),
      makeLogLine({ msg: 'agent log', category: 'agent' }),
      makeLogLine({ msg: 'tool log', category: 'tool_use' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { category: 'agent' })
    assert.equal(result.total, 1)
    assert.equal(result.entries[0]!.msg, 'agent log')
  })

  it('按类别过滤 - system（无 category 的日志）', async () => {
    const lines = [
      makeLogLine({ msg: 'system log' }),
      makeLogLine({ msg: 'agent log', category: 'agent' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { category: 'system' })
    assert.equal(result.total, 1)
    assert.equal(result.entries[0]!.msg, 'system log')
  })

  it('按关键词搜索', async () => {
    const lines = [
      makeLogLine({ msg: 'hello world' }),
      makeLogLine({ msg: 'foo bar' }),
      makeLogLine({ msg: 'Hello Again' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { search: 'hello' })
    assert.equal(result.total, 2)
  })

  it('分页 offset/limit', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { offset: 2, limit: 2 })
    assert.equal(result.total, 5)
    assert.equal(result.entries.length, 2)
    assert.equal(result.entries[0]!.msg, 'msg-2')
    assert.equal(result.entries[1]!.msg, 'msg-3')
    assert.equal(result.hasMore, true)
  })

  it('最后一页 hasMore 为 false', async () => {
    const lines = Array.from({ length: 3 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { offset: 2, limit: 2 })
    assert.equal(result.entries.length, 1)
    assert.equal(result.hasMore, false)
  })

  it('跳过非 JSON 行', async () => {
    const content = [
      'not json at all',
      makeLogLine({ msg: 'valid' }),
      '{ broken json',
    ].join('\n') + '\n'
    writeFileSync(resolve(logsDir, '2026-03-11.log'), content)

    const result = await readLogEntries('2026-03-11', {})
    assert.equal(result.total, 1)
    assert.equal(result.entries[0]!.msg, 'valid')
  })

  it('组合过滤：级别 + 类别 + 搜索', async () => {
    const lines = [
      makeLogLine({ level: 30, category: 'agent', msg: '开始处理消息' }),
      makeLogLine({ level: 50, category: 'agent', msg: '消息处理失败' }),
      makeLogLine({ level: 50, msg: '数据库错误' }),
      makeLogLine({ level: 30, category: 'tool_use', msg: '工具调用: Bash' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', {
      level: 'error',
      category: 'agent',
      search: '失败',
    })
    assert.equal(result.total, 1)
    assert.equal(result.entries[0]!.msg, '消息处理失败')
  })
})

describe('cleanOldLogs', () => {
  beforeEach(() => {
    for (const f of readdirSync(logsDir)) {
      rmSync(resolve(logsDir, f))
    }
  })

  it('删除超过保留天数的日志文件', () => {
    // 创建一个 60 天前的日志
    const old = new Date()
    old.setDate(old.getDate() - 60)
    const oldDate = old.toISOString().split('T')[0]!

    // 今天的日志
    const today = new Date().toISOString().split('T')[0]!

    writeFileSync(resolve(logsDir, `${oldDate}.log`), 'old')
    writeFileSync(resolve(logsDir, `${today}.log`), 'new')

    const deleted = cleanOldLogs(30)
    assert.equal(deleted, 1)

    // 今天的文件还在
    const remaining = readdirSync(logsDir)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0], `${today}.log`)
  })

  it('retainDays 内的文件不删除', () => {
    const today = new Date().toISOString().split('T')[0]!
    writeFileSync(resolve(logsDir, `${today}.log`), 'keep')

    const deleted = cleanOldLogs(7)
    assert.equal(deleted, 0)
    assert.equal(readdirSync(logsDir).length, 1)
  })
})
