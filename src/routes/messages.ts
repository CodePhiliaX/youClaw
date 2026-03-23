import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { z } from 'zod/v4'
import { getMessages, getChats, deleteChat, updateChatFields } from '../db/index.ts'
import type { AgentManager, AgentQueue } from '../agent/index.ts'
import { abortRegistry } from '../agent/abort-registry.ts'
import type { MessageRouter } from '../channel/index.ts'
import type { InboundMessage } from '../channel/index.ts'
import { getPaths } from '../config/paths.ts'
import { MAX_FILES } from '../types/attachment.ts'

const ATTACHMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

function sanitizeFilename(filename: string): string {
  const safe = basename(filename)
    .replace(/[\/\\]/g, '_')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
  return safe || 'attachment'
}

function buildAttachmentFilename(filename: string, mediaType: string): string {
  const safeName = sanitizeFilename(filename)
  if (extname(safeName)) {
    return safeName
  }

  const extension = MIME_TO_EXTENSION[mediaType]
  if (!extension) {
    return mediaType.startsWith('image/') ? 'pasted-image' : safeName
  }

  const baseName = safeName === 'attachment' && mediaType.startsWith('image/')
    ? 'pasted-image'
    : safeName
  return `${baseName}.${extension}`
}

export function createMessagesRoutes(agentManager: AgentManager, agentQueue: AgentQueue, router: MessageRouter) {
  const messages = new Hono()

  messages.post('/attachments/upload', async (c) => {
    const formData = await c.req.formData()
    const rawFile = formData.get('file')
    if (!(rawFile instanceof File)) {
      return c.json({ error: 'File is required' }, 400)
    }
    if (rawFile.size > ATTACHMENT_UPLOAD_MAX_BYTES) {
      return c.json({ error: 'File exceeds the 10MB limit' }, 400)
    }

    const requestedFilename = formData.get('filename')
    const requestedMediaType = formData.get('mediaType')
    const mediaType = rawFile.type || (typeof requestedMediaType === 'string' ? requestedMediaType : '') || 'application/octet-stream'
    const filename = buildAttachmentFilename(
      typeof requestedFilename === 'string' && requestedFilename.trim()
        ? requestedFilename
        : rawFile.name,
      mediaType,
    )

    const dir = resolve(getPaths().data, 'attachments')
    mkdirSync(dir, { recursive: true })

    const filePath = resolve(dir, `${Date.now()}-${randomUUID()}-${filename}`)
    await Bun.write(filePath, rawFile)

    return c.json({ filename, mediaType, filePath })
  })

  // POST /api/agents/:id/message — send a message to an agent
  messages.post('/agents/:id/message', async (c) => {
    const agentId = c.req.param('id')

    const AttachmentSchema = z.object({
      filename: z.string(),
      mediaType: z.string(),
      filePath: z.string(),
    })
    const BodySchema = z.object({
      prompt: z.string(),
      chatId: z.string().optional(),
      messageId: z.string().optional(),
      skills: z.array(z.string()).optional(),
      browserProfileId: z.string().optional(),
      attachments: z.array(AttachmentSchema).max(MAX_FILES).optional(),
    })

    const parseResult = BodySchema.safeParse(await c.req.json())
    if (!parseResult.success) {
      return c.json({ error: 'Invalid request', details: parseResult.error.issues }, 400)
    }
    const body = parseResult.data

    if (!body.prompt && (!body.attachments || body.attachments.length === 0)) {
      return c.json({ error: 'Either prompt or attachments must be provided' }, 400)
    }

    const managed = agentManager.getAgent(agentId)
    if (!managed) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const chatId = body.chatId ?? `web:${randomUUID()}`
    const messageId = body.messageId ?? randomUUID()

    const inbound: InboundMessage = {
      id: messageId,
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

  // POST /api/chats/:chatId/abort — abort a running query
  messages.post('/chats/:chatId/abort', (c) => {
    const chatId = c.req.param('chatId')
    const aborted = abortRegistry.abort(chatId)
    return c.json({ ok: true, aborted })
  })

  // DELETE /api/chats/:chatId — delete a conversation and its messages
  messages.delete('/chats/:chatId', (c) => {
    const chatId = c.req.param('chatId')
    deleteChat(chatId)
    return c.json({ ok: true })
  })

  return messages
}
