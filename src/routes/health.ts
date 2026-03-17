import { Hono } from 'hono'
import { which, resetShellEnvCache } from '../utils/shell-env.ts'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// GET /api/git-check — check if git is available in PATH
health.get('/git-check', (c) => {
  // Reset cache so newly installed git is detected
  resetShellEnvCache()
  const gitPath = which('git')
  return c.json({
    available: gitPath !== null,
    path: gitPath,
  })
})

export { health }
