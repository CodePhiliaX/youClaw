import { Hono } from 'hono'
import { z } from 'zod/v4'
import { resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { ROOT_DIR } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import { SkillsInstaller } from '../skills/installer.ts'
import type { AgentManager } from '../agent/index.ts'

const configureEnvSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string(),
})

const installSchema = z.object({
  skillName: z.string().min(1),
  method: z.string().min(1),
})

const toggleSchema = z.object({
  enabled: z.boolean(),
})

const installFromPathSchema = z.object({
  sourcePath: z.string().min(1),
  targetDir: z.string().optional(),
})

const installFromUrlSchema = z.object({
  url: z.string().url(),
  targetDir: z.string().optional(),
})

export function createSkillsRoutes(skillsLoader: SkillsLoader, agentManager: AgentManager) {
  const skills = new Hono()
  const installer = new SkillsInstaller()

  // GET /api/skills — all available skills
  skills.get('/skills', (c) => {
    const allSkills = skillsLoader.loadAllSkills()
    return c.json(allSkills)
  })

  // GET /api/skills/stats — cache statistics
  skills.get('/skills/stats', (c) => {
    const stats = skillsLoader.getCacheStats()
    const config = skillsLoader.getConfig()
    return c.json({ ...stats, config })
  })

  // POST /api/skills/reload — force reload
  skills.post('/skills/reload', (c) => {
    const reloaded = skillsLoader.refresh()
    return c.json({ count: reloaded.length, reloadedAt: Date.now() })
  })

  // POST /api/skills/configure — save environment variable to .env
  skills.post('/skills/configure', async (c) => {
    const body = await c.req.json()
    const parsed = configureEnvSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const { key, value } = parsed.data
    const envPath = resolve(ROOT_DIR, '.env')
    const logger = getLogger()

    try {
      // Read existing .env content
      let content = ''
      if (existsSync(envPath)) {
        content = readFileSync(envPath, 'utf-8')
      }

      // Replace or append
      const lineRegex = new RegExp(`^(#\\s*)?${key}\\s*=.*$`, 'm')
      if (lineRegex.test(content)) {
        content = content.replace(lineRegex, `${key}=${value}`)
      } else {
        content = content.trimEnd() + `\n${key}=${value}\n`
      }

      writeFileSync(envPath, content, 'utf-8')

      // Update process.env immediately, no restart needed
      process.env[key] = value

      // Reload skills so eligibility checks use the new env vars
      skillsLoader.refresh()

      logger.info({ key }, 'Env var saved to .env')
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ key, error: msg }, 'Failed to save env var')
      return c.json({ error: msg }, 500)
    }
  })

  // POST /api/skills/install — run install command (dependency installation for existing skill)
  skills.post('/skills/install', async (c) => {
    const body = await c.req.json()
    const parsed = installSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const { skillName, method } = parsed.data
    const logger = getLogger()

    // Find skill
    const allSkills = skillsLoader.loadAllSkills()
    const skill = allSkills.find((s) => s.name === skillName)
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    // Find install command
    const command = skill.frontmatter.install?.[method]
    if (!command) {
      return c.json({ error: `Install method "${method}" not found for skill "${skillName}"` }, 400)
    }

    logger.info({ skillName, method, command }, 'Installing skill dependency')

    try {
      let stdout = ''
      let stderr = ''
      let exitCode = 0
      try {
        stdout = execSync(command, { encoding: 'utf-8', timeout: 120_000 })
      } catch (execErr: any) {
        stdout = execErr.stdout ?? ''
        stderr = execErr.stderr ?? ''
        exitCode = execErr.status ?? 1
      }

      // Reload skills after installation
      skillsLoader.refresh()

      logger.info({ skillName, method, exitCode }, 'Installation complete')
      return c.json({ ok: exitCode === 0, stdout, stderr, exitCode })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ skillName, method, error: msg }, 'Installation failed')
      return c.json({ error: msg }, 500)
    }
  })

  // POST /api/skills/:name/toggle — enable/disable a skill
  skills.post('/skills/:name/toggle', async (c) => {
    const name = c.req.param('name')
    const body = await c.req.json()
    const parsed = toggleSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const allSkills = skillsLoader.loadAllSkills()
    const exists = allSkills.find((s) => s.name === name)
    if (!exists) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    const updated = skillsLoader.setSkillEnabled(name, parsed.data.enabled)
    return c.json(updated)
  })

  // POST /api/skills/install-from-path — install skill from local path
  skills.post('/skills/install-from-path', async (c) => {
    const body = await c.req.json()
    const parsed = installFromPathSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const { sourcePath, targetDir } = parsed.data
    const dest = targetDir ?? resolve(ROOT_DIR, 'skills')

    try {
      await installer.installFromLocal(sourcePath, dest)
      skillsLoader.refresh()
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })

  // POST /api/skills/install-from-url — install skill from remote URL
  skills.post('/skills/install-from-url', async (c) => {
    const body = await c.req.json()
    const parsed = installFromUrlSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const { url, targetDir } = parsed.data
    const dest = targetDir ?? resolve(ROOT_DIR, 'skills')

    try {
      await installer.installFromUrl(url, dest)
      skillsLoader.refresh()
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })

  // DELETE /api/skills/:name — uninstall a skill
  skills.delete('/skills/:name', async (c) => {
    const name = c.req.param('name')
    const logger = getLogger()

    // Find skill to get its path
    const allSkills = skillsLoader.loadAllSkills()
    const skill = allSkills.find((s) => s.name === name)

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    // Only allow uninstalling project-level and user-level skills (not workspace-level)
    if (skill.source === 'workspace') {
      return c.json({ error: 'Cannot uninstall workspace-level skills via API' }, 403)
    }

    try {
      const { dirname } = await import('node:path')
      const skillDir = dirname(skill.path)
      await installer.uninstall(resolve(skillDir, '..').split('/').pop()!, dirname(skillDir))
      skillsLoader.refresh()
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ name, error: msg }, 'Failed to uninstall skill')
      return c.json({ error: msg }, 500)
    }
  })

  // GET /api/skills/:name — single skill details
  skills.get('/skills/:name', (c) => {
    const name = c.req.param('name')
    const allSkills = skillsLoader.loadAllSkills()
    const skill = allSkills.find((s) => s.name === name)

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    return c.json(skill)
  })

  // GET /api/agents/:id/skills — agent skills view (enhanced)
  skills.get('/agents/:id/skills', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const view = skillsLoader.getAgentSkillsView(managed.config)
    return c.json(view)
  })

  return skills
}
