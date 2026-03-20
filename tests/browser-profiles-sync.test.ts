import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

function read(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('browser profile sync wiring', () => {
  test('chat context exposes shared browser profile refresh', () => {
    const chatCtx = read('web/src/hooks/chatCtx.ts')
    const provider = read('web/src/hooks/useChatContext.tsx')

    expect(chatCtx).toContain('refreshBrowserProfiles: () => void')
    expect(provider).toContain('const refreshBrowserProfiles = useCallback(() => {')
    expect(provider).toContain('refreshBrowserProfiles,')
  })

  test('browser settings page reuses shared browser profile state', () => {
    const browserProfilesPage = read('web/src/pages/BrowserProfiles.tsx')

    expect(browserProfilesPage).toContain('useChatContext()')
    expect(browserProfilesPage).toContain('browserProfiles: profiles')
    expect(browserProfilesPage).not.toContain('getBrowserProfiles')
    expect(browserProfilesPage).toContain('if (selectedProfileId === id) setSelectedProfileId(null)')
  })

  test('agents page also reuses shared browser profile state', () => {
    const agentsPage = read('web/src/pages/Agents.tsx')

    expect(agentsPage).toContain('browserProfiles,')
    expect(agentsPage).toContain('refreshBrowserProfiles,')
    expect(agentsPage).toContain('refreshBrowserProfiles()')
    expect(agentsPage).not.toContain('getBrowserProfiles')
  })
})
