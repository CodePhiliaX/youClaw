/**
 * i18n 翻译完整性测试
 *
 * 验证中英文翻译 key 完全一致，特别是新增的 tasks 相关 key
 */

import { describe, test, expect } from 'bun:test'
import { en } from '../web/src/i18n/en.ts'
import { zh } from '../web/src/i18n/zh.ts'

/** 递归提取所有 key 路径 */
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

describe('i18n 翻译完整性', () => {
  test('en 和 zh 的所有 key 完全一致', () => {
    const enKeys = getKeys(en)
    const zhKeys = getKeys(zh)
    expect(enKeys).toEqual(zhKeys)
  })

  test('en 中不存在空字符串值', () => {
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

  test('zh 中不存在空字符串值', () => {
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

describe('i18n — tasks 新增 key 存在', () => {
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
  ]

  for (const key of requiredTaskKeys) {
    test(`en.tasks.${key} 存在`, () => {
      expect((en.tasks as any)[key]).toBeDefined()
      expect((en.tasks as any)[key]).not.toBe('')
    })

    test(`zh.tasks.${key} 存在`, () => {
      expect((zh.tasks as any)[key]).toBeDefined()
      expect((zh.tasks as any)[key]).not.toBe('')
    })
  }
})

describe('i18n — 原有 key 未被破坏', () => {
  const coreTaskKeys = [
    'title', 'createTask', 'noTasks', 'noTasksHint', 'runNow',
    'pause', 'resume', 'prompt', 'taskId', 'created', 'lastRun',
    'recentRuns', 'noRuns', 'createTitle', 'agent', 'promptPlaceholder',
    'scheduleType', 'interval', 'cron', 'once', 'intervalMinutes',
    'cronExpression', 'runAt', 'intervalPlaceholder', 'cronPlaceholder',
    'cronHelp', 'allRequired', 'invalidInterval', 'invalidDate', 'creating',
  ]

  for (const key of coreTaskKeys) {
    test(`en.tasks.${key} 仍然存在`, () => {
      expect((en.tasks as any)[key]).toBeDefined()
    })

    test(`zh.tasks.${key} 仍然存在`, () => {
      expect((zh.tasks as any)[key]).toBeDefined()
    })
  }
})
