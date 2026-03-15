import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { bodyLimit } from 'hono/body-limit'
import { getMessages, getChats, deleteChat, updateChatFields } from '../db/index.ts'
import type { AgentManager, AgentQueue } from '../agent/index.ts'
import type { MessageRouter } from '../channel/index.ts'
import type { InboundMessage } from '../channel/index.ts'
import { ALLOWED_MEDIA_TYPES, MAX_FILE_SIZE, MAX_FILES } from '../types/attachment.ts'

export function createMessagesRoutes(agentManager: AgentManager, agentQueue: AgentQueue, router: MessageRouter) {
  const messages = new Hono()

  // POST /api/agents/:id/message — send a message to an agent
  messages.post('/agents/:id/message', bodyLimit({ maxSize: 75 * 1024 * 1024 }), async (c) => {
    const agentId = c.req.param('id')

    const AttachmentSchema = z.object({
      filename: z.string(),
      mediaType: z.enum(ALLOWED_MEDIA_TYPES),
      data: z.string(),
      size: z.number().max(MAX_FILE_SIZE),
    })
    const BodySchema = z.object({
      prompt: z.string().min(1),
      chatId: z.string().optional(),
      skills: z.array(z.string()).optional(),
      browserProfileId: z.string().optional(),
      attachments: z.array(AttachmentSchema).max(MAX_FILES).optional(),
    })

    const parseResult = BodySchema.safeParse(await c.req.json())
    if (!parseResult.success) {
      return c.json({ error: 'Invalid request', details: parseResult.error.issues }, 400)
    }
    const body = parseResult.data

    const managed = agentManager.getAgent(agentId)
    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const chatId = body.chatId ?? `web:${randomUUID()}`

    const inbound: InboundMessage = {
      id: randomUUID(),
      chatId,
      sender: 'user',
      senderName: 'User',
      content: body.prompt,
      timestamp: new Date().toISOString(),
      isGroup: false,
      agentId,
      requestedSkills: body.skills,
      browserProfileId: body.browserProfileId,
      attachments: body.attachments,
    }

    router.handleInbound(inbound)
    return c.json({ chatId, status: 'processing' })
  })

  // GET /api/chats — list all conversations
  messages.get('/chats', (c) => {
    return c.json(getChats())
  })

  // GET /api/chats/:chatId/messages — message history
  messages.get('/chats/:chatId/messages', (c) => {
    const chatId = c.req.param('chatId')
    const limit = Number(c.req.query('limit') ?? '50')
    const before = c.req.query('before')

    const msgs = getMessages(chatId, limit, before ?? undefined)
    const parsed = msgs.map(m => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : null,
    }))
    return c.json(parsed.reverse())
  })

  // PATCH /api/chats/:chatId — update conversation avatar/title
  messages.patch('/chats/:chatId', async (c) => {
    const chatId = c.req.param('chatId')
    const body = await c.req.json<{ name?: string; avatar?: string }>()
    updateChatFields(chatId, body)
    return c.json({ ok: true })
  })

  // DELETE /api/chats/:chatId — delete a conversation and its messages
  messages.delete('/chats/:chatId', (c) => {
    const chatId = c.req.param('chatId')
    deleteChat(chatId)
    return c.json({ ok: true })
  })

  return messages
}
