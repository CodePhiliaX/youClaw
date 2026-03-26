/**
 * System Prompt scheduled task documentation tests
 */

import { describe, test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { PromptBuilder } from '../src/agent/prompt-builder.ts'
import type { AgentConfig } from '../src/agent/types.ts'
import { loadEnv } from '../src/config/env.ts'
import { initLogger } from '../src/logger/index.ts'
import { tmpdir } from 'node:os'
import { clearAllBootstrapSnapshots } from '../src/agent/bootstrap-cache.ts'

const systemPromptPath = resolve(import.meta.dir, '../prompts/system.md')
const content = readFileSync(systemPromptPath, 'utf-8')

loadEnv()
initLogger()

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

  test('injects provided skills prompt and memory context overrides', () => {
    const builder = new PromptBuilder(null, null)
    const prompt = builder.build(
      resolve(import.meta.dir, '..'),
      { workspaceDir: resolve(import.meta.dir, '..') } as AgentConfig,
      {
        agentId: 'default',
        chatId: 'web:chat-1',
        skillsPrompt: '<available_skills>\n  <skill>\n    <name>call-me-dad</name>\n  </skill>\n</available_skills>',
        memoryContext: '<memory>\nretrieved hit\n</memory>',
      },
    )

    expect(prompt).toContain('## Skills (mandatory)')
    expect(prompt).toContain('Before replying: scan <available_skills> <description> entries.')
    expect(prompt).toContain('call-me-dad')
    expect(prompt).toContain('<available_skills>')
    expect(prompt).toContain('<memory>')
    expect(prompt).toContain('retrieved hit')
  })
})

describe('PromptBuilder bootstrap snapshots', () => {
  test('reuses injected bootstrap docs within the same chat until snapshot is cleared', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'youclaw-bootstrap-snapshot-'))
    try {
      writeFileSync(resolve(workspaceDir, 'AGENTS.md'), '# Agents\n')
      writeFileSync(resolve(workspaceDir, 'SOUL.md'), '# Soul\n')
      writeFileSync(resolve(workspaceDir, 'TOOLS.md'), '# Tools\n')
      writeFileSync(resolve(workspaceDir, 'IDENTITY.md'), '# Identity\n')
      writeFileSync(resolve(workspaceDir, 'USER.md'), 'alpha')
      writeFileSync(resolve(workspaceDir, 'HEARTBEAT.md'), '# Heartbeat\n')
      writeFileSync(resolve(workspaceDir, 'BOOTSTRAP.md'), '# Bootstrap\n')

      const builder = new PromptBuilder(null, null)
      const baseConfig = { workspaceDir } as AgentConfig
      const first = builder.build(workspaceDir, baseConfig, { agentId: 'a1', chatId: 'web:chat-1' })
      writeFileSync(resolve(workspaceDir, 'USER.md'), 'beta')
      const second = builder.build(workspaceDir, baseConfig, { agentId: 'a1', chatId: 'web:chat-1' })
      clearAllBootstrapSnapshots()
      const third = builder.build(workspaceDir, baseConfig, { agentId: 'a1', chatId: 'web:chat-1' })

      expect(first).toContain('alpha')
      expect(second).toContain('alpha')
      expect(second).not.toContain('beta')
      expect(third).toContain('beta')
    } finally {
      clearAllBootstrapSnapshots()
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  })
})
