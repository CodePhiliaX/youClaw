import { Hono } from 'hono'
import type { MemoryManager } from '../memory/index.ts'
import type { MemoryIndexer } from '../memory/index.ts'
import type { AgentManager } from '../agent/index.ts'

export function createMemoryRoutes(memoryManager: MemoryManager, agentManager: AgentManager, memoryIndexer: MemoryIndexer | null) {
  const memory = new Hono()

  // ===== Global Memory =====

  // GET /api/memory/global — global MEMORY.md content
  memory.get('/memory/global', (c) => {
    const content = memoryManager.getGlobalMemory()
    return c.json({ content })
  })

  // PUT /api/memory/global — update global MEMORY.md
  memory.put('/memory/global', async (c) => {
    const body = await c.req.json<{ content: string }>()
    memoryManager.updateGlobalMemory(body.content)
    return c.json({ ok: true })
  })

  // ===== Memory Search =====

  // GET /api/memory/search?q=xxx&agentId=xxx&fileType=xxx — full-text search
  memory.get('/memory/search', (c) => {
    if (!memoryIndexer) {
      return c.json({ error: 'Memory indexer not available' }, 503)
    }

    const q = c.req.query('q')
    if (!q) {
      return c.json({ error: 'Missing query parameter: q' }, 400)
    }

    const results = memoryIndexer.search(q, {
      agentId: c.req.query('agentId'),
      fileType: c.req.query('fileType'),
      limit: Number(c.req.query('limit')) || 20,
    })

    return c.json(results)
  })

  // ===== Agent Memory =====

  // GET /api/agents/:id/memory — MEMORY.md content
  memory.get('/agents/:id/memory', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = memoryManager.getMemory(id)
    return c.json({ content })
  })

  // PUT /api/agents/:id/memory — edit MEMORY.md
  memory.put('/agents/:id/memory', async (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const body = await c.req.json<{ content: string }>()
    memoryManager.updateMemory(id, body.content)
    return c.json({ ok: true })
  })

  // GET /api/agents/:id/memory/logs — daily log list
  memory.get('/agents/:id/memory/logs', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const dates = memoryManager.getDailyLogDates(id)
    return c.json(dates)
  })

  // GET /api/agents/:id/memory/logs/:date — log for a specific date
  memory.get('/agents/:id/memory/logs/:date', (c) => {
    const id = c.req.param('id')
    const date = c.req.param('date')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = memoryManager.getDailyLog(id, date)
    return c.json({ content })
  })

  // ===== Conversation Archives =====

  // GET /api/agents/:id/memory/conversations — list archived conversations
  memory.get('/agents/:id/memory/conversations', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const chatId = c.req.query('chatId')
    const conversations = memoryManager.getArchivedConversations(id, chatId)
    return c.json(conversations)
  })

  // GET /api/agents/:id/memory/conversations/:chatId/:sessionId — get archived conversation content
  memory.get('/agents/:id/memory/conversations/:chatId/:sessionId', (c) => {
    const id = c.req.param('id')
    const chatId = c.req.param('chatId')
    const sessionId = c.req.param('sessionId')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = memoryManager.getArchivedConversation(id, chatId, sessionId)
    if (!content) {
      return c.json({ error: 'Archived conversation not found' }, 404)
    }

    return c.json({ content })
  })

  // ===== Snapshots =====

  // POST /api/agents/:id/memory/snapshot — create a snapshot
  memory.post('/agents/:id/memory/snapshot', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    memoryManager.saveSnapshot(id)
    return c.json({ ok: true })
  })

  // GET /api/agents/:id/memory/snapshot — get snapshot
  memory.get('/agents/:id/memory/snapshot', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = memoryManager.getSnapshot(id)
    return c.json({ content })
  })

  return memory
}
