import { Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import type { AgentManager } from '../agent/index.ts'
import { EDITABLE_WORKSPACE_DOCS } from '../agent/index.ts'
import { ensureAgentWorkspace } from '../agent/workspace.ts'

const ALLOWED_DOCS = [...EDITABLE_WORKSPACE_DOCS, 'MEMORY.md'] as const
type AllowedDoc = (typeof ALLOWED_DOCS)[number]

function resolveDocPath(workspaceDir: string, filename: AllowedDoc): string {
  if (filename === 'MEMORY.md') {
    return resolve(workspaceDir, 'MEMORY.md')
  }
  return resolve(workspaceDir, filename)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function applyConfigPatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target }

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
      continue
    }

    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = applyConfigPatch(next[key] as Record<string, unknown>, value)
      continue
    }

    next[key] = value
  }

  return next
}

export function createAgentsRoutes(agentManager: AgentManager) {
  const agents = new Hono()

  // GET /api/agents — list all agents (with state info)
  agents.get('/agents', (c) => {
    const configs = agentManager.getAgents()
    // Attach state info for each agent
    const agentsWithState = configs.map((config) => {
      const instance = agentManager.getAgent(config.id)
      return {
        ...config,
        state: instance?.state ?? null,
      }
    })
    return c.json(agentsWithState)
  })

  // GET /api/agents/:id — get single agent details (with enhanced state)
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

  // GET /api/agents/:id/docs — list all workspace documents with content
  agents.get('/agents/:id/docs', (c) => {
    const id = c.req.param('id')
    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const workspaceDir = instance.workspaceDir
    const docs: Record<string, string> = {}

    for (const filename of ALLOWED_DOCS) {
      const filePath = resolveDocPath(workspaceDir, filename)
      if (existsSync(filePath)) {
        docs[filename] = readFileSync(filePath, 'utf-8')
      }
    }

    return c.json(docs)
  })

  // GET /api/agents/:id/docs/:filename — read specific document content
  agents.get('/agents/:id/docs/:filename', (c) => {
    const id = c.req.param('id')
    const filename = c.req.param('filename')

    if (!ALLOWED_DOCS.includes(filename as AllowedDoc)) {
      return c.json({ error: `File not allowed: ${filename}. Allowed files: ${ALLOWED_DOCS.join(', ')}` }, 400)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const filePath = resolveDocPath(instance.workspaceDir, filename as AllowedDoc)

    if (!existsSync(filePath)) {
      return c.json({ error: `File not found: ${filename}` }, 404)
    }

    const content = readFileSync(filePath, 'utf-8')
    return c.json({ filename, content })
  })

  // PUT /api/agents/:id/docs/:filename — update specific document content
  agents.put('/agents/:id/docs/:filename', async (c) => {
    const id = c.req.param('id')
    const filename = c.req.param('filename')

    if (!ALLOWED_DOCS.includes(filename as AllowedDoc)) {
      return c.json({ error: `File not allowed: ${filename}. Allowed files: ${ALLOWED_DOCS.join(', ')}` }, 400)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const body = await c.req.json<{ content: string }>()

    if (typeof body.content !== 'string') {
      return c.json({ error: 'Request body must include a "content" field (string)' }, 400)
    }

    const filePath = resolveDocPath(instance.workspaceDir, filename as AllowedDoc)
    writeFileSync(filePath, body.content)

    return c.json({ filename, content: body.content })
  })

  // POST /api/agents — create a new agent
  agents.post('/agents', async (c) => {
    const body = await c.req.json<{ id?: string; name: string; model?: string }>()

    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'Request body must include a "name" field (string)' }, 400)
    }

    // Auto-generate id if not provided
    const id = (body.id && typeof body.id === 'string') ? body.id : crypto.randomUUID().slice(0, 8)

    // Validate id format: only alphanumeric, hyphens, and underscores allowed
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return c.json({ error: 'id may only contain letters, digits, hyphens, and underscores' }, 400)
    }

    const paths = getPaths()
    const agentDir = resolve(paths.agents, id)

    // Check if already exists
    if (existsSync(agentDir)) {
      return c.json({ error: `Agent "${id}" already exists` }, 409)
    }

    // Create agent directory
    mkdirSync(agentDir, { recursive: true })

    // Write agent.yaml
    const config: Record<string, unknown> = {
      id,
      name: body.name,
      memory: {
        enabled: true,
      },
      skills: [],
    }
    if (body.model) {
      config.model = body.model
    }

    writeFileSync(resolve(agentDir, 'agent.yaml'), stringifyYaml(config))
    ensureAgentWorkspace(agentDir, { ensureBootstrap: true })

    // Reload agents
    await agentManager.reloadAgents()

    const instance = agentManager.getAgent(id)
    return c.json(instance ? { ...instance.config, state: instance.state } : config, 201)
  })

  // PUT /api/agents/:id — update agent.yaml config
  agents.put('/agents/:id', async (c) => {
    const id = c.req.param('id')
    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const configPath = resolve(instance.workspaceDir, 'agent.yaml')

    if (!existsSync(configPath)) {
      return c.json({ error: 'agent.yaml not found' }, 404)
    }

    const body = await c.req.json<Record<string, unknown>>()

    // Read existing config
    const existingYaml = readFileSync(configPath, 'utf-8')
    const existingConfig = parseYaml(existingYaml) as Record<string, unknown>

    // Merge config (id cannot be changed). null values delete keys.
    const merged = applyConfigPatch(existingConfig, { ...body, id })

    // Write back agent.yaml
    writeFileSync(configPath, stringifyYaml(merged))

    // Reload agents so updated configuration takes effect.
    await agentManager.reloadAgents()

    const updated = agentManager.getAgent(id)
    return c.json(updated ? { ...updated.config, state: updated.state } : merged)
  })

  // DELETE /api/agents/:id — delete an agent
  agents.delete('/agents/:id', async (c) => {
    const id = c.req.param('id')

    // Cannot delete the default agent
    if (id === 'default') {
      return c.json({ error: 'Cannot delete the default agent' }, 403)
    }

    const instance = agentManager.getAgent(id)

    if (!instance) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // Recursively delete agent directory
    rmSync(instance.workspaceDir, { recursive: true, force: true })

    // Reload agents
    await agentManager.reloadAgents()

    return c.json({ message: `Agent "${id}" deleted` })
  })

  // GET /api/routes — aggregate route table
  agents.get('/routes', (c) => {
    const router = agentManager.getRouter()
    if (!router) {
      return c.json([])
    }
    return c.json(router.getRouteTable())
  })

  return agents
}
