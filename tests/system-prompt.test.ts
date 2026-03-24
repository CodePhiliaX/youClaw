/**
 * System Prompt scheduled task documentation tests
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PromptBuilder } from '../src/agent/prompt-builder.ts'
import type { AgentConfig } from '../src/agent/types.ts'
import { loadEnv } from '../src/config/env.ts'

const systemPromptPath = resolve(import.meta.dir, '../prompts/system.md')
const content = readFileSync(systemPromptPath, 'utf-8')

loadEnv()

describe('system.md — task MCP documentation', () => {
  test('contains list/update task MCP tool names', () => {
    expect(content).toContain('mcp__task__list_tasks')
    expect(content).toContain('mcp__task__update_task')
  })

  test('contains action create example with name', () => {
    expect(content).toContain('"action": "create"')
    expect(content).toContain('"name"')
    expect(content).toContain('"chat_id"')
  })

  test('contains schedule_type option descriptions', () => {
    expect(content).toContain('cron')
    expect(content).toContain('interval')
    expect(content).toContain('once')
  })

  test('contains update/pause/resume/delete action examples', () => {
    expect(content).toContain('"action": "update"')
    expect(content).toContain('"action": "pause"')
    expect(content).toContain('"action": "resume"')
    expect(content).toContain('"action": "delete"')
  })

  test('requires list before write operation', () => {
    expect(content).toContain('Always call `mcp__task__list_tasks` before any `mcp__task__update_task` write operation')
  })

  test('does not contain legacy IPC task file guidance', () => {
    expect(content).not.toContain('"type": "schedule_task"')
    expect(content).not.toContain('current_tasks.json')
    expect(content).not.toContain('./data/ipc/')
  })
})

describe('PromptBuilder channel context', () => {
  test('injects wechat-personal media delivery hints for current recipient', () => {
    const builder = new PromptBuilder(null, null)
    const prompt = builder.build(
      resolve(import.meta.dir, '..'),
      { workspaceDir: resolve(import.meta.dir, '..') } as AgentConfig,
      {
        agentId: 'default',
        chatId: 'wxp:wechat-personal-main:user123@im.wechat',
      },
    )

    expect(prompt).toContain('Current channel: wechat-personal')
    expect(prompt).toContain('Current recipient WeChat ID: user123@im.wechat')
    expect(prompt).toContain('This channel supports sending text, images, and files back to the current user.')
    expect(prompt).toContain('`mcp__message__send_to_current_chat`')
    expect(prompt).toContain('do not claim that WeChat cannot send images or files')
  })
})

describe('PromptBuilder channel context', () => {
  test('injects wechat-personal media delivery hints for current recipient', () => {
    const builder = new PromptBuilder(null, null)
    const prompt = builder.build(
      resolve(import.meta.dir, '..'),
      { workspaceDir: resolve(import.meta.dir, '..') } as AgentConfig,
      {
        agentId: 'default',
        chatId: 'wxp:wechat-personal-main:user123@im.wechat',
      },
    )

    expect(prompt).toContain('Current channel: wechat-personal')
    expect(prompt).toContain('Current recipient WeChat ID: user123@im.wechat')
    expect(prompt).toContain('This channel supports sending text, images, and files back to the current user.')
    expect(prompt).toContain('`mcp__message__send_to_current_chat`')
    expect(prompt).toContain('do not claim that WeChat cannot send images or files')
  })
})
