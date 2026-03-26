import { beforeEach, describe, expect, test } from 'bun:test'
import './setup.ts'
import { BrowserManager, type BrowserProfile } from '../src/browser/index.ts'
import { createBrowserProfilesRoutes } from '../src/routes/browser-profiles.ts'
import { cleanTables } from './setup.ts'

class FakeRelayBrowserManager extends BrowserManager {
  protected override async probeProfileMetadata(_profile: BrowserProfile): Promise<{ webSocketDebuggerUrl: string | null; browser: string | null }> {
    return {
      browser: 'Chrome/123.0.0.0',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/fake-session',
    }
  }

  protected override async requestTabs(_profile: BrowserProfile): Promise<Array<{ id: string; title?: string; url?: string; type?: string }>> {
    return [
      { id: 'tab-1', title: 'Attached Tab', url: 'https://example.com', type: 'page' },
    ]
  }
}

describe('browser extension relay', () => {
  beforeEach(() => {
    cleanTables('browser_profile_runtime', 'chat_browser_state', 'browser_profiles', 'kv_state')
  })

  test('connectRelay attaches a loopback CDP endpoint and exposes running runtime state', async () => {
    const manager = new FakeRelayBrowserManager()
    const profile = manager.createProfile({
      name: 'Existing Browser',
      driver: 'extension-relay',
    })

    const relay = manager.getRelayState(profile.id)

    const result = await manager.connectRelay(profile.id, relay.token, 'http://127.0.0.1:9222')
    expect(result.relay.connected).toBe(true)
    expect(result.relay.cdpUrl).toBe('http://127.0.0.1:9222/')
    expect(result.runtime.status).toBe('running')
    expect(result.runtime.wsEndpoint).toBe('ws://127.0.0.1:9222/devtools/browser/fake-session')

    const tabs = await manager.listTabs(profile.id)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.title).toBe('Attached Tab')
  })

  test('relay connect route rejects non-loopback CDP endpoints', async () => {
    const manager = new FakeRelayBrowserManager()
    const profile = manager.createProfile({
      name: 'Secure Relay',
      driver: 'extension-relay',
    })
    const app = createBrowserProfilesRoutes(undefined, manager)

    const relayRes = await app.request(`/browser/profiles/${profile.id}/relay`)
    expect(relayRes.status).toBe(200)
    const relay = await relayRes.json() as { token: string }

    const connectRes = await app.request(`/browser/profiles/${profile.id}/relay/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: relay.token,
        cdpUrl: 'http://example.com:9222',
      }),
    })

    expect(connectRes.status).toBe(400)
    const body = await connectRes.json() as { error: string }
    expect(body.error).toContain('loopback')
  })

  test('rotating the relay token invalidates the previous token and clears runtime state', async () => {
    const manager = new FakeRelayBrowserManager()
    const profile = manager.createProfile({
      name: 'Rotating Relay',
      driver: 'extension-relay',
    })

    const initialRelay = manager.getRelayState(profile.id)
    await manager.connectRelay(profile.id, initialRelay.token, 'http://127.0.0.1:9222')

    const rotated = await manager.rotateRelayToken(profile.id)
    expect(rotated.relay.connected).toBe(false)
    expect(rotated.runtime.status).toBe('stopped')
    expect(rotated.relay.token).not.toBe(initialRelay.token)

    await expect(manager.connectRelay(profile.id, initialRelay.token, 'http://127.0.0.1:9222')).rejects.toThrow('Invalid relay token')
  })
})
