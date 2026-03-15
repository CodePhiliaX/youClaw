import { getDatabase } from '../db/index.ts'
import { getEnv } from '../config/index.ts'
import { SettingsSchema, type Settings, type CustomModel } from './schema.ts'

// Key in kv_state table
const SETTINGS_KEY = 'settings'

/**
 * Read settings from kv_state, returning defaults if missing.
 */
export function getSettings(): Settings {
  const db = getDatabase()
  const row = db.query("SELECT value FROM kv_state WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null
  if (!row) {
    return SettingsSchema.parse({})
  }
  try {
    return SettingsSchema.parse(JSON.parse(row.value))
  } catch {
    return SettingsSchema.parse({})
  }
}

/**
 * Partially update settings with deep merge, then write back as a whole.
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const db = getDatabase()
  const current = getSettings()

  // Deep merge
  const merged: Settings = {
    activeModel: partial.activeModel ?? current.activeModel,
    customModels: partial.customModels ?? current.customModels,
  }

  // Validate and write
  const validated = SettingsSchema.parse(merged)
  db.run(
    "INSERT OR REPLACE INTO kv_state (key, value) VALUES (?, ?)",
    [SETTINGS_KEY, JSON.stringify(validated)]
  )
  return validated
}

/**
 * Return the active model config for runtime use
 * Returns null to fall back to env vars
 */
export function getActiveModelConfig(): { apiKey: string; baseUrl: string; modelId: string; provider: string } | null {
  const settings = getSettings()

  if (settings.activeModel.provider === 'builtin' || settings.activeModel.provider === 'cloud') {
    const env = getEnv()
    const builtinUrl = env.YOUCLAW_BUILTIN_API_URL
    const builtinToken = env.YOUCLAW_BUILTIN_AUTH_TOKEN
    if (builtinUrl && builtinToken) {
      return {
        apiKey: builtinToken,
        baseUrl: builtinUrl,
        modelId: 'claude-sonnet-4-6',
        provider: 'builtin',
      }
    }
    // Built-in model params not configured, falling back to env vars
    return null
  }

  if (settings.activeModel.provider === 'custom' && settings.activeModel.id) {
    const model = settings.customModels.find((m: CustomModel) => m.id === settings.activeModel.id)
    if (model) {
      return {
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        modelId: model.modelId,
        provider: model.provider,
      }
    }
  }

  // Custom model not found, returning null to fall back to env vars
  return null
}
