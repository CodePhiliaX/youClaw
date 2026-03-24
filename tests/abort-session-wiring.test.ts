import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('abort session wiring', () => {
  test('runtime clears saved session on abort and skips empty abort completions', () => {
    const runtime = read('src/agent/runtime.ts')

    expect(runtime).toContain('if (aborted) {\n        deleteSession(agentId, chatId)')
    expect(runtime).toContain('if (!aborted || finalText.trim().length > 0) {')
    expect(runtime).toContain('return { fullText, sessionId, aborted: true }')
  })
})
