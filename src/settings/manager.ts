import { getDatabase } from '../db/index.ts'
import { getEnv } from '../config/index.ts'
import {
  RegistrySourceSettingSchema,
  SettingsSchema,
  type Settings,
  type CustomModel,
} from './schema.ts'

// Key in kv_state table
const SETTINGS_KEY = 'settings'

/**
 * Read settings from kv_state, returning defaults if missing.
 */
export function getSettings(): Settings {
  const db = getDatabase()
  const row = db.query("SELECT value FROM kv_state WHERE key = ?").get(SETTINGS_KEY) as { value: string } | null
  if (!row) {
    return normalizeSettings(SettingsSchema.parse({}))
  }
  try {
    return normalizeSettings(SettingsSchema.parse(JSON.parse(row.value)))
  } catch {
    return normalizeSettings(SettingsSchema.parse({}))
  }
}

/**
 * Partially update settings with deep merge, then write back as a whole.
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const db = getDatabase()
  const current = getSettings()
  const hasDefaultRegistrySource = Object.prototype.hasOwnProperty.call(partial, 'defaultRegistrySource')

  // Deep merge
  const merged: Settings = {
    activeModel: partial.activeModel ?? current.activeModel,
    customModels: partial.customModels ?? current.customModels,
    defaultRegistrySource: hasDefaultRegistrySource ? partial.defaultRegistrySource : current.defaultRegistrySource,
    registrySources: {
      clawhub: {
        ...current.registrySources.clawhub,
        ...partial.registrySources?.clawhub,
      },
      tencent: {
        ...current.registrySources.tencent,
        ...partial.registrySources?.tencent,
      },
    },
  }

  // Validate and write
  const validated = normalizeSettings(SettingsSchema.parse(merged))
  db.run(
    "INSERT OR REPLACE INTO kv_state (key, value) VALUES (?, ?)",
    [SETTINGS_KEY, JSON.stringify(validated)]
  )
  return validated
}

export function isRegistrySourceSetting(value: unknown): value is Settings['defaultRegistrySource'] {
  return RegistrySourceSettingSchema.safeParse(value).success
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
        modelId: env.AGENT_MODEL,
        provider: 'builtin',
      }
    }
    // Built-in model params not injected at compile time, fall back to .env config
    if (env.ANTHROPIC_API_KEY) {
      return {
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL || '',
        modelId: env.AGENT_MODEL,
        provider: 'builtin',
      }
    }
    // No config available at all, return null (agent features unavailable)
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

function normalizeSettings(settings: Settings): Settings {
  return {
    ...settings,
    customModels: settings.customModels.map(normalizeCustomModel),
  }
}

function normalizeCustomModel(model: CustomModel): CustomModel {
  const inferredProvider = inferCustomModelProvider(model)
  if (inferredProvider === model.provider) {
    return model
  }

  return {
    ...model,
    provider: inferredProvider,
  }
}

function inferCustomModelProvider(model: CustomModel): CustomModel['provider'] {
  const modelId = model.modelId.trim()
  const lowerModelId = modelId.toLowerCase()
  const lowerBaseUrl = model.baseUrl.trim().toLowerCase()

  if (lowerModelId.startsWith('minimax-cn/')) return 'minimax-cn'
  if (lowerModelId.startsWith('minimax/') || lowerModelId.startsWith('minimax-')) return 'minimax'
  if (modelId.startsWith('MiniMax-')) return 'minimax'

  if (model.provider === 'anthropic' || model.provider === 'custom') {
    if (lowerBaseUrl.includes('minimax')) {
      return lowerBaseUrl.includes('/cn') ? 'minimax-cn' : 'minimax'
    }
  }

  return model.provider
}

/**
 * Return the built-in model's modelId for frontend display
 */
export function getBuiltinModelId(): string | null {
  const env = getEnv()
  if (env.YOUCLAW_BUILTIN_API_URL && env.YOUCLAW_BUILTIN_AUTH_TOKEN) {
    return env.AGENT_MODEL
  }
  if (env.ANTHROPIC_API_KEY) {
    return env.AGENT_MODEL
  }
  return null
}
