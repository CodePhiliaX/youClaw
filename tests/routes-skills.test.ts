import { describe, test, expect } from 'bun:test'
import { createSkillsRoutes } from '../src/routes/skills.ts'

const baseSkill = {
  name: 'pdf',
  source: 'workspace',
  frontmatter: {
    name: 'pdf',
    description: 'Read PDFs',
  },
  content: 'body',
  path: '/tmp/pdf/SKILL.md',
  eligible: true,
  eligibilityErrors: [],
  eligibilityDetail: {
    os: { passed: true, current: process.platform },
    dependencies: { passed: true, results: [] },
    env: { passed: true, results: [] },
  },
  loadedAt: 1,
  enabled: true,
  usable: true,
}

describe('skills routes', () => {
  test('GET /skills returns all skills', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({ totalCached: 1 }),
        getConfig: () => ({ maxSkillCount: 50 }),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
        getAgentSkillsView: () => ({ available: [baseSkill], enabled: [baseSkill], eligible: [baseSkill] }),
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills')
    const body = await res.json() as Array<{ name: string }>

    expect(res.status).toBe(200)
    expect(body.map((skill) => skill.name)).toEqual(['pdf'])
  })

  test('GET /skills/stats returns cache statistics and config', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({ totalCached: 1, lastLoadedAt: 123 }),
        getConfig: () => ({ maxSkillCount: 50, maxTotalChars: 30000 }),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
        getAgentSkillsView: () => ({ available: [baseSkill], enabled: [baseSkill], eligible: [baseSkill] }),
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills/stats')
    const body = await res.json() as { totalCached: number; lastLoadedAt: number; config: { maxSkillCount: number } }

    expect(body.totalCached).toBe(1)
    expect(body.lastLoadedAt).toBe(123)
    expect(body.config.maxSkillCount).toBe(50)
  })

  test('GET /skills/:name returns 404 when not found', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({}),
        getConfig: () => ({}),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
        getAgentSkillsView: () => ({ available: [], enabled: [], eligible: [] }),
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills/missing')

    expect(res.status).toBe(404)
  })

  test('GET /agents/:id/skills returns skills view when agent exists', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({}),
        getConfig: () => ({}),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
        getAgentSkillsView: () => ({
          available: [baseSkill],
          enabled: [baseSkill],
          eligible: [baseSkill],
        }),
      } as any,
      { getAgent: (id: string) => id === 'agent-1' ? { config: { id } } : undefined } as any,
    )

    const ok = await app.request('/agents/agent-1/skills')
    const missing = await app.request('/agents/missing/skills')

    expect(ok.status).toBe(200)
    const body = await ok.json() as { available: Array<{ name: string }>; enabled: Array<{ name: string }>; eligible: Array<{ name: string }> }
    expect(body.available[0]?.name).toBe('pdf')
    expect(body.enabled[0]?.name).toBe('pdf')
    expect(body.eligible[0]?.name).toBe('pdf')
    expect(missing.status).toBe(404)
  })

  test('POST /skills/:name/toggle toggles correctly', async () => {
    const disabledSkill = { ...baseSkill, enabled: false, usable: false }
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({}),
        getConfig: () => ({}),
        refresh: () => [disabledSkill],
        loadSkillsForAgent: () => [baseSkill],
        setSkillEnabled: (_name: string, _enabled: boolean) => disabledSkill,
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills/pdf/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    const body = await res.json() as { name: string; enabled: boolean; usable: boolean }

    expect(res.status).toBe(200)
    expect(body.name).toBe('pdf')
    expect(body.enabled).toBe(false)
    expect(body.usable).toBe(false)
  })

  test('POST /skills/:name/toggle returns 404 for nonexistent skill', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({}),
        getConfig: () => ({}),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
        setSkillEnabled: () => null,
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills/nonexistent/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })

    expect(res.status).toBe(404)
  })

  test('GET /skills returns items with enabled and usable fields', async () => {
    const app = createSkillsRoutes(
      {
        loadAllSkills: () => [baseSkill],
        getCacheStats: () => ({}),
        getConfig: () => ({}),
        refresh: () => [baseSkill],
        loadSkillsForAgent: () => [baseSkill],
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const res = await app.request('/skills')
    const body = await res.json() as Array<{ name: string; enabled: boolean; usable: boolean }>

    expect(res.status).toBe(200)
    expect(body[0]?.enabled).toBe(true)
    expect(body[0]?.usable).toBe(true)
  })
})
