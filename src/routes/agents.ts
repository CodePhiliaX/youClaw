import { Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import type { AgentManager } from '../agent/index.ts'

// 允许通过 API 读写的工作空间文档
const ALLOWED_DOCS = ['SOUL.md', 'AGENT.md', 'USER.md', 'TOOLS.md']

export function createAgentsRoutes(agentManager: AgentManager) {
  const agents = new Hono()

  // GET /api/agents — 列出所有 agents（含状态信息）
  agents.get('/agents', (c) => {
    const configs = agentManager.getAgents()
    // 附加每个 agent 的状态信息
    const agentsWithState = configs.map((config) => {
      const instance = agentManager.getAgent(config.id)
      return {
        ...config,
        state: instance?.state ?? null,
      }
    })
    return c.json(agentsWithState)
  })

  // GET /api/agents/:id — 获取单个 agent 详情（含增强状态）
  agents.get('/agents/:id', (c) => {
    const id = c.req.param('id')
    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    return c.json({
      ...instance.config,
      state: instance.state,
    })
  })

  // GET /api/agents/:id/docs — 列出工作空间所有文档文件及其内容
  agents.get('/agents/:id/docs', (c) => {
    const id = c.req.param('id')
    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const workspaceDir = instance.workspaceDir
    const docs: Record<string, string> = {}

    for (const filename of ALLOWED_DOCS) {
      const filePath = resolve(workspaceDir, filename)
      if (existsSync(filePath)) {
        docs[filename] = readFileSync(filePath, 'utf-8')
      }
    }

    return c.json(docs)
  })

  // GET /api/agents/:id/docs/:filename — 读取指定文档内容
  agents.get('/agents/:id/docs/:filename', (c) => {
    const id = c.req.param('id')
    const filename = c.req.param('filename')

    if (!ALLOWED_DOCS.includes(filename)) {
      return c.json({ error: `不允许访问的文件: ${filename}，允许的文件: ${ALLOWED_DOCS.join(', ')}` }, 400)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const filePath = resolve(instance.workspaceDir, filename)

    if (!existsSync(filePath)) {
      return c.json({ error: `文件不存在: ${filename}` }, 404)
    }

    const content = readFileSync(filePath, 'utf-8')
    return c.json({ filename, content })
  })

  // PUT /api/agents/:id/docs/:filename — 更新指定文档内容
  agents.put('/agents/:id/docs/:filename', async (c) => {
    const id = c.req.param('id')
    const filename = c.req.param('filename')

    if (!ALLOWED_DOCS.includes(filename)) {
      return c.json({ error: `不允许访问的文件: ${filename}，允许的文件: ${ALLOWED_DOCS.join(', ')}` }, 400)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const body = await c.req.json<{ content: string }>()

    if (typeof body.content !== 'string') {
      return c.json({ error: '请求体必须包含 content 字段（字符串）' }, 400)
    }

    const filePath = resolve(instance.workspaceDir, filename)
    writeFileSync(filePath, body.content)

    return c.json({ filename, content: body.content })
  })

  // POST /api/agents — 创建新 agent
  agents.post('/agents', async (c) => {
    const body = await c.req.json<{ id: string; name: string; model?: string }>()

    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: '请求体必须包含 id 字段（字符串）' }, 400)
    }

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: '请求体必须包含 name 字段（字符串）' }, 400)
    }

    // 校验 id 格式，只允许字母数字、连字符、下划线
    if (!/^[a-zA-Z0-9_-]+$/.test(body.id)) {
      return c.json({ error: 'id 只允许字母、数字、连字符和下划线' }, 400)
    }

    const paths = getPaths()
    const agentDir = resolve(paths.agents, body.id)

    // 检查是否已存在
    if (existsSync(agentDir)) {
      return c.json({ error: `Agent "${body.id}" 已存在` }, 409)
    }

    // 创建 agent 目录
    mkdirSync(agentDir, { recursive: true })

    // 创建 memory 子目录
    mkdirSync(resolve(agentDir, 'memory'), { recursive: true })

    // 写入 agent.yaml
    const config: Record<string, unknown> = {
      id: body.id,
      name: body.name,
    }
    if (body.model) {
      config.model = body.model
    }

    writeFileSync(resolve(agentDir, 'agent.yaml'), stringifyYaml(config))

    // 从 default agent 复制模板文件，若不存在则创建空文件
    const defaultDir = resolve(paths.agents, 'default')

    for (const filename of ALLOWED_DOCS) {
      const defaultFilePath = resolve(defaultDir, filename)
      const targetFilePath = resolve(agentDir, filename)

      if (existsSync(defaultFilePath)) {
        const content = readFileSync(defaultFilePath, 'utf-8')
        writeFileSync(targetFilePath, content)
      } else {
        writeFileSync(targetFilePath, `# ${basename(filename, '.md')}\n`)
      }
    }

    // 重新加载 agents
    await agentManager.reloadAgents()

    const instance = agentManager.getAgent(body.id)
    return c.json(instance ? { ...instance.config, state: instance.state } : config, 201)
  })

  // PUT /api/agents/:id — 更新 agent.yaml 配置
  agents.put('/agents/:id', async (c) => {
    const id = c.req.param('id')
    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const configPath = resolve(instance.workspaceDir, 'agent.yaml')

    if (!existsSync(configPath)) {
      return c.json({ error: 'agent.yaml 不存在' }, 404)
    }

    const body = await c.req.json<Record<string, unknown>>()

    // 读取现有配置
    const existingYaml = readFileSync(configPath, 'utf-8')
    const existingConfig = parseYaml(existingYaml) as Record<string, unknown>

    // 合并配置（不允许修改 id）
    const merged = { ...existingConfig, ...body, id }

    // 写回 agent.yaml
    writeFileSync(configPath, stringifyYaml(merged))

    // 重新加载 agents
    await agentManager.reloadAgents()

    const updated = agentManager.getAgent(id)
    return c.json(updated ? { ...updated.config, state: updated.state } : merged)
  })

  // DELETE /api/agents/:id — 删除 agent
  agents.delete('/agents/:id', async (c) => {
    const id = c.req.param('id')

    // 不允许删除 default agent
    if (id === 'default') {
      return c.json({ error: '不允许删除默认 agent' }, 403)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // 递归删除 agent 目录
    rmSync(instance.workspaceDir, { recursive: true, force: true })

    // 重新加载 agents
    await agentManager.reloadAgents()

    return c.json({ message: `Agent "${id}" 已删除` })
  })

  // GET /api/routes — 汇总路由表
  agents.get('/routes', (c) => {
    const router = agentManager.getRouter()
    if (!router) {
      return c.json([])
    }
    return c.json(router.getRouteTable())
  })

  return agents
}
