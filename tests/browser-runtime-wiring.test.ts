import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('browser runtime wiring', () => {
  test('prompt builder instructs the agent to use browser MCP tools instead of agent-browser CLI', () => {
    const promptBuilder = read('src/agent/prompt-builder.ts')

    expect(promptBuilder).toContain('mcp__browser__*')
    expect(promptBuilder).toContain('Prefer the built-in \\`mcp__browser__*\\` tools')
    expect(promptBuilder).toContain('Use the legacy \\`agent-browser\\` skill only when you need capabilities not yet covered')
    expect(promptBuilder).toContain('agent-browser --session ${context.browserProfile.id} --profile ${context.browserProfile.userDataDir} <command>')
    expect(promptBuilder).toContain('Manual login is the default and recommended flow')
    expect(promptBuilder).toContain('Do NOT ask the user for credentials')
    expect(promptBuilder).toContain('If the site shows CAPTCHA, 2FA, device verification')
    expect(promptBuilder).toContain('For sensitive or high-impact actions, prepare the page and then ask the user to review, confirm, or complete the final step manually')
  })

  test('prompt builder can explicitly disable all browser usage for a chat', () => {
    const promptBuilder = read('src/agent/prompt-builder.ts')

    expect(promptBuilder).toContain('Browser use is explicitly disabled for this chat.')
    expect(promptBuilder).toContain('Do NOT use the built-in \\`mcp__browser__*\\` tools.')
    expect(promptBuilder).toContain('Do NOT invoke the legacy \\`agent-browser\\` skill')
    expect(promptBuilder).toContain('can be enabled by switching this chat from "None" to a browser profile')
    expect(promptBuilder).toContain('reply with a short, user-facing explanation')
  })

  test('agent runtime injects the built-in browser MCP server', () => {
    const runtime = read('src/agent/runtime.ts')

    expect(runtime).toContain("mcpServers['browser'] = createBrowserMcpServer({")
    expect(runtime).toContain('resolveProfileSelection(browserProfileId, this.config.browser?.defaultProfile ?? this.config.browserProfile)')
    expect(runtime).toContain('browserProfile: resolvedBrowserProfile')
    expect(runtime).toContain('const browserDisabled = browserProfileId === null')
    expect(runtime).toContain('getDisabledBrowserToolBlockReason')
    expect(runtime).toContain('const browserDisabledNotice = { sent: false }')
    expect(runtime).toContain('buildDisabledBrowserUserMessage')
    expect(runtime).toContain('This chat is currently set to "No browser".')
  })
})
