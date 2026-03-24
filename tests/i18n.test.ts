/**
 * i18n translation completeness tests
 *
 * Verify that Chinese and English translation keys are fully consistent,
 * especially the newly added tasks-related keys
 */

import { describe, test, expect } from 'bun:test'
import { en } from '../web/src/i18n/en.ts'
import { zh } from '../web/src/i18n/zh.ts'

/** Recursively extract all key paths */
function getKeys(obj: Record<string, any>, prefix = ''): string[] {
  const keys: string[] = []
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      keys.push(...getKeys(obj[key], fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys.sort()
}

describe('i18n translation completeness', () => {
  test('all keys in en and zh are identical', () => {
    const enKeys = getKeys(en)
    const zhKeys = getKeys(zh)
    expect(enKeys).toEqual(zhKeys)
  })

  test('no empty string values in en', () => {
    const checkEmpty = (obj: Record<string, any>, path = ''): string[] => {
      const empties: string[] = []
      for (const [key, val] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key
        if (typeof val === 'object' && val !== null) {
          empties.push(...checkEmpty(val, fullPath))
        } else if (val === '') {
          empties.push(fullPath)
        }
      }
      return empties
    }
    const empties = checkEmpty(en)
    expect(empties).toEqual([])
  })

  test('no empty string values in zh', () => {
    const checkEmpty = (obj: Record<string, any>, path = ''): string[] => {
      const empties: string[] = []
      for (const [key, val] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key
        if (typeof val === 'object' && val !== null) {
          empties.push(...checkEmpty(val, fullPath))
        } else if (val === '') {
          empties.push(fullPath)
        }
      }
      return empties
    }
    const empties = checkEmpty(zh)
    expect(empties).toEqual([])
  })
})

describe('i18n — newly added tasks keys exist', () => {
  const requiredTaskKeys = [
    'editTitle',
    'name',
    'namePlaceholder',
    'description',
    'descriptionPlaceholder',
    'clone',
    'search',
    'noName',
    'enable',
    'disable',
    'confirmDelete',
    'saving',
    'selectTask',
    'schedule',
    'nextRun',
    'cronDaily',
    'cronWeekly',
    'cronMonthly',
    'cronCustom',
    'weekday',
    'dayOfMonth',
    'cronPreview',
    'cronCustomHelp',
    'weekdayMonday',
    'weekdayTuesday',
    'weekdayWednesday',
    'weekdayThursday',
    'weekdayFriday',
    'weekdaySaturday',
    'weekdaySunday',
  ]

  for (const key of requiredTaskKeys) {
    test(`en.tasks.${key} exists`, () => {
      expect((en.tasks as any)[key]).toBeDefined()
      expect((en.tasks as any)[key]).not.toBe('')
    })

    test(`zh.tasks.${key} exists`, () => {
      expect((zh.tasks as any)[key]).toBeDefined()
      expect((zh.tasks as any)[key]).not.toBe('')
    })
  }
})

describe('i18n — original keys are not broken', () => {
  const coreTaskKeys = [
    'title', 'createTask', 'noTasks', 'noTasksHint', 'runNow',
    'pause', 'resume', 'prompt', 'taskId', 'created', 'lastRun',
    'recentRuns', 'noRuns', 'createTitle', 'agent', 'promptPlaceholder',
    'scheduleType', 'interval', 'cron', 'once', 'intervalMinutes',
    'cronExpression', 'runAt', 'hour', 'minute', 'day', 'week',
    'intervalPlaceholder', 'cronPlaceholder',
    'cronHelp', 'allRequired', 'invalidInterval', 'invalidDate', 'creating',
  ]

  for (const key of coreTaskKeys) {
    test(`en.tasks.${key} still exists`, () => {
      expect((en.tasks as any)[key]).toBeDefined()
    })

    test(`zh.tasks.${key} still exists`, () => {
      expect((zh.tasks as any)[key]).toBeDefined()
    })
  }
})
