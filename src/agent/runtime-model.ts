import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getEnv } from '../config/env.ts'
import { getSettings } from '../settings/manager.ts'
import type { CustomModel } from '../settings/schema.ts'

export interface RuntimeModelConfig {
  apiKey: string
  baseUrl: string
  modelId: string
  provider: string
  source: 'builtin' | 'custom'
}

export interface RuntimeModelResolution {
  config: RuntimeModelConfig | null
  error?: string
}

function normalizeAgentModelOverride(modelId?: string | null): string | undefined {
  const trimmed = modelId?.trim()
  if (!trimmed) return undefined

  const normalized = trimmed.toLowerCase()
  if (normalized === 'default' || normalized === 'inherit' || normalized === 'settings') {
    return undefined
  }

  return trimmed
}

function resolveBuiltinRuntimeModel(modelIdOverride?: string): RuntimeModelResolution {
  const env = getEnv()
  const modelId = modelIdOverride?.trim() || env.AGENT_MODEL

  if (env.YOUCLAW_BUILTIN_API_URL && env.YOUCLAW_BUILTIN_AUTH_TOKEN) {
    return {
      config: {
        apiKey: env.YOUCLAW_BUILTIN_AUTH_TOKEN,
        baseUrl: env.YOUCLAW_BUILTIN_API_URL,
        modelId,
        provider: 'builtin',
        source: 'builtin',
      },
    }
  }

  if (env.ANTHROPIC_API_KEY) {
    return {
      config: {
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL || '',
        modelId,
        provider: 'builtin',
        source: 'builtin',
      },
    }
  }

  return {
    config: null,
    error: 'No built-in model config available. Please configure a built-in model in Settings or .env.',
  }
}

function parseQualifiedModelId(modelId: string): { provider?: string; modelId: string } {
  const trimmed = modelId.trim()
  if (!trimmed.includes('/')) {
    return { modelId: trimmed }
  }

  const [providerPart, rawModelId] = trimmed.split('/', 2)
  if (!providerPart || !rawModelId) {
    return { modelId: trimmed }
  }

  return {
    provider: providerPart.trim().toLowerCase(),
    modelId: rawModelId.trim(),
  }
}

function normalizeCandidateKeys(model: CustomModel): string[] {
  const modelId = model.modelId.trim()
  const provider = model.provider.trim().toLowerCase()
  const keys = new Set<string>([
    model.id.trim(),
    modelId,
    `${provider}/${modelId}`,
  ])
  return Array.from(keys).filter(Boolean)
}

function resolveCustomRuntimeModel(explicitModelId?: string): RuntimeModelResolution {
  const settings = getSettings()
  const target = explicitModelId?.trim()
  const models = settings.customModels

  if (!target) {
    if (settings.activeModel.provider === 'custom' && settings.activeModel.id) {
      const active = models.find((model) => model.id === settings.activeModel.id)
      if (active) {
        return {
          config: {
            apiKey: active.apiKey,
            baseUrl: active.baseUrl,
            modelId: active.modelId,
            provider: active.provider,
            source: 'custom',
          },
        }
      }
    }

    return {
      config: null,
      error: 'No active custom model configured. Please select or add one in Settings.',
    }
  }

  const parsed = parseQualifiedModelId(target)
  const exactMatch = models.find((model) => {
    const provider = model.provider.trim().toLowerCase()
    if (parsed.provider) {
      return provider === parsed.provider && model.modelId.trim() === parsed.modelId
    }
    return normalizeCandidateKeys(model).includes(target)
  })

  if (exactMatch) {
    return {
      config: {
        apiKey: exactMatch.apiKey,
        baseUrl: exactMatch.baseUrl,
        modelId: exactMatch.modelId,
        provider: exactMatch.provider,
        source: 'custom',
      },
    }
  }

  if (!parsed.provider) {
    const sameModelId = models.filter((model) => model.modelId.trim() === parsed.modelId)
    if (sameModelId.length === 1) {
      const match = sameModelId[0]!
      return {
        config: {
          apiKey: match.apiKey,
          baseUrl: match.baseUrl,
          modelId: match.modelId,
          provider: match.provider,
          source: 'custom',
        },
      }
    }
  }

  return {
    config: null,
    error: `No configured custom model matches "${target}". Add a matching custom model in Settings → Models.`,
  }
}

export function resolveRuntimeModelConfig(params?: {
  agentModel?: string | null
}): RuntimeModelResolution {
  const settings = getSettings()
  const explicitAgentModel = normalizeAgentModelOverride(params?.agentModel)

  if (explicitAgentModel) {
    const custom = resolveCustomRuntimeModel(explicitAgentModel)
    if (custom.config) {
      return custom
    }

    const builtin = resolveBuiltinRuntimeModel(explicitAgentModel)
    if (builtin.config) {
      return builtin
    }

    return {
      config: null,
      error: custom.error ?? builtin.error ?? 'No model config available. Please configure a model in Settings.',
    }
  }

  if (settings.activeModel.provider === 'builtin' || settings.activeModel.provider === 'cloud') {
    return resolveBuiltinRuntimeModel()
  }

  if (settings.activeModel.provider === 'custom') {
    return resolveCustomRuntimeModel()
  }

  return {
    config: null,
    error: 'No model config available. Please configure a model in Settings.',
  }
}

export function resolveRuntimeModelConfigByAgentId(agentId: string): RuntimeModelResolution {
  const configPath = resolve(getPaths().agents, agentId, 'agent.yaml')
  if (!existsSync(configPath)) {
    return resolveRuntimeModelConfig()
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = parseYaml(raw) as { model?: unknown } | null
    const agentModel = typeof parsed?.model === 'string' ? parsed.model : undefined
    return resolveRuntimeModelConfig({ agentModel })
  } catch {
    return resolveRuntimeModelConfig()
  }
}
