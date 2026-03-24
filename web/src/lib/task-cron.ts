export type CronMode = 'daily' | 'weekly' | 'monthly' | 'custom'

export interface CronDraft {
  minute: string
  hour: string
  weekday: string
  dayOfMonth: string
}

const DEFAULT_MINUTE = '00'
const DEFAULT_HOUR = '09'
const DEFAULT_WEEKDAY = '1'
const DEFAULT_DAY_OF_MONTH = '1'

export const DEFAULT_CRON_DRAFT: CronDraft = {
  minute: DEFAULT_MINUTE,
  hour: DEFAULT_HOUR,
  weekday: DEFAULT_WEEKDAY,
  dayOfMonth: DEFAULT_DAY_OF_MONTH,
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function parseNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

function normalizeWeekday(value: string): number | null {
  const parsed = parseNumber(value, 0, 7)
  if (parsed === null) return null
  return parsed === 7 ? 0 : parsed
}

export function createDefaultCronDraft(): CronDraft {
  return { ...DEFAULT_CRON_DRAFT }
}

export function buildCronExpression(mode: Exclude<CronMode, 'custom'>, draft: CronDraft): string {
  const minute = parseNumber(draft.minute, 0, 59) ?? Number(DEFAULT_MINUTE)
  const hour = parseNumber(draft.hour, 0, 23) ?? Number(DEFAULT_HOUR)

  if (mode === 'daily') {
    return `${minute} ${hour} * * *`
  }

  if (mode === 'weekly') {
    const weekday = normalizeWeekday(draft.weekday) ?? Number(DEFAULT_WEEKDAY)
    return `${minute} ${hour} * * ${weekday}`
  }

  const dayOfMonth = parseNumber(draft.dayOfMonth, 1, 31) ?? Number(DEFAULT_DAY_OF_MONTH)
  return `${minute} ${hour} ${dayOfMonth} * *`
}

export function parseCronExpression(value: string): { mode: Exclude<CronMode, 'custom'>; draft: CronDraft } | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 5) return null

  const [minuteRaw, hourRaw, dayRaw, monthRaw, weekdayRaw] = parts
  const minute = parseNumber(minuteRaw, 0, 59)
  const hour = parseNumber(hourRaw, 0, 23)

  if (minute === null || hour === null || monthRaw !== '*') return null

  if (dayRaw === '*' && weekdayRaw === '*') {
    return {
      mode: 'daily',
      draft: {
        minute: pad2(minute),
        hour: pad2(hour),
        weekday: DEFAULT_WEEKDAY,
        dayOfMonth: DEFAULT_DAY_OF_MONTH,
      },
    }
  }

  if (dayRaw === '*') {
    const weekday = normalizeWeekday(weekdayRaw)
    if (weekday === null) return null

    return {
      mode: 'weekly',
      draft: {
        minute: pad2(minute),
        hour: pad2(hour),
        weekday: String(weekday),
        dayOfMonth: DEFAULT_DAY_OF_MONTH,
      },
    }
  }

  if (weekdayRaw === '*') {
    const dayOfMonth = parseNumber(dayRaw, 1, 31)
    if (dayOfMonth === null) return null

    return {
      mode: 'monthly',
      draft: {
        minute: pad2(minute),
        hour: pad2(hour),
        weekday: DEFAULT_WEEKDAY,
        dayOfMonth: String(dayOfMonth),
      },
    }
  }

  return null
}
