import { describe, test, expect, mock } from 'bun:test'
import { createMemoryRoutes } from '../src/routes/memory.ts'

describe('memory routes', () => {
  test('GET /agents/:id/memory returns 404 when agent does not exist', async () => {
    const app = createMemoryRoutes(
      {
        getMemory: () => '',
        updateMemory: () => {},
        getDailyLogDates: () => [],
        getDailyLog: () => '',
      } as any,
      { getAgent: () => undefined } as any,
    )

    const res = await app.request('/agents/missing/memory')
    expect(res.status).toBe(404)
  })

  test('GET/PUT /agents/:id/memory reads and writes MEMORY.md', async () => {
    const updateMemory = mock(() => {})
    const app = createMemoryRoutes(
      {
        getMemory: () => 'existing memory',
        updateMemory,
        getDailyLogDates: () => [],
        getDailyLog: () => '',
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const getRes = await app.request('/agents/agent-1/memory')
    expect(await getRes.json()).toEqual({ content: 'existing memory' })

    const putRes = await app.request('/agents/agent-1/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new memory' }),
    })

    expect(putRes.status).toBe(200)
    expect(updateMemory).toHaveBeenCalledWith('agent-1', 'new memory')
  })

  test('GET log list and single day log content', async () => {
    const app = createMemoryRoutes(
      {
        getMemory: () => '',
        updateMemory: () => {},
        getDailyLogDates: () => ['2026-03-10', '2026-03-09'],
        getDailyLog: (_id: string, date: string) => `log for ${date}`,
      } as any,
      { getAgent: () => ({ config: { id: 'agent-1' } }) } as any,
    )

    const listRes = await app.request('/agents/agent-1/memory/logs')
    const logRes = await app.request('/agents/agent-1/memory/logs/2026-03-10')

    expect(await listRes.json()).toEqual(['2026-03-10', '2026-03-09'])
    expect(await logRes.json()).toEqual({ content: 'log for 2026-03-10' })
  })
})
