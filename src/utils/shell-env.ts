import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { getBunRuntimeDir } from '../agent/runtime.ts'

const isWindows = process.platform === 'win32'
const SEP = isWindows ? ';' : ':'

let cachedEnv: NodeJS.ProcessEnv | null = null

/**
 * Return common Git install directories on Windows.
 * Newly installed Git won't be in process.env.PATH, so we probe well-known locations.
 */
function getWindowsGitPaths(): string[] {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env['LOCALAPPDATA'] || ''
  const userProfile = process.env['USERPROFILE'] || ''

  return [
    resolve(programFiles, 'Git', 'cmd'),
    resolve(programFiles, 'Git', 'bin'),
    resolve(programFilesX86, 'Git', 'cmd'),
    resolve(programFilesX86, 'Git', 'bin'),
    ...(localAppData ? [resolve(localAppData, 'Programs', 'Git', 'cmd')] : []),
    ...(userProfile ? [resolve(userProfile, 'scoop', 'apps', 'git', 'current', 'cmd')] : []),
  ]
}

/**
 * Return a copy of process.env with common tool directories appended to PATH.
 * Result is cached until resetShellEnvCache() is called.
 */
export function getShellEnv(): NodeJS.ProcessEnv {
  if (cachedEnv) return cachedEnv

  const env = { ...process.env }
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (!home) {
    cachedEnv = env
    return env
  }

  const candidates = isWindows
    ? [
        resolve(home, '.bun/bin'),
        resolve(home, '.cargo/bin'),
        resolve(home, 'scoop/shims'),
        ...getWindowsGitPaths(),
      ]
    : [
        resolve(home, '.bun/bin'),
        resolve(home, '.cargo/bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
      ]

  // Append embedded Bun runtime dir as fallback (after standard dirs)
  const bunRuntimeDir = getBunRuntimeDir()
  if (bunRuntimeDir) candidates.push(bunRuntimeDir)

  const extras = candidates.filter((p) => existsSync(p))
  if (extras.length > 0) {
    env.PATH = [env.PATH, ...extras].filter(Boolean).join(SEP)
  }

  cachedEnv = env
  return env
}

/**
 * Cross-platform executable lookup using the enhanced PATH.
 * Returns the resolved path or null if not found.
 */
export function which(cmd: string): string | null {
  try {
    const bin = isWindows ? 'where' : 'which'
    return execSync(`${bin} ${cmd}`, {
      encoding: 'utf-8',
      env: getShellEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim().split('\n')[0] || null
  } catch {
    return null
  }
}

/** Clear the cached env so subsequent calls to getShellEnv() rebuild it. */
export function resetShellEnvCache(): void {
  cachedEnv = null
}
