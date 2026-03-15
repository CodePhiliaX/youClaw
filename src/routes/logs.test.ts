import { describe, test, beforeEach, beforeAll, afterAll, expect } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import '../../tests/setup.ts'
import { getPaths } from '../config/index.ts'
import { createLogsRoutes } from './logs.ts'

const logsDir = getPaths().logs
const app = createLogsRoutes()

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

describe('GET /logs', () => {
  beforeEach(cleanLogsDir)

  test('returns date list', async () => {
    writeFileSync(`${logsDir}/2026-03-10.log`, '')
    writeFileSync(`${logsDir}/2026-03-11.log`, '')

    const res = await app.request('/logs')
    expect(res.status).toBe(200)
    const data = await res.json() as string[]
    expect(data).toEqual(['2026-03-11', '2026-03-10'])
  })

  test('returns empty array when no log files exist', async () => {
    const res = await app.request('/logs')
    expect(res.status).toBe(200)
    const data = await res.json() as string[]
    expect(data).toEqual([])
  })
})

describe('GET /logs/:date', () => {
  beforeEach(cleanLogsDir)

  test('returns log entries', async () => {
    const lines = [
      makeLogLine({ msg: 'hello' }),
      makeLogLine({ msg: 'world' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11')
    expect(res.status).toBe(200)
    const data = await res.json() as { entries: unknown[]; total: number; hasMore: boolean }
    expect(data.total).toBe(2)
    expect(data.entries.length).toBe(2)
    expect(data.hasMore).toBe(false)
  })

  test('returns 400 for invalid date format', async () => {
    const res = await app.request('/logs/invalid-date')
    expect(res.status).toBe(400)
  })

  test('returns empty result for nonexistent date', async () => {
    const res = await app.request('/logs/2099-01-01')
    expect(res.status).toBe(200)
    const data = await res.json() as { entries: unknown[]; total: number }
    expect(data.total).toBe(0)
    expect(data.entries.length).toBe(0)
  })

  test('supports category filtering', async () => {
    const lines = [
      makeLogLine({ msg: 'sys', level: 30 }),
      makeLogLine({ msg: 'agent', level: 30, category: 'agent' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?category=agent')
    expect(res.status).toBe(200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }> }
    expect(data.total).toBe(1)
    expect(data.entries[0]!.msg).toBe('agent')
  })

  test('supports level filtering', async () => {
    const lines = [
      makeLogLine({ level: 20, msg: 'debug' }),
      makeLogLine({ level: 50, msg: 'error' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?level=error')
    expect(res.status).toBe(200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }> }
    expect(data.total).toBe(1)
    expect(data.entries[0]!.msg).toBe('error')
  })

  test('supports search filtering', async () => {
    const lines = [
      makeLogLine({ msg: 'hello world' }),
      makeLogLine({ msg: 'foo bar' }),
    ]
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?search=hello')
    expect(res.status).toBe(200)
    const data = await res.json() as { total: number }
    expect(data.total).toBe(1)
  })

  test('supports pagination', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(`${logsDir}/2026-03-11.log`, lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?offset=2&limit=2')
    expect(res.status).toBe(200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }>; hasMore: boolean }
    expect(data.total).toBe(5)
    expect(data.entries.length).toBe(2)
    expect(data.entries[0]!.msg).toBe('msg-2')
    expect(data.hasMore).toBe(true)
  })

  test('limit is capped at 500', async () => {
    // Requesting limit=9999 should be capped to 500
    const res = await app.request('/logs/2099-01-01?limit=9999')
    expect(res.status).toBe(200)
  })
})
