import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// 在 import 模块之前设置环境变量
const testDir = resolve(tmpdir(), `youclaw-test-logs-api-${Date.now()}`)
const logsDir = resolve(testDir, 'logs')
process.env.DATA_DIR = testDir
process.env.LOG_LEVEL = 'info'

import { loadEnv } from '../config/env.ts'
loadEnv()

import { createLogsRoutes } from './logs.ts'

const app = createLogsRoutes()

function makeLogLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg: 'test message',
    ...overrides,
  })
}

before(() => {
  mkdirSync(logsDir, { recursive: true })
})

after(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /logs', () => {
  beforeEach(() => {
    for (const f of readdirSync(logsDir)) {
      rmSync(resolve(logsDir, f))
    }
  })

  it('返回日期列表', async () => {
    writeFileSync(resolve(logsDir, '2026-03-10.log'), '')
    writeFileSync(resolve(logsDir, '2026-03-11.log'), '')

    const res = await app.request('/logs')
    assert.equal(res.status, 200)
    const data = await res.json() as string[]
    assert.deepEqual(data, ['2026-03-11', '2026-03-10'])
  })

  it('无日志文件时返回空数组', async () => {
    const res = await app.request('/logs')
    assert.equal(res.status, 200)
    const data = await res.json() as string[]
    assert.deepEqual(data, [])
  })
})

describe('GET /logs/:date', () => {
  beforeEach(() => {
    for (const f of readdirSync(logsDir)) {
      rmSync(resolve(logsDir, f))
    }
  })

  it('返回日志条目', async () => {
    const lines = [
      makeLogLine({ msg: 'hello' }),
      makeLogLine({ msg: 'world' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11')
    assert.equal(res.status, 200)
    const data = await res.json() as { entries: unknown[]; total: number; hasMore: boolean }
    assert.equal(data.total, 2)
    assert.equal(data.entries.length, 2)
    assert.equal(data.hasMore, false)
  })

  it('无效日期格式返回 400', async () => {
    const res = await app.request('/logs/invalid-date')
    assert.equal(res.status, 400)
  })

  it('不存在的日期返回空结果', async () => {
    const res = await app.request('/logs/2099-01-01')
    assert.equal(res.status, 200)
    const data = await res.json() as { entries: unknown[]; total: number }
    assert.equal(data.total, 0)
    assert.equal(data.entries.length, 0)
  })

  it('支持 category 过滤', async () => {
    const lines = [
      makeLogLine({ msg: 'sys', level: 30 }),
      makeLogLine({ msg: 'agent', level: 30, category: 'agent' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?category=agent')
    assert.equal(res.status, 200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }> }
    assert.equal(data.total, 1)
    assert.equal(data.entries[0]!.msg, 'agent')
  })

  it('支持 level 过滤', async () => {
    const lines = [
      makeLogLine({ level: 20, msg: 'debug' }),
      makeLogLine({ level: 50, msg: 'error' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?level=error')
    assert.equal(res.status, 200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }> }
    assert.equal(data.total, 1)
    assert.equal(data.entries[0]!.msg, 'error')
  })

  it('支持 search 过滤', async () => {
    const lines = [
      makeLogLine({ msg: 'hello world' }),
      makeLogLine({ msg: 'foo bar' }),
    ]
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?search=hello')
    assert.equal(res.status, 200)
    const data = await res.json() as { total: number }
    assert.equal(data.total, 1)
  })

  it('支持分页', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine({ msg: `msg-${i}` })
    )
    writeFileSync(resolve(logsDir, '2026-03-11.log'), lines.join('\n') + '\n')

    const res = await app.request('/logs/2026-03-11?offset=2&limit=2')
    assert.equal(res.status, 200)
    const data = await res.json() as { total: number; entries: Array<{ msg: string }>; hasMore: boolean }
    assert.equal(data.total, 5)
    assert.equal(data.entries.length, 2)
    assert.equal(data.entries[0]!.msg, 'msg-2')
    assert.equal(data.hasMore, true)
  })

  it('limit 上限为 500', async () => {
    // 请求 limit=9999 应被限制为 500
    const res = await app.request('/logs/2099-01-01?limit=9999')
    assert.equal(res.status, 200)
  })
})
