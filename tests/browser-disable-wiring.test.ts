import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('browser disable wiring', () => {
  test('chat input forwards null when the user selects no browser profile', () => {
    const chatInput = read('web/src/components/chat/ChatInput.tsx')
    expect(chatInput).toContain('send(\n      text,\n      selectedProfileId,')
  })

  test('messages route accepts nullable browserProfileId to represent explicit disable', () => {
    const messagesRoute = read('src/routes/messages.ts')
    expect(messagesRoute).toContain('browserProfileId: z.string().nullable().optional()')
  })
})
