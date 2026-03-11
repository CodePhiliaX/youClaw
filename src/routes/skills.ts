import { Hono } from 'hono'
import { z } from 'zod/v4'
import { resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { ROOT_DIR } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import type { AgentManager } from '../agent/index.ts'

const configureEnvSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string(),
})

const installSchema = z.object({
  skillName: z.string().min(1),
  method: z.string().min(1),
})

export function createSkillsRoutes(skillsLoader: SkillsLoader, agentManager: AgentManager) {
  const skills = new Hono()

  // GET /api/skills — 所有可用 skills
  skills.get('/skills', (c) => {
    const allSkills = skillsLoader.loadAllSkills()
    return c.json(allSkills)
  })

  // GET /api/skills/stats — 缓存统计
  skills.get('/skills/stats', (c) => {
    const stats = skillsLoader.getCacheStats()
    const config = skillsLoader.getConfig()
    return c.json({ ...stats, config })
  })

  // POST /api/skills/reload — 强制重载
  skills.post('/skills/reload', (c) => {
    const reloaded = skillsLoader.refresh()
    return c.json({ count: reloaded.length, reloadedAt: Date.now() })
  })

  // POST /api/skills/configure — 保存环境变量到 .env
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
      // 读取现有 .env 内容
      let content = ''
      if (existsSync(envPath)) {
        content = readFileSync(envPath, 'utf-8')
      }

      // 替换或追加
      const lineRegex = new RegExp(`^(#\\s*)?${key}\\s*=.*$`, 'm')
      if (lineRegex.test(content)) {
        content = content.replace(lineRegex, `${key}=${value}`)
      } else {
        content = content.trimEnd() + `\n${key}=${value}\n`
      }

      writeFileSync(envPath, content, 'utf-8')

      // 立即更新 process.env，无需重启
      process.env[key] = value

      // 重新加载 skills，使 eligibility 检查使用新的环境变量
      skillsLoader.refresh()

      logger.info({ key }, '环境变量已保存到 .env')
      return c.json({ ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ key, error: msg }, '保存环境变量失败')
      return c.json({ error: msg }, 500)
    }
  })

  // POST /api/skills/install — 执行安装命令
  skills.post('/skills/install', async (c) => {
    const body = await c.req.json()
    const parsed = installSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid parameters', details: parsed.error.issues }, 400)
    }

    const { skillName, method } = parsed.data
    const logger = getLogger()

    // 查找 skill
    const allSkills = skillsLoader.loadAllSkills()
    const skill = allSkills.find((s) => s.name === skillName)
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    // 查找安装命令
    const command = skill.frontmatter.install?.[method]
    if (!command) {
      return c.json({ error: `Install method "${method}" not found for skill "${skillName}"` }, 400)
    }

    logger.info({ skillName, method, command }, '开始安装 skill 依赖')

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

      // 安装完成后重新加载 skills
      skillsLoader.refresh()

      logger.info({ skillName, method, exitCode }, '安装完成')
      return c.json({ ok: exitCode === 0, stdout, stderr, exitCode })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error({ skillName, method, error: msg }, '安装失败')
      return c.json({ error: msg }, 500)
    }
  })

  // GET /api/skills/:name — 单个 skill 详情
  skills.get('/skills/:name', (c) => {
    const name = c.req.param('name')
    const allSkills = skillsLoader.loadAllSkills()
    const skill = allSkills.find((s) => s.name === name)

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404)
    }

    return c.json(skill)
  })

  // GET /api/agents/:id/skills — agent 启用的 skills
  skills.get('/agents/:id/skills', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const agentSkills = skillsLoader.loadSkillsForAgent(managed.config)
    return c.json(agentSkills)
  })

  return skills
}
