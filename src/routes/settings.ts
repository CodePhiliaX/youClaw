import { Hono } from 'hono'
import { getSettings, updateSettings, getActiveModelConfig } from '../settings/manager.ts'
import { getDatabase } from '../db/index.ts'

const app = new Hono()

// GET /settings — return full settings (apiKey masked)
app.get('/settings', (c) => {
  const settings = getSettings()

  // Mask apiKey: keep only last 4 characters
  const masked = {
    ...settings,
    customModels: settings.customModels.map((m) => ({
      ...m,
      apiKey: m.apiKey ? `****${m.apiKey.slice(-4)}` : '',
    })),
  }

  return c.json(masked)
})

// PATCH /settings — partial update
app.patch('/settings', async (c) => {
  const body = await c.req.json() as Record<string, unknown>

  // Only pick fields actually present in body to avoid Zod defaults overwriting existing data
  const current = getSettings()
  const partial: Record<string, unknown> = {}

  if ('activeModel' in body) {
    partial.activeModel = body.activeModel
  }

  if ('customModels' in body && Array.isArray(body.customModels)) {
    // Preserve original apiKey for masked values
    const existingMap = new Map(current.customModels.map((m) => [m.id, m.apiKey]))
    partial.customModels = (body.customModels as Array<Record<string, unknown>>).map((m) => {
      const apiKey = String(m.apiKey ?? '')
      if (apiKey.startsWith('****') && existingMap.has(String(m.id))) {
        return { ...m, apiKey: existingMap.get(String(m.id))! }
      }
      return m
    })
  }

  const updated = updateSettings(partial)

  // Return masked result
  const masked = {
    ...updated,
    customModels: updated.customModels.map((m) => ({
      ...m,
      apiKey: m.apiKey ? `****${m.apiKey.slice(-4)}` : '',
    })),
  }

  return c.json(masked)
})

// GET /settings/active-model — return full config of active model (internal use, unmasked)
app.get('/settings/active-model', (c) => {
  const config = getActiveModelConfig()
  if (!config) {
    return c.json({ source: 'env' })
  }
  return c.json({ source: 'settings', ...config })
})

// GET /settings/port — 获取配置的端口（Web 模式）
app.get('/settings/port', (c) => {
  const db = getDatabase()
  const row = db.query("SELECT value FROM kv_state WHERE key = 'preferred_port'").get() as { value: string } | null
  return c.json({ port: row?.value || null })
})

// PUT /settings/port — 设置端口（Web 模式）
app.put('/settings/port', async (c) => {
  const { port } = await c.req.json() as { port?: string | null }
  const db = getDatabase()
  if (port) {
    const num = parseInt(port)
    if (isNaN(num) || num < 1024 || num > 65535) {
      return c.json({ error: 'Port must be between 1024 and 65535' }, 400)
    }
    db.run("INSERT OR REPLACE INTO kv_state (key, value) VALUES ('preferred_port', ?)", [String(num)])
  } else {
    db.run("DELETE FROM kv_state WHERE key = 'preferred_port'")
  }
  return c.json({ ok: true })
})

export function createSettingsRoutes() {
  return app
}
