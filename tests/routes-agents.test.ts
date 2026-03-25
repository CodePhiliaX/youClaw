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

async function createRealManager(skillsLoader?: any) {
  const manager = new AgentManager(
    new EventBus(),
    new PromptBuilder(skillsLoader ?? null, null),
    undefined,
    undefined,
    undefined,
    skillsLoader,
  )
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
    writeFileSync(resolve(workspaceDir, 'AGENTS.md'), '# Agents')
    writeFileSync(resolve(workspaceDir, 'USER.md'), '# User')
    writeFileSync(resolve(workspaceDir, 'MEMORY.md'), '# Memory')
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
    const getRes = await app.request('/agents/agent-docs/docs/AGENTS.md')
    const putRes = await app.request('/agents/agent-docs/docs/AGENTS.md', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Updated Agents' }),
    })
    const invalidRes = await app.request('/agents/agent-docs/docs/README.md')

    expect(await listRes.json()).toEqual({
      'AGENTS.md': '# Agents',
      'USER.md': '# User',
      'MEMORY.md': '# Memory',
    })
    expect(await getRes.json()).toEqual({ filename: 'AGENTS.md', content: '# Agents' })
    expect(putRes.status).toBe(200)
    expect(readFileSync(resolve(workspaceDir, 'AGENTS.md'), 'utf-8')).toBe('# Updated Agents')
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
    expect(existsSync(resolve(agentDir, 'AGENTS.md'))).toBe(true)
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

  test('PUT /agents/:id can set skills to wildcard ["*"] and back to []', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-skills')

    await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Skills Agent' }),
    })

    // Initially skills: []
    const initial = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>
    expect(initial.skills).toEqual([])

    // Set skills to ["*"] (Select All)
    const wildRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['*'] }),
    })
    const wildBody = await wildRes.json() as { skills: string[] }
    const wildYaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(wildRes.status).toBe(200)
    expect(wildBody.skills).toEqual(['*'])
    expect(wildYaml.skills).toEqual(['*'])

    // Set skills back to [] (Deselect All)
    const emptyRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: [] }),
    })
    const emptyBody = await emptyRes.json() as { skills: string[] }
    const emptyYaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(emptyRes.status).toBe(200)
    expect(emptyBody.skills).toEqual([])
    expect(emptyYaml.skills).toEqual([])
  })

  test('PUT /agents/:id can set skills to specific skill names', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-skills-specific')

    await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Specific Skills Agent' }),
    })

    const res = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['apple-notes', 'hello-world'] }),
    })
    const body = await res.json() as { skills: string[] }
    const yaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.skills).toEqual(['apple-notes', 'hello-world'])
    expect(yaml.skills).toEqual(['apple-notes', 'hello-world'])
  })

  test('PUT /agents/:id normalizes legacy registry slugs to local skill names', async () => {
    const skillsLoader = {
      normalizeAgentSkillNames: (skills?: string[]) => ({
        skills: skills?.map((skill) => skill === 'self-improving-agent' ? 'self-improvement' : skill),
        changed: Boolean(skills?.includes('self-improving-agent')),
      }),
    }
    const manager = await createRealManager(skillsLoader)
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-skills-normalize')

    await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Normalize Skills Agent' }),
    })

    const res = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['self-improving-agent'] }),
    })
    const body = await res.json() as { skills: string[] }
    const yaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.skills).toEqual(['self-improvement'])
    expect(yaml.skills).toEqual(['self-improvement'])
  })

  test('toggling from specific skills to wildcard and back preserves no stale entries', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-skills-toggle')

    await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Toggle Skills Agent' }),
    })

    // Set specific skills
    const specificRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['skill-a', 'skill-b'] }),
    })
    const specificBody = await specificRes.json() as { skills: string[] }

    expect(specificRes.status).toBe(200)
    expect(specificBody.skills).toEqual(['skill-a', 'skill-b'])

    // Switch to wildcard
    const wildRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['*'] }),
    })
    const wildBody = await wildRes.json() as { skills: string[] }

    expect(wildRes.status).toBe(200)
    expect(wildBody.skills).toEqual(['*'])

    // Switch to a different specific skill — no stale "skill-a" or "skill-b"
    const newRes = await app.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: ['skill-c'] }),
    })
    const newBody = await newRes.json() as { skills: string[] }
    const yaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>

    expect(newRes.status).toBe(200)
    expect(newBody.skills).toEqual(['skill-c'])
    expect(yaml.skills).toEqual(['skill-c'])
  })

  test('POST /agents with duplicate id returns 409', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-dup')

    const firstRes = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'First Agent' }),
    })
    expect(firstRes.status).toBe(201)

    const dupRes = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Duplicate Agent' }),
    })
    const dupBody = await dupRes.json() as { error: string }

    expect(dupRes.status).toBe(409)
    expect(dupBody.error).toContain('already exists')
  })

  test('POST /agents with invalid id format returns 400', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)

    const invalidIds = ['has spaces', 'special!char', 'path/traversal', 'dot.dot']
    for (const invalidId of invalidIds) {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invalidId, name: 'Invalid Agent' }),
      })
      const body = await res.json() as { error: string }

      expect(res.status).toBe(400)
      expect(body.error).toContain('letters, digits, hyphens, and underscores')
    }
  })

  test('POST /agents auto-generates id when not provided', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)

    const res = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Auto ID Agent' }),
    })
    const body = await res.json() as { id: string; name: string }

    expect(res.status).toBe(201)
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(body.name).toBe('Auto ID Agent')

    // Track for cleanup
    createdAgentIds.add(body.id)
  })

  test('DELETE /agents/:id returns 404 for non-existent agent', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)

    const res = await app.request('/agents/non-existent-agent-xyz', { method: 'DELETE' })
    const body = await res.json() as { error: string }

    expect(res.status).toBe(404)
    expect(body.error).toContain('not found')
  })

  test('PUT /agents/:id returns 404 for non-existent agent', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)

    const res = await app.request('/agents/non-existent-agent-xyz', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost Agent' }),
    })
    const body = await res.json() as { error: string }

    expect(res.status).toBe(404)
    expect(body.error).toContain('not found')
  })

  test('POST /agents creates correct directory structure with all template files', async () => {
    const manager = await createRealManager()
    const app = createAgentsRoutes(manager)
    const agentId = createAgentId('route-structure')

    const res = await app.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Structure Agent', model: 'claude-sonnet-4-6' }),
    })
    expect(res.status).toBe(201)

    const agentDir = getAgentDir(agentId)

    // Verify agent.yaml exists and has correct content
    const yamlContent = parseYaml(readFileSync(resolve(agentDir, 'agent.yaml'), 'utf-8')) as Record<string, unknown>
    expect(yamlContent.id).toBe(agentId)
    expect(yamlContent.name).toBe('Structure Agent')
    expect(yamlContent.model).toBe('claude-sonnet-4-6')
    expect(yamlContent.skills).toEqual([])

    // Verify all workspace docs are created
    expect(existsSync(resolve(agentDir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'SOUL.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'IDENTITY.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'USER.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'TOOLS.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'HEARTBEAT.md'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'BOOTSTRAP.md'))).toBe(true)

    // Verify memory directory and MEMORY.md
    expect(existsSync(resolve(agentDir, 'memory'))).toBe(true)
    expect(existsSync(resolve(agentDir, 'MEMORY.md'))).toBe(true)

    // Verify template files have non-empty content
    expect(readFileSync(resolve(agentDir, 'AGENTS.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'SOUL.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'IDENTITY.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'USER.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'TOOLS.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'HEARTBEAT.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'BOOTSTRAP.md'), 'utf-8').length).toBeGreaterThan(0)
    expect(readFileSync(resolve(agentDir, 'MEMORY.md'), 'utf-8').length).toBeGreaterThan(0)
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
