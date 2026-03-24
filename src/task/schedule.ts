import { Cron } from 'croner'
import type { ScheduledTask } from '../db/index.ts'

// Backoff delay tiers (ms): 30s, 1m, 5m, 15m, 60m
const BACKOFF_DELAYS = [30_000, 60_000, 300_000, 900_000, 3_600_000]

export type TaskScheduleLike = Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'last_run'> & {
  timezone?: string | null
}

export function calculateTaskNextRun(
  task: TaskScheduleLike,
  options?: { consecutiveFailures?: number },
): string | null {
  const now = new Date()
  let nextTime: Date | null = null

  switch (task.schedule_type) {
    case 'cron': {
      const cronOpts: { timezone?: string } = {}
      if (task.timezone) cronOpts.timezone = task.timezone
      const job = new Cron(task.schedule_value, cronOpts)
      nextTime = job.nextRun()
      break
    }
    case 'interval': {
      const intervalMs = parseInt(task.schedule_value, 10)
      if (isNaN(intervalMs) || intervalMs <= 0) return null
      const base = task.last_run ? new Date(task.last_run) : now
      nextTime = new Date(base.getTime() + intervalMs)
      break
    }
    case 'once': {
      if (!options?.consecutiveFailures) return null
      nextTime = now
      break
    }
    default:
      return null
  }

  if (!nextTime) return null

  const failures = options?.consecutiveFailures ?? 0
  if (failures > 0) {
    const backoffIdx = Math.min(failures - 1, BACKOFF_DELAYS.length - 1)
    const backoffMs = BACKOFF_DELAYS[backoffIdx]!
    const backoffTime = new Date(now.getTime() + backoffMs)
    if (backoffTime.getTime() > nextTime.getTime()) {
      nextTime = backoffTime
    }
  }

  return nextTime.toISOString()
}
