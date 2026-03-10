/**
 * System Prompt IPC 文档测试
 *
 * 验证 prompts/system.md 中的 IPC 文档包含 name/description 字段说明
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const systemPromptPath = resolve(import.meta.dir, '../prompts/system.md')
const content = readFileSync(systemPromptPath, 'utf-8')

describe('system.md — IPC 文档', () => {
  test('包含 schedule_task 示例', () => {
    expect(content).toContain('"type": "schedule_task"')
  })

  test('包含 name 字段', () => {
    expect(content).toContain('"name"')
  })

  test('包含 description 字段', () => {
    expect(content).toContain('"description"')
  })

  test('包含 schedule_type 选项说明', () => {
    expect(content).toContain('cron')
    expect(content).toContain('interval')
    expect(content).toContain('once')
  })

  test('包含 pause/resume/cancel 示例', () => {
    expect(content).toContain('"pause_task"')
    expect(content).toContain('"resume_task"')
    expect(content).toContain('"cancel_task"')
  })

  test('包含 current_tasks.json 说明', () => {
    expect(content).toContain('current_tasks.json')
  })

  test('包含 CURRENT_CHAT_ID 替换提示', () => {
    expect(content).toContain('CURRENT_CHAT_ID')
  })

  test('包含可选字段标注 (Optional)', () => {
    expect(content).toContain('Optional task name')
    expect(content).toContain('Optional task description')
  })
})
