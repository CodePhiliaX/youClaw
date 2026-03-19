import { resolve, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { getEnv } from './env.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// After bun build --compile, __dirname is under a virtual FS
// macOS/Linux: /$bunfs/root/  Windows: B:\~BUN\root
const isBunCompiled = __dirname.includes('/$bunfs/') || __dirname.includes('~BUN')

// Dev mode: project root directory
export const ROOT_DIR = isBunCompiled
  ? process.cwd()
  : resolve(__dirname, '../..')

let _resolvedDataDir: string | null = null

function getBundledDefaultDataDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) return resolve(tmpdir(), 'youclaw-data')

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || resolve(home, 'AppData', 'Roaming')
    return resolve(appData, 'com.youclaw.app')
  }

  if (process.platform === 'darwin') {
    return resolve(home, 'Library', 'Application Support', 'com.youclaw.app')
  }

  const xdgDataHome = process.env.XDG_DATA_HOME || resolve(home, '.local', 'share')
  return resolve(xdgDataHome, 'com.youclaw.app')
}

function isWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = resolve(dir, `.youclaw-write-test-${process.pid}-${Date.now()}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function resolveDataDir(envDataDir: string): string {
  if (_resolvedDataDir) return _resolvedDataDir

  const candidates: string[] = []
  if (process.env.DATA_DIR?.trim()) {
    candidates.push(resolve(process.env.DATA_DIR))
  }
  if (isBunCompiled) {
    candidates.push(getBundledDefaultDataDir())
  }
  candidates.push(resolve(ROOT_DIR, envDataDir))
  candidates.push(resolve(tmpdir(), 'youclaw-data'))

  const visited = new Set<string>()
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue
    visited.add(candidate)
    if (isWritableDir(candidate)) {
      _resolvedDataDir = candidate
      return candidate
    }
  }

  const fallback = resolve(tmpdir(), 'youclaw-data')
  _resolvedDataDir = fallback
  return fallback
}

export function getPaths() {
  const env = getEnv()

  // DATA_DIR: writable data directory (database, logs, browser profiles, etc.)
  const dataDir = resolveDataDir(env.DATA_DIR)

  // RESOURCES_DIR: read-only resource directory from Tauri bundle (agents/skills/prompts templates)
  // In dev mode, falls back to project root
  const resourcesDir = process.env.RESOURCES_DIR
    ? resolve(process.env.RESOURCES_DIR)
    : ROOT_DIR

  // agents directory must be writable (creating agents, writing memory, etc.), stored under DATA_DIR
  // On first launch, AgentManager copies default templates from resourcesDir
  const agentsDir = isBunCompiled
    ? resolve(dataDir, 'agents')
    : resolve(ROOT_DIR, 'agents')

  return {
    root: ROOT_DIR,
    data: dataDir,
    db: resolve(dataDir, 'youclaw.db'),
    agents: agentsDir,
    skills: resolveResourceSubdir(resourcesDir, isBunCompiled, 'skills'),
    prompts: resolveResourceSubdir(resourcesDir, isBunCompiled, 'prompts'),
    browserProfiles: resolve(dataDir, 'browser-profiles'),
    logs: resolve(dataDir, 'logs'),
  }
}

/**
 * Resolve a resource subdirectory with fallback for Tauri bundled paths.
 * Tauri 2 converts ../ to _up_/ when bundling resources.
 */
function resolveResourceSubdir(resourcesDir: string, isBunCompiled: boolean, name: string): string {
  if (!isBunCompiled) return resolve(resourcesDir, name)

  // Tauri 2 converts ../ to _up_/ when bundling
  const primary = resolve(resourcesDir, '_up_', name)
  if (existsSync(primary)) return primary

  // Fallback: direct path (in case Tauri strips the ../ prefix)
  const fallback = resolve(resourcesDir, name)
  if (existsSync(fallback)) return fallback

  // Return primary path as default
  return primary
}
