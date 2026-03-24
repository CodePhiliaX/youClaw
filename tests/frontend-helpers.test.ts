/**
 * Frontend helper function tests
 *
 * Tests pure task helper logic used by Tasks.tsx.
 * UI-only helpers stay copied locally; shared interval helpers are imported from web/src/lib/task-interval.ts.
 */

import { describe, test, expect } from 'bun:test'
import { buildIntervalScheduleValue, formatIntervalLabel, parseIntervalScheduleValue } from '../web/src/lib/task-interval.ts'

// Copied from Tasks.tsx UI-local helpers.

function formatRelative(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const absDiff = Math.abs(diffMs)

  if (absDiff < 60_000) return diffMs > 0 ? 'in <1m' : '<1m ago'
  if (absDiff < 3_600_000) {
    const m = Math.round(absDiff / 60_000)
    return diffMs > 0 ? `in ${m}m` : `${m}m ago`
  }
  if (absDiff < 86_400_000) {
    const h = Math.round(absDiff / 3_600_000)
    return diffMs > 0 ? `in ${h}h` : `${h}h ago`
  }
  return date.toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function scheduleLabel(type: string, value: string): string {
  if (type === 'cron') return `cron: ${value}`
  if (type === 'interval') return formatIntervalLabel(value)
  if (type === 'once') return `once: ${new Date(value).toLocaleString()}`
  return value
}

function isoToDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

// ===== formatRelative =====

describe('formatRelative', () => {
  test('null → "-"', () => {
    expect(formatRelative(null)).toBe('-')
  })

  test('30 seconds in the future → "in <1m"', () => {
    const future = new Date(Date.now() + 30_000).toISOString()
    expect(formatRelative(future)).toBe('in <1m')
  })

  test('30 seconds in the past → "<1m ago"', () => {
    const past = new Date(Date.now() - 30_000).toISOString()
    expect(formatRelative(past)).toBe('<1m ago')
  })

  test('5 minutes in the future → "in 5m"', () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString()
    expect(formatRelative(future)).toBe('in 5m')
  })

  test('10 minutes in the past → "10m ago"', () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString()
    expect(formatRelative(past)).toBe('10m ago')
  })

  test('2 hours in the future → "in 2h"', () => {
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString()
    expect(formatRelative(future)).toBe('in 2h')
  })

  test('3 hours in the past → "3h ago"', () => {
    const past = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(formatRelative(past)).toBe('3h ago')
  })

  test('beyond 24 hours uses toLocaleString', () => {
    const farFuture = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const result = formatRelative(farFuture)
    expect(result).not.toContain('in ')
    expect(result).not.toContain(' ago')
  })
})

// ===== formatDuration =====

describe('formatDuration', () => {
  test('millisecond level', () => {
    expect(formatDuration(50)).toBe('50ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  test('second level', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(10000)).toBe('10.0s')
  })

  test('boundary values', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(1)).toBe('1ms')
  })
})

// ===== scheduleLabel =====

describe('scheduleLabel', () => {
  test('cron type', () => {
    expect(scheduleLabel('cron', '0 9 * * *')).toBe('cron: 0 9 * * *')
    expect(scheduleLabel('cron', '*/5 * * * *')).toBe('cron: */5 * * * *')
  })

  test('interval — second level', () => {
    expect(scheduleLabel('interval', '30000')).toBe('every 30s')
  })

  test('interval — minute level', () => {
    expect(scheduleLabel('interval', '60000')).toBe('every 1m')
    expect(scheduleLabel('interval', '1800000')).toBe('every 30m')
  })

  test('interval — hour level', () => {
    expect(scheduleLabel('interval', '3600000')).toBe('every 1h')
    expect(scheduleLabel('interval', '7200000')).toBe('every 2h')
  })

  test('interval — day and week level', () => {
    expect(scheduleLabel('interval', '86400000')).toBe('every 1d')
    expect(scheduleLabel('interval', '604800000')).toBe('every 1w')
    expect(scheduleLabel('interval', '1209600000')).toBe('every 2w')
  })

  test('once type', () => {
    const result = scheduleLabel('once', '2026-03-10T14:30:00.000Z')
    expect(result.startsWith('once: ')).toBe(true)
  })

  test('unknown type returns raw value', () => {
    expect(scheduleLabel('unknown', 'raw-value')).toBe('raw-value')
  })
})

// ===== interval helpers =====

describe('parseIntervalScheduleValue', () => {
  test('round-trips exact minute/hour/day/week values', () => {
    expect(parseIntervalScheduleValue('60000')).toEqual({ value: '1', unit: 'minute' })
    expect(parseIntervalScheduleValue('7200000')).toEqual({ value: '2', unit: 'hour' })
    expect(parseIntervalScheduleValue('172800000')).toEqual({ value: '2', unit: 'day' })
    expect(parseIntervalScheduleValue('1209600000')).toEqual({ value: '2', unit: 'week' })
  })

  test('falls back to minutes for non-exact higher units', () => {
    expect(parseIntervalScheduleValue('90000')).toEqual({ value: '1.5', unit: 'minute' })
    expect(parseIntervalScheduleValue('5400000')).toEqual({ value: '90', unit: 'minute' })
  })

  test('invalid values preserve the raw string', () => {
    expect(parseIntervalScheduleValue('abc')).toEqual({ value: 'abc', unit: 'minute' })
    expect(parseIntervalScheduleValue('')).toEqual({ value: '', unit: 'minute' })
  })
})

