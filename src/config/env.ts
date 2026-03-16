import { z } from 'zod/v4'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_CONSTANTS } from './build-constants.ts'

// Model-related keys: always read from .env file, ignoring user's system env vars
const DOTENV_OVERRIDE_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN', // Anthropic SDK compatible field, equivalent to ANTHROPIC_API_KEY
  'ANTHROPIC_BASE_URL',
  'AGENT_MODEL',
])

/**
 * Manually load .env file into process.env.
 * Model-related keys (ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, AGENT_MODEL)
 * always override system env vars to avoid picking up user shell config.
 * Other keys do not override existing env vars.
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

  // Clear model-related system env vars first to prevent inheriting from user shell
  for (const key of DOTENV_OVERRIDE_KEYS) {
    delete process.env[key]
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

    // Model-related keys always read from .env; other keys do not override existing env vars
    // Empty values are not written to avoid overriding Zod optional defaults
    if (value && (!(key in process.env) || DOTENV_OVERRIDE_KEYS.has(key))) {
      process.env[key] = value
    }
  }
}

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().optional(),
  PORT: z.coerce.number().default(62601),
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

  // Read preferred_port from Tauri Store (desktop mode)
  // Store preferred_port takes priority over .env PORT
  try {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const platform = process.platform
    let storeDir: string
    if (platform === 'darwin') {
      storeDir = resolve(home, 'Library/Application Support/com.youclaw.app')
    } else if (platform === 'win32') {
      storeDir = resolve(process.env.APPDATA || resolve(home, 'AppData/Roaming'), 'com.youclaw.app')
    } else {
      storeDir = resolve(process.env.XDG_CONFIG_HOME || resolve(home, '.config'), 'com.youclaw.app')
    }
    const storeFile = resolve(storeDir, 'settings.json')
    const storeContent = JSON.parse(readFileSync(storeFile, 'utf-8'))
    if (storeContent.preferred_port) {
      process.env.PORT = storeContent.preferred_port
    }
  } catch {
    // Store not found (web mode or first launch), fall back to .env PORT
  }

  // ANTHROPIC_AUTH_TOKEN is equivalent to ANTHROPIC_API_KEY, unify to ANTHROPIC_API_KEY
  if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN
  }

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
