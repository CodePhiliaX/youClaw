import { beforeEach, describe, expect, mock, test } from 'bun:test'
import './setup.ts'
import { getEnv } from '../src/config/index.ts'
import { createAuthRoutes, getAuthToken } from '../src/routes/auth.ts'
import { cleanTables, getDatabase } from './setup.ts'

describe('auth routes', () => {
  beforeEach(() => {
    cleanTables('kv_state')
  })

  test('POST /auth/logout clears local token without remote request', async () => {
    const db = getDatabase()
    db.run("INSERT INTO kv_state (key, value) VALUES (?, ?)", ['auth_token', 'token-for-test'])
    expect(getAuthToken()).toBe('token-for-test')

    const env = getEnv()
    const originalApiUrl = env.YOUCLAW_API_URL
    env.YOUCLAW_API_URL = 'https://api.example.com'

    const originalFetch = globalThis.fetch
    const fetchMock = mock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const app = createAuthRoutes()
      const res = await app.request('/auth/logout', { method: 'POST' })
      const body = await res.json() as { ok: boolean }

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(getAuthToken()).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
      env.YOUCLAW_API_URL = originalApiUrl
    }
  })
})
