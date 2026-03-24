import { beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import './setup.ts'
import { BrowserManager } from '../src/browser/index.ts'
import { createBrowserProfilesRoutes } from '../src/routes/browser-profiles.ts'
import { getPaths } from '../src/config/index.ts'
import { cleanAllTables } from './setup.ts'

describe('browser manager', () => {
  beforeEach(() => {
    cleanAllTables()
    rmSync(resolve(getPaths().browserProfiles), { recursive: true, force: true })
  })

  test('ensureDefaultProfile creates the default managed profile', () => {
    const manager = new BrowserManager()
    const profile = manager.ensureDefaultProfile()

    expect(profile.id).toBe('openclaw')
    expect(profile.driver).toBe('managed')
    expect(profile.isDefault).toBe(true)
    expect(profile.userDataDir?.endsWith('/browser-profiles/openclaw')).toBe(true)
  })

  test('browser routes expose the new profile endpoints', async () => {
    const manager = new BrowserManager()
    manager.ensureDefaultProfile()
    const app = createBrowserProfilesRoutes(undefined, manager)

    const listRes = await app.request('/browser/profiles')
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json() as Array<{ id: string }>
    expect(listBody.some((profile) => profile.id === 'openclaw')).toBe(true)

    const createRes = await app.request('/browser/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Manual Login' }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { id: string; driver: string }
    expect(created.driver).toBe('managed')

    const statusRes = await app.request(`/browser/profiles/${created.id}/status`)
    expect(statusRes.status).toBe(200)
    const status = await statusRes.json() as { status: string }
    expect(status.status).toBe('stopped')
  })

  test('shutdown is safe when no managed browser is running', async () => {
    const manager = new BrowserManager()
    manager.ensureDefaultProfile()

    await expect(manager.shutdown()).resolves.toBeUndefined()
  })
})
