import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { which, resetShellEnvCache } from '../utils/shell-env.ts'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

/**
 * Read live PATH from Windows registry (not inherited process.env).
 * System PATH: HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path
 * User PATH:   HKCU\Environment\Path
 * Combines both, then searches for git.exe in each directory.
 */
function findGitFromRegistry(): string | null {
  const paths: string[] = []

  // Read system PATH from registry
  try {
    const sysOut = execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
      { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const m = sysOut.match(/Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i)
    if (m?.[1]) {
      // Expand %SystemRoot% etc. by resolving env vars
      let expanded = m[1].trim()
      expanded = expanded.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`)
      paths.push(...expanded.split(';').filter(Boolean))
    }
  } catch { /* ignore */ }

  // Read user PATH from registry
  try {
    const userOut = execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const m = userOut.match(/Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i)
    if (m?.[1]) {
      let expanded = m[1].trim()
      expanded = expanded.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`)
      paths.push(...expanded.split(';').filter(Boolean))
    }
  } catch { /* ignore */ }

  // Search for git.exe in each path entry
  for (const dir of paths) {
    const gitExe = resolve(dir, 'git.exe')
    if (existsSync(gitExe)) return gitExe
  }

  return null
}

// GET /api/git-check — check if git is available
health.get('/git-check', (c) => {
  if (process.platform === 'win32') {
    // Read live PATH directly from Windows registry — not the stale process.env.PATH.
    // Git installer updates the registry immediately, so this detects newly installed Git
    // without restarting the app.
    const gitPath = findGitFromRegistry()
    return c.json({ available: gitPath !== null, path: gitPath })
  }

  // Non-Windows: use which (reliable on macOS/Linux)
  resetShellEnvCache()
  const gitPath = which('git')
  return c.json({ available: gitPath !== null, path: gitPath })
})

export { health }
