import { z } from 'zod/v4'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_CONSTANTS } from './build-constants.ts'

/**
 * Manually load .env file into process.env (does not override existing values).
 * Replaces Bun's automatic .env loading for Node.js/tsx runtime compatibility.
 */
function loadDotEnv(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(__dirname, '../../.env')

  let content: string
  try {
    content = readFileSync(envPath, 'utf-8')
  } catch {
    return // .env not found, skip
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    // Do not override existing env vars (system/CLI settings take priority)
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  PORT: z.coerce.number().default(23107),
  DATA_DIR: z.string().default('./data'),
  AGENT_MODEL: z.string().default('minimax/MiniMax-M2.5-highspeed'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  FEISHU_APP_ID: z.string().optional(),
  FEISHU_APP_SECRET: z.string().optional(),
  QQ_BOT_APP_ID: z.string().optional(),
  QQ_BOT_SECRET: z.string().optional(),
  WECOM_CORP_ID: z.string().optional(),
  WECOM_CORP_SECRET: z.string().optional(),
  WECOM_AGENT_ID: z.string().optional(),
  WECOM_TOKEN: z.string().optional(),
  WECOM_ENCODING_AES_KEY: z.string().optional(),
  DINGTALK_CLIENT_ID: z.string().optional(),
  DINGTALK_SECRET: z.string().optional(),
  // Cloud service URLs (offline mode if not configured)
  YOUCLAW_WEBSITE_URL: z.string().optional(),
  YOUCLAW_API_URL: z.string().optional(),
  // Built-in model config (injected at build time)
  YOUCLAW_BUILTIN_API_URL: z.string().optional(),
  YOUCLAW_BUILTIN_AUTH_TOKEN: z.string().optional(),
})

export type EnvConfig = z.infer<typeof envSchema>

let _config: EnvConfig | null = null

export function loadEnv(): EnvConfig {
  if (_config) return _config

  // Node.js/tsx does not auto-load .env; load manually
  loadDotEnv()

  // Build-time constant injection: build-sidecar.mjs generates build-constants.ts
  // with compile-time env vars as a plain JS object, merged into process.env here
  for (const [key, val] of Object.entries(BUILD_CONSTANTS)) {
    if (val && !process.env[key]) {
      process.env[key] = val
    }
  }

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Environment variable validation failed:')
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }

  _config = result.data

  if (!_config.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set. Agent features will be unavailable. Please configure the API Key in settings.')
  }

  return _config
}

export function getEnv(): EnvConfig {
  if (!_config) throw new Error('Environment not initialized. Call loadEnv() first.')
  return _config
}
