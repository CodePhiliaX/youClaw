import { beforeEach, describe, expect, test } from 'bun:test'
import './setup.ts'
import { cleanTables, getDatabase } from './setup.ts'
import { createSettingsRoutes } from '../src/routes/settings.ts'

beforeEach(() => {
  cleanTables('kv_state')
})

describe('settings routes', () => {
  test('GET /settings masks the clawhub token and preserves registry source config', async () => {
    const db = getDatabase()
    db.run(
      'INSERT INTO kv_state (key, value) VALUES (?, ?)',
      ['settings', JSON.stringify({
        defaultRegistrySource: 'tencent',
        registrySources: {
          clawhub: {
            enabled: true,
            apiBaseUrl: 'https://registry.example/api',
            downloadUrl: 'https://registry.example/download',
            token: 'secret-token',
          },
          tencent: {
            enabled: false,
            indexUrl: 'https://tencent.example/index.json',
            searchUrl: 'https://tencent.example/search',
            downloadUrl: 'https://tencent.example/download',
          },
        },
      })],
    )

    const app = createSettingsRoutes()
    const res = await app.request('/settings')
    const body = await res.json() as {
      defaultRegistrySource?: string
      registrySources: {
        clawhub: { token: string; apiBaseUrl: string }
        tencent: { enabled: boolean; indexUrl: string }
      }
    }

    expect(res.status).toBe(200)
    expect(body.defaultRegistrySource).toBe('tencent')
    expect(body.registrySources.clawhub.token).toBe('****oken')
    expect(body.registrySources.clawhub.apiBaseUrl).toBe('https://registry.example/api')
    expect(body.registrySources.tencent.enabled).toBe(false)
    expect(body.registrySources.tencent.indexUrl).toBe('https://tencent.example/index.json')
  })

  test('PATCH /settings rejects unsupported defaultRegistrySource values', async () => {
    const app = createSettingsRoutes()
    const res = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultRegistrySource: 'unknown' }),
    })
    const body = await res.json() as { error: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid defaultRegistrySource')
  })

  test('PATCH /settings preserves masked clawhub token and can clear default source', async () => {
    const db = getDatabase()
    db.run(
      'INSERT INTO kv_state (key, value) VALUES (?, ?)',
      ['settings', JSON.stringify({
        defaultRegistrySource: 'tencent',
        registrySources: {
          clawhub: {
            enabled: true,
            apiBaseUrl: 'https://clawhub.ai/api/v1',
            downloadUrl: 'https://clawhub.ai/api/v1/download',
            token: 'persist-me',
          },
          tencent: {
            enabled: true,
            indexUrl: 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills.json',
            searchUrl: 'https://lightmake.site/api/v1/search',
            downloadUrl: 'https://lightmake.site/api/v1/download',
          },
        },
      })],
    )

    const app = createSettingsRoutes()
    const res = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultRegistrySource: null,
        registrySources: {
          clawhub: {
            token: '****t-me',
          },
          tencent: {
            enabled: false,
          },
        },
      }),
    })
    const body = await res.json() as {
      defaultRegistrySource?: string
      registrySources: {
        clawhub: { token: string }
        tencent: { enabled: boolean }
      }
    }

    expect(res.status).toBe(200)
    expect(body.defaultRegistrySource).toBeUndefined()
    expect(body.registrySources.clawhub.token).toBe('****t-me')
    expect(body.registrySources.tencent.enabled).toBe(false)

    const stored = getDatabase()
      .query('SELECT value FROM kv_state WHERE key = ?')
      .get('settings') as { value: string }
    const parsed = JSON.parse(stored.value) as {
      defaultRegistrySource?: string
      registrySources: { clawhub: { token: string }; tencent: { enabled: boolean } }
    }
    expect(parsed.defaultRegistrySource).toBeUndefined()
    expect(parsed.registrySources.clawhub.token).toBe('persist-me')
    expect(parsed.registrySources.tencent.enabled).toBe(false)
  })

  test('GET /settings normalizes MiniMax custom models away from anthropic provider', async () => {
    const db = getDatabase()
    db.run(
      'INSERT INTO kv_state (key, value) VALUES (?, ?)',
      ['settings', JSON.stringify({
        activeModel: { provider: 'custom', id: 'm1' },
        customModels: [{
          id: 'm1',
          name: 'MiniMax',
          provider: 'anthropic',
          apiKey: 'secret-key',
          baseUrl: 'https://proxy.example.com',
          modelId: 'MiniMax-M2.5-highspeed',
        }],
      })],
    )

    const app = createSettingsRoutes()
    const res = await app.request('/settings')
    const body = await res.json() as {
      customModels: Array<{ provider: string; apiKey: string; modelId: string }>
    }

    expect(res.status).toBe(200)
    expect(body.customModels[0]?.provider).toBe('minimax')
    expect(body.customModels[0]?.apiKey).toBe('****-key')
  })

  test('GET /settings/active-model normalizes MiniMax custom provider for runtime', async () => {
    const db = getDatabase()
    db.run(
      'INSERT INTO kv_state (key, value) VALUES (?, ?)',
      ['settings', JSON.stringify({
        activeModel: { provider: 'custom', id: 'm1' },
        customModels: [{
          id: 'm1',
          name: 'MiniMax',
          provider: 'anthropic',
          apiKey: 'secret-key',
          baseUrl: 'https://proxy.example.com',
          modelId: 'MiniMax-M2.5-highspeed',
        }],
      })],
    )

    const app = createSettingsRoutes()
    const res = await app.request('/settings/active-model')
    const body = await res.json() as { provider: string; modelId: string; baseUrl: string }

    expect(res.status).toBe(200)
    expect(body.provider).toBe('minimax')
    expect(body.modelId).toBe('MiniMax-M2.5-highspeed')
    expect(body.baseUrl).toBe('https://proxy.example.com')
  })
})
