/**
 * System Prompt IPC documentation tests
 *
 * Verify that prompts/system.md IPC documentation includes name/description field descriptions
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const systemPromptPath = resolve(import.meta.dir, '../prompts/system.md')
const content = readFileSync(systemPromptPath, 'utf-8')

describe('system.md — IPC documentation', () => {
  test('contains schedule_task example', () => {
    expect(content).toContain('"type": "schedule_task"')
  })

  test('contains name field', () => {
    expect(content).toContain('"name"')
  })

  test('contains description field', () => {
    expect(content).toContain('"description"')
  })

  test('contains schedule_type option descriptions', () => {
    expect(content).toContain('cron')
    expect(content).toContain('interval')
    expect(content).toContain('once')
  })

  test('contains pause/resume/cancel examples', () => {
    expect(content).toContain('"pause_task"')
    expect(content).toContain('"resume_task"')
    expect(content).toContain('"cancel_task"')
  })

  test('contains current_tasks.json description', () => {
    expect(content).toContain('current_tasks.json')
  })

  test('contains CURRENT_CHAT_ID replacement hint', () => {
    expect(content).toContain('CURRENT_CHAT_ID')
  })

  test('contains optional field annotations (Optional)', () => {
    expect(content).toContain('Optional task name')
    expect(content).toContain('Optional task description')
  })
})
