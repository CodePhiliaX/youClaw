export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week'

export interface IntervalInput {
  value: string
  unit: IntervalUnit
}

export const INTERVAL_UNITS: IntervalUnit[] = ['minute', 'hour', 'day', 'week']

const INTERVAL_UNIT_MS: Record<IntervalUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

const SHORT_UNIT_LABELS: Record<IntervalUnit, string> = {
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
}

const ROUNDTRIP_UNIT_ORDER: IntervalUnit[] = ['week', 'day', 'hour', 'minute']

function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000
  return String(rounded)
}

export function buildIntervalScheduleValue(value: string, unit: IntervalUnit): string | null {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const scheduleValue = Math.round(amount * INTERVAL_UNIT_MS[unit])
  if (!Number.isFinite(scheduleValue) || scheduleValue <= 0) return null

  return String(scheduleValue)
}

export function parseIntervalScheduleValue(scheduleValue: string): IntervalInput {
  const ms = Number(scheduleValue)
  if (!Number.isFinite(ms) || ms <= 0) {
    return { value: scheduleValue, unit: 'minute' }
  }

  for (const unit of ROUNDTRIP_UNIT_ORDER) {
    const unitMs = INTERVAL_UNIT_MS[unit]
    if (ms >= unitMs && Number.isInteger(ms / unitMs)) {
      return {
        value: formatNumericValue(ms / unitMs),
        unit,
      }
    }
  }

  return {
    value: formatNumericValue(ms / INTERVAL_UNIT_MS.minute),
    unit: 'minute',
  }
}

export function formatIntervalLabel(scheduleValue: string): string {
  const ms = Number.parseInt(scheduleValue, 10)
  if (Number.isNaN(ms)) return `every ${scheduleValue}`
  if (ms < 60_000) return `every ${formatNumericValue(ms / 1000)}s`

  const interval = parseIntervalScheduleValue(scheduleValue)
  return `every ${interval.value}${SHORT_UNIT_LABELS[interval.unit]}`
}
