import { resolve } from 'node:path'
import { readdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { getPaths } from '../config/index.ts'

export interface PinoLogEntry {
  level: number
  time: number
  msg: string
  category?: string  // 'agent' | 'tool_use' | 'task' | undefined (system logs)
  agentId?: string
  chatId?: string
  tool?: string
  durationMs?: number
  [key: string]: unknown
}

const LEVEL_MAP: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
}

/** Get all log dates in descending order */
export function getLogDates(): string[] {
  const logsDir = getPaths().logs
  try {
    return readdirSync(logsDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => f.replace('.log', ''))
      .sort((a, b) => b.localeCompare(a))
  } catch { return [] }
}

/** Read log entries for a given date, with level/category/keyword filtering and pagination */
export async function readLogEntries(date: string, options: {
  level?: string
  category?: string    // 'agent' | 'tool_use' | 'system'
  search?: string
  offset?: number
  limit?: number
}): Promise<{ entries: PinoLogEntry[]; total: number; hasMore: boolean }> {
  const filePath = resolve(getPaths().logs, `${date}.log`)
  if (!existsSync(filePath)) return { entries: [], total: 0, hasMore: false }

  const text = readFileSync(filePath, 'utf-8')
  const lines = text.split('\n').filter(Boolean)

  const minLevel = options.level ? (LEVEL_MAP[options.level] ?? 0) : 0
  const search = options.search?.toLowerCase()
  const offset = options.offset ?? 0
  const limit = options.limit ?? 100

  const filtered: PinoLogEntry[] = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as PinoLogEntry
      if (entry.level < minLevel) continue
      // Category filter: 'system' matches entries without a category
      if (options.category) {
        if (options.category === 'system' && entry.category) continue
        if (options.category !== 'system' && entry.category !== options.category) continue
      }
      if (search && !JSON.stringify(entry).toLowerCase().includes(search)) continue
      filtered.push(entry)
    } catch { /* skip non-JSON lines */ }
  }

  const total = filtered.length
  const entries = filtered.slice(offset, offset + limit)
  return { entries, total, hasMore: offset + limit < total }
}

/** Delete log files older than retainDays */
export function cleanOldLogs(retainDays: number): number {
  const logsDir = getPaths().logs
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retainDays)
  const cutoffStr = cutoff.toISOString().split('T')[0]!

  let deleted = 0
  for (const date of getLogDates()) {
    if (date < cutoffStr) {
      try { unlinkSync(resolve(logsDir, `${date}.log`)); deleted++ } catch {}
    }
  }
  return deleted
}
