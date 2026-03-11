import { Hono } from 'hono'
import type { MemoryManager } from '../memory/index.ts'
import type { AgentManager } from '../agent/index.ts'

export function createMemoryRoutes(memoryManager: MemoryManager, agentManager: AgentManager) {
  const memory = new Hono()

  // GET /api/agents/:id/memory — MEMORY.md 内容
  memory.get('/agents/:id/memory', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const content = memoryManager.getMemory(id)
    return c.json({ content })
  })

  // PUT /api/agents/:id/memory — 编辑 MEMORY.md
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

  // GET /api/agents/:id/memory/logs — 每日日志列表
  memory.get('/agents/:id/memory/logs', (c) => {
    const id = c.req.param('id')
    const managed = agentManager.getAgent(id)

    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const dates = memoryManager.getDailyLogDates(id)
    return c.json(dates)
  })

  // GET /api/agents/:id/memory/logs/:date — 某天的日志
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

  // GET /api/agents/:id/memory/conversations — 归档会话列表
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

  // GET /api/agents/:id/memory/conversations/:chatId/:sessionId — 获取归档会话内容
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
      return c.json({ error: '归档会话不存在' }, 404)
    }

    return c.json({ content })
  })

  return memory
}
