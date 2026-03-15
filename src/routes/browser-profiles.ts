import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import {
  createBrowserProfile,
  getBrowserProfiles,
  getBrowserProfile,
  deleteBrowserProfile,
} from '../db/index.ts'
import { getLogger } from '../logger/index.ts'

export function createBrowserProfilesRoutes() {
  const app = new Hono()

  // List all profiles
  app.get('/browser-profiles', (c) => {
    const profiles = getBrowserProfiles()
    return c.json(profiles)
  })

  // Create a profile
  app.post('/browser-profiles', async (c) => {
    const body = await c.req.json<{ name: string }>()
    if (!body.name) {
      return c.json({ error: 'name is required' }, 400)
    }
    const id = crypto.randomUUID().slice(0, 8)
    createBrowserProfile({ id, name: body.name })
    // Create userDataDir
    const profileDir = resolve(getPaths().browserProfiles, id)
    mkdirSync(profileDir, { recursive: true })
    return c.json(getBrowserProfile(id), 201)
  })

  // Delete a profile
  app.delete('/browser-profiles/:id', (c) => {
    const id = c.req.param('id')
    const profile = getBrowserProfile(id)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    deleteBrowserProfile(id)
    // Delete userDataDir
    const profileDir = resolve(getPaths().browserProfiles, id)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {}
    return c.json({ ok: true })
  })

  // Launch headed browser
  app.post('/browser-profiles/:id/launch', async (c) => {
    const log = getLogger()
    const id = c.req.param('id')
    const profile = getBrowserProfile(id)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    const profileDir = resolve(getPaths().browserProfiles, id)
    mkdirSync(profileDir, { recursive: true })

    // Close existing session for this profile (idempotent) to ensure new params take effect
    log.info({ profileId: id }, 'closing existing session before launch')
    await launchAndVerify(['--session', id, 'close'], 10_000).catch(() => {})

    // Launch headed browser with isolated session to avoid daemon params being ignored
    log.info({ profileId: id, profileDir }, 'launching headed browser')
    const result = await launchAndVerify(
      ['--session', id, '--profile', profileDir, '--headed', 'open', 'about:blank'],
      15_000,
    )

    if (result.ok) {
      log.info({ profileId: id }, 'browser launched successfully')
      return c.json({ ok: true, profileDir })
    } else {
      log.error({ profileId: id, error: result.error }, 'browser launch failed')
      return c.json({ error: result.error }, 500)
    }
  })

  return app
}

/** Spawn agent-browser and wait for exit */
function launchAndVerify(
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('agent-browser', args, { stdio: 'pipe' })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        resolve({ ok: false, error: `launch timeout after ${timeoutMs}ms` })
      }
    }, timeoutMs)

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      }
    })

    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          resolve({ ok: true })
        } else {
          const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
          resolve({ ok: false, error: detail })
        }
      }
    })
  })
}
