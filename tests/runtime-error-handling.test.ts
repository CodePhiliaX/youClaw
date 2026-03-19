import { describe, expect, test } from 'bun:test'
import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { getLatestAssistantError, normalizeAssistantErrorMessage } from '../src/agent/runtime.ts'

function createMessageEntry(id: string, message: Record<string, unknown>): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: '2026-03-19T00:00:00.000Z',
    message: message as never,
  }
}

describe('runtime error handling', () => {
  test('extracts provider errors from the latest assistant session entry', () => {
    const entries: SessionEntry[] = [
      createMessageEntry('user-1', {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      }),
      createMessageEntry('assistant-1', {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Relay service error\n{"error":"Group zoer_cc_01 has no members"}',
      }),
    ]

    expect(getLatestAssistantError(entries)).toBe('Relay service error: Group zoer_cc_01 has no members')
  })

  test('ignores successful assistant messages with normal text output', () => {
    const entries: SessionEntry[] = [
      createMessageEntry('assistant-1', {
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
      }),
    ]

    expect(getLatestAssistantError(entries)).toBeNull()
  })

  test('falls back to a generic message when the provider omits details', () => {
    expect(normalizeAssistantErrorMessage(undefined, 'error')).toBe('Model returned an error without details.')
    expect(normalizeAssistantErrorMessage(undefined, 'aborted')).toBe('Request was aborted.')
  })

  test('normalizes raw JSON error strings into readable text', () => {
    expect(
      normalizeAssistantErrorMessage('{"error":"Relay service error","message":"Group zoer_cc_01 has no members"}'),
    ).toBe('Relay service error: Group zoer_cc_01 has no members')
  })
})
