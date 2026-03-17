import { Hono } from 'hono'
import { existsSync } from 'node:fs'
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
 * On Windows, directly probe well-known Git install paths for git.exe.
 * This works even when Git is not yet in the process PATH (e.g. freshly installed).
 */
function findWindowsGit(): string | null {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env['LOCALAPPDATA'] || ''
  const userProfile = process.env['USERPROFILE'] || ''

  const candidates = [
    resolve(programFiles, 'Git', 'cmd', 'git.exe'),
    resolve(programFiles, 'Git', 'bin', 'git.exe'),
    resolve(programFilesX86, 'Git', 'cmd', 'git.exe'),
    resolve(programFilesX86, 'Git', 'bin', 'git.exe'),
    ...(localAppData ? [resolve(localAppData, 'Programs', 'Git', 'cmd', 'git.exe')] : []),
    ...(userProfile ? [resolve(userProfile, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe')] : []),
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

// GET /api/git-check — check if git is available
health.get('/git-check', (c) => {
  // On Windows: probe filesystem directly (no subprocess, no black window flash)
  if (process.platform === 'win32') {
    const gitPath = findWindowsGit()
    return c.json({ available: gitPath !== null, path: gitPath })
  }

  // Non-Windows: use which (reliable on macOS/Linux)
  resetShellEnvCache()
  const gitPath = which('git')
  return c.json({
    available: gitPath !== null,
    path: gitPath,
  })
})

export { health }