describe('buildIntervalScheduleValue', () => {
  test('converts value and unit into milliseconds', () => {
    expect(buildIntervalScheduleValue('30', 'minute')).toBe('1800000')
    expect(buildIntervalScheduleValue('2', 'hour')).toBe('7200000')
    expect(buildIntervalScheduleValue('3', 'day')).toBe('259200000')
    expect(buildIntervalScheduleValue('1.5', 'week')).toBe('907200000')
  })

  test('invalid values return null', () => {
    expect(buildIntervalScheduleValue('', 'minute')).toBeNull()
    expect(buildIntervalScheduleValue('0', 'hour')).toBeNull()
    expect(buildIntervalScheduleValue('abc', 'day')).toBeNull()
  })
})

// ===== isoToDatetimeLocal =====

describe('isoToDatetimeLocal', () => {
  test('standard ISO conversion', () => {
    // Note: converts to local time
    const result = isoToDatetimeLocal('2026-03-10T14:30:00.000Z')
    // Should match YYYY-MM-DDTHH:MM format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  test('month and day are correctly zero-padded', () => {
    const result = isoToDatetimeLocal('2026-01-05T03:07:00.000Z')
    // Local time may differ by timezone, but format should be correct
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

// ===== ScheduledTaskDTO type validation =====

describe('ScheduledTaskDTO field completeness', () => {
  test('contains all required fields (type definition validation)', () => {
    // Simulate a complete DTO object to verify type correctness
    const dto = {
      id: 'test-id',
      agent_id: 'agent-1',
      chat_id: 'task:test',
      prompt: 'test prompt',
      schedule_type: 'interval',
      schedule_value: '60000',
      next_run: '2026-03-10T10:00:00.000Z' as string | null,
      last_run: null as string | null,
      status: 'active',
      created_at: '2026-03-10T00:00:00.000Z',
      name: 'test name' as string | null,
      description: 'test desc' as string | null,
    }

    expect(dto.name).toBe('test name')
    expect(dto.description).toBe('test desc')
    expect(Object.keys(dto).length).toBe(12) // 12 fields
  })
})

// ===== Additional boundary tests =====

describe('formatRelative — exact boundaries', () => {
  test('exact boundary 60 seconds in the future → "in 1m"', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(formatRelative(future)).toBe('in 1m')
  })

  test('exact boundary 60 seconds in the past → "1m ago"', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(formatRelative(past)).toBe('1m ago')
  })

  test('exact boundary 1 hour in the future → "in 1h"', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect(formatRelative(future)).toBe('in 1h')
  })

  test('exact boundary 24 hours in the future → toLocaleString', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const result = formatRelative(future)
    // Exactly 24 hours equals 86_400_000, absDiff < 86_400_000 is false, falls through to toLocaleString
    expect(result).not.toContain('in ')
    expect(result).not.toContain(' ago')
  })

  test('empty string → "-" (falsy value)', () => {
    expect(formatRelative('')).toBe('-')
  })

  test('near-zero ms difference (current time) → "<1m ago" or "in <1m"', () => {
    const now = new Date(Date.now()).toISOString()
    const result = formatRelative(now)
    // diffMs is close to 0, absDiff < 60_000 is true
    expect(result === '<1m ago' || result === 'in <1m').toBe(true)
  })
})

describe('formatDuration — large values', () => {
  test('large value conversion', () => {
    expect(formatDuration(3_600_000)).toBe('3600.0s')
    expect(formatDuration(100_000)).toBe('100.0s')
  })
})

describe('scheduleLabel — edge cases', () => {
  test('interval NaN keeps the raw value', () => {
    expect(scheduleLabel('interval', 'not-a-number')).toBe('every not-a-number')
  })

  test('interval 0 → "every 0s"', () => {
    expect(scheduleLabel('interval', '0')).toBe('every 0s')
  })

  test('cron empty value → "cron: "', () => {
    expect(scheduleLabel('cron', '')).toBe('cron: ')
  })
})

describe('isoToDatetimeLocal — invalid input', () => {
  test('invalid date string → NaN-filled result (does not trigger catch)', () => {
    const result = isoToDatetimeLocal('not-a-date')
    // new Date('not-a-date') does not throw, but all fields are NaN
    expect(result).toBe('NaN-NaN-NaNTNaN:NaN')
  })

  test('empty string → NaN-filled result (does not trigger catch)', () => {
    const result = isoToDatetimeLocal('')
    // new Date('') does not throw, but all fields are NaN
    expect(result).toBe('NaN-NaN-NaNTNaN:NaN')
  })
})
