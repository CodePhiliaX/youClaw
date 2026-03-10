import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { getMessages, getChats, deleteChat } from '../db/index.ts'
import type { AgentManager, AgentQueue } from '../agent/index.ts'
import type { MessageRouter } from '../channel/index.ts'
import type { InboundMessage } from '../channel/index.ts'

export function createMessagesRoutes(agentManager: AgentManager, agentQueue: AgentQueue, router: MessageRouter) {
  const messages = new Hono()

  // POST /api/agents/:id/message — 发消息给 agent
  messages.post('/agents/:id/message', async (c) => {
    const agentId = c.req.param('id')
    const body = await c.req.json<{ prompt: string; chatId?: string }>()

    if (!body.prompt) {
      return c.json({ error: 'prompt is required' }, 400)
    }

    // 验证 agent 存在
    const managed = agentManager.getAgent(agentId)
    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // 如果没有 chatId，创建一个新的 web chat
    const chatId = body.chatId ?? `web:${randomUUID()}`

    // 构建 InboundMessage，通过 router 统一处理
    const inbound: InboundMessage = {
      id: randomUUID(),
      chatId,
      sender: 'user',
      senderName: 'User',
      content: body.prompt,
      timestamp: new Date().toISOString(),
      isGroup: false,
    }

    // 后台处理（不阻塞请求）
    router.handleInbound(inbound)

    // 立即返回 chatId，前端通过 SSE 获取流式回复
    return c.json({ chatId, status: 'processing' })
  })

  // GET /api/chats — 所有对话列表
  messages.get('/chats', (c) => {
    return c.json(getChats())
  })

  // GET /api/chats/:chatId/messages — 消息历史
  messages.get('/chats/:chatId/messages', (c) => {
    const chatId = c.req.param('chatId')
    const limit = Number(c.req.query('limit') ?? '50')
    const before = c.req.query('before')

    const msgs = getMessages(chatId, limit, before ?? undefined)
    // 返回时按时间正序
    return c.json(msgs.reverse())
  })

  // DELETE /api/chats/:chatId — 删除对话及其消息
  messages.delete('/chats/:chatId', (c) => {
    const chatId = c.req.param('chatId')
    deleteChat(chatId)
    return c.json({ ok: true })
  })

  return messages
}
