import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import './setup.ts'
import { createBrowserProfilesRoutes } from '../src/routes/browser-profiles.ts'
import { createAgentsRoutes } from '../src/routes/agents.ts'
import { getPaths } from '../src/config/index.ts'
import { createBrowserProfile } from '../src/db/index.ts'
import { AgentManager } from '../src/agent/manager.ts'
import { PromptBuilder } from '../src/agent/prompt-builder.ts'
import { EventBus } from '../src/events/bus.ts'

const createdAgentIds = new Set<string>()
const createdProfileIds = new Set<string>()

function createAgentId(prefix: string) {
  const agentId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  createdAgentIds.add(agentId)
  return agentId
}

function createProfileId(prefix: string) {
  const profileId = `${prefix}-${Math.random().toString(36).slice(2, 8)}`
  createdProfileIds.add(profileId)
  return profileId
}

function getAgentDir(agentId: string) {
  return resolve(getPaths().agents, agentId)
}

async function createRealManager() {
  const manager = new AgentManager(
    new EventBus(),
    new PromptBuilder(null, null),
  )
  await manager.loadAgents()
  return manager
}

describe('browser profile routes', () => {
  beforeEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(getAgentDir(agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()

    for (const profileId of createdProfileIds) {
      rmSync(resolve(getPaths().browserProfiles, profileId), { recursive: true, force: true })
    }
    createdProfileIds.clear()
  })

  afterEach(() => {
    for (const agentId of createdAgentIds) {
      rmSync(getAgentDir(agentId), { recursive: true, force: true })
    }
    createdAgentIds.clear()

    for (const profileId of createdProfileIds) {
      rmSync(resolve(getPaths().browserProfiles, profileId), { recursive: true, force: true })
    }
    createdProfileIds.clear()
  })

  test('DELETE /browser-profiles/:id clears agent browserProfile bindings and reloads agents', async () => {
    const manager = await createRealManager()
    const agentsApp = createAgentsRoutes(manager)
    const browserProfilesApp = createBrowserProfilesRoutes(manager)
    const agentId = createAgentId('browser-binding')
    const profileId = createProfileId('browser-profile')

    const createAgentRes = await agentsApp.request('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agentId, name: 'Browser Bound Agent' }),
    })
    expect(createAgentRes.status).toBe(201)

    createBrowserProfile({ id: profileId, name: 'Persistent Login' })
    mkdirSync(resolve(getPaths().browserProfiles, profileId), { recursive: true })

    const bindRes = await agentsApp.request(`/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserProfile: profileId }),
    })
    expect(bindRes.status).toBe(200)

    const deleteRes = await browserProfilesApp.request(`/browser-profiles/${profileId}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)

    const yaml = parseYaml(readFileSync(resolve(getAgentDir(agentId), 'agent.yaml'), 'utf-8')) as Record<string, unknown>
    expect(yaml.browserProfile).toBeUndefined()
    expect(manager.getAgent(agentId)?.config.browserProfile).toBeUndefined()
    expect(existsSync(resolve(getPaths().browserProfiles, profileId))).toBe(false)
  })
})
