import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { ensureBunRuntime } from '../agent/runtime.ts'
import {
  createBrowserProfile,
  getBrowserProfiles,
  getBrowserProfile,
  deleteBrowserProfile,
} from '../db/index.ts'
import { getLogger } from '../logger/index.ts'
import { which } from '../utils/shell-env.ts'
import { detectChromePath } from '../utils/chrome.ts'
import type { AgentManager } from '../agent/index.ts'

export function createBrowserProfilesRoutes(agentManager?: AgentManager) {
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
  app.delete('/browser-profiles/:id', async (c) => {
    const log = getLogger()
    const id = c.req.param('id')
    const profile = getBrowserProfile(id)
    if (!profile) {
      return c.json({ error: 'not found' }, 404)
    }
    deleteBrowserProfile(id)
    const updatedAgents = clearAgentBrowserProfileBindings(id)
    // Delete userDataDir
    const profileDir = resolve(getPaths().browserProfiles, id)
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {}
    if (updatedAgents.length > 0 && agentManager) {
      try {
        await agentManager.reloadAgents()
      } catch (err) {
        log.error({ err, profileId: id, updatedAgents }, 'failed to reload agents after browser profile deletion')
      }
    }
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
    const chromePath = detectChromePath()
    const launchArgs = ['--session', id, '--profile', profileDir, '--headed']
    if (chromePath) launchArgs.push('--executable-path', chromePath)
    launchArgs.push('open', 'about:blank')
    log.info({ profileId: id, profileDir, chromePath }, 'launching headed browser')
    const result = await launchAndVerify(launchArgs, 15_000)

    if (result.ok) {
      log.info({ profileId: id }, 'browser launched successfully')
      return c.json({ ok: true, profileDir })
    } else {
      log.error({ profileId: id, error: result.error, code: result.code }, 'browser launch failed')
      return c.json({
        error: result.error,
        ...(result.code && { code: result.code }),
        ...(result.installHint && { installHint: result.installHint }),
      }, 500)
    }
  })

  return app
}

function clearAgentBrowserProfileBindings(profileId: string): string[] {
  const agentsDir = getPaths().agents
  if (!existsSync(agentsDir)) return []

  const updatedAgents: string[] = []

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const configPath = resolve(agentsDir, entry.name, 'agent.yaml')
    if (!existsSync(configPath)) continue

    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = parseYaml(raw) as Record<string, unknown> | null
      if (!config || config.browserProfile !== profileId) continue

      delete config.browserProfile
      writeFileSync(configPath, stringifyYaml(config))
      updatedAgents.push(entry.name)
    } catch {}
  }

  return updatedAgents
}

/**
 * Resolve the agent-browser executable.
 * Returns { command, prefixArgs } for spawn(), or null if not found.
 *
 * Priority:
 * 1. Direct PATH lookup (user already installed globally)
 * 2. ~/.bun/bin/agent-browser (web mode may lack this in PATH)
 * 3. Embedded Bun's `bun x agent-browser` (Tauri bundled mode)
 * 4. System `bunx agent-browser` (dev mode fallback)
 */
function resolveAgentBrowser(): { command: string; prefixArgs: string[]; viaBunx: boolean } | null {
  // 1. PATH lookup
  const directPath = which('agent-browser')
  if (directPath) return { command: directPath, prefixArgs: [], viaBunx: false }

  // 2. Explicit ~/.bun/bin check (web mode PATH may not include it)
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home) {
    const bunGlobalPath = resolve(home, '.bun/bin', 'agent-browser')
    if (existsSync(bunGlobalPath)) return { command: bunGlobalPath, prefixArgs: [], viaBunx: false }
  }

  // 3. Embedded Bun runtime (Tauri packaged mode)
  const embeddedBun = ensureBunRuntime()
  if (embeddedBun) return { command: embeddedBun, prefixArgs: ['x', 'agent-browser'], viaBunx: true }

  // 4. System bunx fallback (dev mode)
  const systemBunx = which('bunx')
  if (systemBunx) return { command: systemBunx, prefixArgs: ['agent-browser'], viaBunx: true }

  return null
}

/** Spawn agent-browser and wait for exit */
function launchAndVerify(
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string; code?: string; installHint?: string }> {
  const resolved = resolveAgentBrowser()
  if (!resolved) {
    return Promise.resolve({
      ok: false,
      error: 'agent-browser is not installed',
      code: 'AGENT_BROWSER_NOT_FOUND',
      installHint: 'bun install -g agent-browser',
    })
  }

  // Allow extra time when using bunx (first run downloads the package)
  const effectiveTimeout = resolved.viaBunx ? Math.max(timeoutMs, 30_000) : timeoutMs

  return new Promise((res) => {
    const fullArgs = [...resolved.prefixArgs, ...args]
    const child = spawn(resolved.command, fullArgs, { stdio: 'pipe' })
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
        res({ ok: false, error: `launch timeout after ${effectiveTimeout}ms` })
      }
    }, effectiveTimeout)

    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        res({ ok: false, error: err.message })
      }
    })

    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          res({ ok: true })
        } else {
          const detail = stderr.trim() || stdout.trim() || `exit code ${code}`
          res({ ok: false, error: detail })
        }
      }
    })
  })
}
