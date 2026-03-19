import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRecoveredConversationPrompt, resolveStoredSessionFile } from '../src/agent/context-utils.ts'

describe('agent context utils', () => {
  test('buildRecoveredConversationPrompt injects prior messages and skips current prompt duplicate', () => {
    const prompt = buildRecoveredConversationPrompt([
      { content: 'previous user message', isBotMessage: false },
      { content: 'previous assistant reply', isBotMessage: true },
      { content: 'current message', isBotMessage: false },
    ], 'current message', 6)

    expect(prompt).toContain('<recovered_conversation>')
    expect(prompt).toContain('User: previous user message')
    expect(prompt).toContain('Assistant: previous assistant reply')
    expect(prompt).toEndWith('current message')
  })

  test('resolveStoredSessionFile prefers stored path and falls back to matching session id', () => {
    const dir = resolve(tmpdir(), `youclaw-session-${Date.now()}`)
    mkdirSync(dir, { recursive: true })

    const fallbackPath = resolve(dir, '2026-03-19T12-00-00_session-abc.jsonl')
    writeFileSync(fallbackPath, '{"type":"session","id":"session-abc"}\n')

    expect(resolveStoredSessionFile(dir, {
      sessionId: 'session-abc',
      sessionFile: resolve(dir, 'missing.jsonl'),
    })).toBe(fallbackPath)
  })
})
