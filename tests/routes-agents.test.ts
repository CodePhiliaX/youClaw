import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import './setup.ts'
import { createAgentsRoutes } from '../src/routes/agents.ts'
import { getPaths } from '../src/config/index.ts'
import { AgentManager } from '../src/agent/manager.ts'
import { PromptBuilder } from '../src/agent/prompt-builder.ts'
import { EventBus } from '../src/events/bus.ts'

const createdAgentIds = new Set<string>()
const tempWorkspaces: string[] = []

function createAgentId(prefix: string) {
  const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  createdAgentIds.add(agentId)
  return agentId
}

function getAgentDir(agentId: string) {
  return resolve(getPaths().agents, agentId)
}

async function createRealManager() {
  const manager = new AgentManager(new EventBus(), new PromptBuilder(null, null))
  await manager.loadAgents()
  return manager
}

describe('agents routes', () => {
  beforeEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(getAgentDir(agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()

    for (const workspace of tempWorkspaces) {
      rmSync(workspace, { recursive: true, force: true })
    }
    tempWorkspaces.length = 0
  })

  afterEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(getAgentDir(agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()

    for (const workspace of tempWorkspaces) {
      rmSync(workspace, { recursive: true, force: true })
    }
    tempWorkspaces.length = 0
  })

  test('GET /agents returns config and state', async () => {
    const app = createAgentsRoutes({
      getAgents: () => [{ id: 'agent-1', name: 'Agent 1', workspaceDir: '/tmp/a1' }],
      getAgent: () => ({
        state: {
          isProcessing: true,
          totalProcessed: 3,
          queueDepth: 1,
        },
      }),
    } as any)

    const res = await app.request('/agents')
    const body = await res.json() as Array<{ id: string; state: { isProcessing: boolean; totalProcessed: number } }>

    expect(res.status).toBe(200)
    expect(body[0]?.id).toBe('agent-1')
    expect(body[0]?.state.isProcessing).toBe(true)
    expect(body[0]?.state.totalProcessed).toBe(3)
  })

  test('docs endpoint only returns allowed documents, and supports read and update', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'youclaw-agent-docs-'))
    tempWorkspaces.push(workspaceDir)
    writeFileSync(resolve(workspaceDir, 'AGENT.md'), '# Agent')
    writeFileSync(resolve(workspaceDir, 'USER.md'), '# User')
    writeFileSync(resolve(workspaceDir, 'README.md'), '# Ignored')

    const app = createAgentsRoutes({
      getAgents: () => [],
      getAgent: (id: string) => id === 'agent-docs'
        ? {
          config: { id, name: 'Docs Agent' },
          workspaceDir,
          state: {},
        }
        : undefined,
    } as any)

    const listRes = await app.request('/agents/agent-docs/docs')
    const getRes = await app.request('/agents/agent-docs/docs/AGENT.md')
    const putRes = await app.request('/agents/agent-docs/docs/AGENT.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Updated Agent' }),
    })
    const invalidRes = await app.request('/agents/agent-docs/docs/README.md')

    expect(await listRes.json()).toEqual({
      'AGENT.md': '# Agent',
      'USER.md': '# User',
    })
    expect(await getRes.json()).toEqual({ filename: 'AGENT.md', content: '# Agent' })
    expect(putRes.status).toBe(200)
    expect(readFileSync(resolve(workspaceDir, 'AGENT.md'), 'utf-8')).toBe('# Updated Agent')
    expect(invalidRes.status).toBe(400)
  })

  test('POST /agents creates a new agent and copies template files', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-create')

    const res = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: 'Route Create Agent',
        model: 'claude-sonnet-4-6',
      }),
    })

    const body = await res.json() as { id: string; name: string }
    const agentDir = getAgentDir(agentId)
    expect(res.status).toBe(201)
    expect(body.id).toBe(agentId)
    expect(body.name).toBe('Route Create Agent')
    expect(existsSync(resolve(agentDir, 'agent.yaml'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'memory'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'AGENT.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'SOUL.md'))).toBe(true)
    expect(manager.getAgent(agentId)?.config.name).toBe('Route Create Agent')
  })

  test('PUT /agents/:id updates agent.yaml but does not change id', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-update')

    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Before Update' }),
    })
    expect(createRes.status).toBe(201)

    const updateRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'should-not-change',
        name: 'After Update',
        trigger: '^@bot',
      }),
    })

    const body = await updateRes.json() as { id: string; name: string; trigger?: string }
    const yaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(updateRes.status).toBe(200)
    expect(body.id).toBe(agentId)
    expect(body.name).toBe('After Update')
    expect(body.trigger).toBe('^@bot')
    expect(yaml.id).toBe(agentId)
    expect(yaml.name).toBe('After Update')
    expect(yaml.trigger).toBe('^@bot')
  })

  test('DELETE /agents/:id forbids deleting default, allows deleting regular agent', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-delete')

    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Delete Me' }),
    })
    expect(createRes.status).toBe(201)

    const defaultRes = await app.request('/agents/default', { method: 'DELETE' })
    const deleteRes = await app.request(`/agents/${agentId}`, { method: 'DELETE' })

    expect(defaultRes.status).toBe(403)
    expect(deleteRes.status).toBe(200)
    expect(existsSync(getAgentDir(agentId))).toBe(false)
    expect(manager.getAgent(agentId)).toBeUndefined()
  })
})
