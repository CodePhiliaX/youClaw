import { describe, test, beforeEach, beforeAll, afterAll, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import '../../tests/setup.ts'
import { getPaths } from '../config/index.ts'
import { getLogDates, readLogEntries, cleanOldLogs } from './reader.ts'

const logsDir = getPaths().logs

// Sample log line
function makeLogLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg: 'test message',
    ...overrides,
  })
}

beforeAll(() => {
  mkdirSync(logsDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(logsDir)) {
    rmSync(logsDir, { recursive: true, force: true })
  }
})

function cleanLogsDir() {
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true })
    return
  }
  for (const f of readdirSync(logsDir)) {
    rmSync(`${logsDir}/${f}`)
  }
}

describe('getLogDates', () => {
  beforeEach(cleanLogsDir)

  test('returns empty array when directory has no log files', () => {
    const dates = getLogDates()
    expect(dates).toEqual([])
  })

  test('returns dates in descending order', () => {
    writeFileSync(`${logsDir}/2026-03-09.log`, '')
    writeFileSync(`${logsDir}/2026-03-11.log`, '')
    writeFileSync(`${logsDir}/2026-03-10.log`, '')
    // Non-log files should be ignored
    writeFileSync(`${logsDir}/random.txt`, '')

    const dates = getLogDates()
    expect(dates).toEqual(['2026-03-11', '2026-03-10', '2026-03-09'])
  })
})

describe('readLogEntries', () => {
  beforeEach(cleanLogsDir)

  test('returns empty result when file does not exist', async () => {
    const result = await readLogEntries('2099-01-01', {})
    expect(result).toEqual({ entries: [], total: 0, hasMore: false })
  })

  test('reads and parses all log lines', async () => {
    const lines = [
      makeLogLine({ msg: 'first', time: 1000 }),
      makeLogLine({ msg: 'second', time: 2000 }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', {})
    expect(result.total).toBe(2)
    expect(result.entries.length).toBe(2)
    expect(result.entries[0]!.msg).toBe('first')
    expect(result.entries[1]!.msg).toBe('second')
    expect(result.hasMore).toBe(false)
  })

  test('filters by level', async () => {
    const lines = [
      makeLogLine({ level: 20, msg: 'debug msg' }),
      makeLogLine({ level: 30, msg: 'info msg' }),
      makeLogLine({ level: 40, msg: 'warn msg' }),
      makeLogLine({ level: 50, msg: 'error msg' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { level: 'warn' })
    expect(result.total).toBe(2)
    expect(result.entries[0]!.msg).toBe('warn msg')
    expect(result.entries[1]!.msg).toBe('error msg')
  })

  test('filters by category - agent', async () => {
    const lines = [
      makeLogLine({ msg: 'system log' }),
      makeLogLine({ msg: 'agent log', category: 'agent' }),
      makeLogLine({ msg: 'tool log', category: 'tool_use' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { category: 'agent' })
    expect(result.total).toBe(1)
    expect(result.entries[0]!.msg).toBe('agent log')
  })

  test('filters by category - system (logs without category)', async () => {
    const lines = [
      makeLogLine({ msg: 'system log' }),
      makeLogLine({ msg: 'agent log', category: 'agent' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { category: 'system' })
    expect(result.total).toBe(1)
    expect(result.entries[0]!.msg).toBe('system log')
  })

  test('searches by keyword', async () => {
    const lines = [
      makeLogLine({ msg: 'hello world' }),
      makeLogLine({ msg: 'foo bar' }),
      makeLogLine({ msg: 'Hello Again' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { search: 'hello' })
    expect(result.total).toBe(2)
  })

  test('pagination offset/limit', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { offset: 2, limit: 2 })
    expect(result.total).toBe(5)
    expect(result.entries.length).toBe(2)
    expect(result.entries[0]!.msg).toBe('msg-2')
    expect(result.entries[1]!.msg).toBe('msg-3')
    expect(result.hasMore).toBe(true)
  })

  test('last page hasMore is false', async () => {
    const lines = Array.from({ length: 3 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', { offset: 2, limit: 2 })
    expect(result.entries.length).toBe(1)
    expect(result.hasMore).toBe(false)
  })

  test('skips non-JSON lines', async () => {
    const content = [
      'not json at all',
      makeLogLine({ msg: 'valid' }),
      '{ broken json',
    ].join('\n') + '\n'
    writeFileSync(`${logsDir}/2026-03-11.log`, content)

    const result = await readLogEntries('2026-03-11', {})
    expect(result.total).toBe(1)
    expect(result.entries[0]!.msg).toBe('valid')
  })

  test('combined filter: level + category + search', async () => {
    const lines = [
      makeLogLine({ level: 30, category: 'agent', msg: 'start processing message' }),
      makeLogLine({ level: 50, category: 'agent', msg: 'message processing failed' }),
      makeLogLine({ level: 50, msg: 'database error' }),
      makeLogLine({ level: 30, category: 'tool_use', msg: 'tool call: Bash' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const result = await readLogEntries('2026-03-11', {
      level: 'error',
      category: 'agent',
      search: 'failed',
    })
    expect(result.total).toBe(1)
    expect(result.entries[0]!.msg).toBe('message processing failed')
  })
})

describe('cleanOldLogs', () => {
  beforeEach(cleanLogsDir)

  test('deletes log files older than retention days', () => {
    // Create a 60-day-old log
    const old = new Date()
    old.setDate(old.getDate() - 60)
    const oldDate = old.toISOString().split('T')[0]!

    // Today's log
    const today = new Date().toISOString().split('T')[0]!

    writeFileSync(`${logsDir}/${oldDate}.log`, 'old')
    writeFileSync(`${logsDir}/${today}.log`, 'new')

    const deleted = cleanOldLogs(30)
    expect(deleted).toBe(1)

    // Today's file remains
    const remaining = readdirSync(logsDir)
    expect(remaining.length).toBe(1)
    expect(remaining[0]).toBe(`${today}.log`)
  })

  test('files within retainDays are not deleted', () => {
    const today = new Date().toISOString().split('T')[0]!
    writeFileSync(`${logsDir}/${today}.log`, 'keep')

    const deleted = cleanOldLogs(7)
    expect(deleted).toBe(0)
    expect(readdirSync(logsDir).length).toBe(1)
  })
})
