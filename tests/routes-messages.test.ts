import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { cleanTables } from './setup.ts'
import {
  getChats,
  getMessages,
  saveMessage,
  upsertChat,
} from '../src/db/index.ts'
import { createMessagesRoutes } from '../src/routes/messages.ts'

describe('messages routes', () => {
  beforeEach(() => cleanTables('messages', 'chats'))

  test('POST /agents/:id/message returns 400 when prompt is missing', async () => {
    const app = createMessagesRoutes(
      { getAgent: () => ({ id: 'agent-1' }) } as any,
      {} as any,
      { handleInbound: mock(() => Promise.resolve()) } as any,
    )

    const res = await app.request('/agents/agent-1/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(400)
  })

  test('POST /agents/:id/message returns 404 when agent does not exist', async () => {
    const app = createMessagesRoutes(
      { getAgent: () => undefined } as any,
      {} as any,
      { handleInbound: mock(() => Promise.resolve()) } as any,
    )

    const res = await app.request('/agents/missing/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })

    expect(res.status).toBe(404)
  })

  test('POST /agents/:id/message returns processing and forwards to router', async () => {
    const handleInbound = mock(() => Promise.resolve())
    const app = createMessagesRoutes(
      { getAgent: () => ({ id: 'agent-1' }) } as any,
      {} as any,
      { handleInbound } as any,
    )

    const res = await app.request('/agents/agent-1/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello', chatId: 'web:chat-1', skills: ['pdf'] }),
    })

    const body = await res.json() as { chatId: string; status: string }
    expect(res.status).toBe(200)
    expect(body).toEqual({ chatId: 'web:chat-1', status: 'processing' })
    expect(handleInbound).toHaveBeenCalledTimes(1)
    expect(handleInbound.mock.calls[0]?.[0]?.chatId).toBe('web:chat-1')
    expect(handleInbound.mock.calls[0]?.[0]?.requestedSkills).toEqual(['pdf'])
  })

  test('POST /agents/:id/message preserves client messageId when provided', async () => {
    const handleInbound = mock(() => Promise.resolve())
    const app = createMessagesRoutes(
      { getAgent: () => ({ id: 'agent-1' }) } as any,
      {} as any,
      { handleInbound } as any,
    )

    const res = await app.request('/agents/agent-1/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello', chatId: 'web:chat-1', messageId: 'client-msg-1' }),
    })

    expect(res.status).toBe(200)
    expect(handleInbound).toHaveBeenCalledTimes(1)
    expect(handleInbound.mock.calls[0]?.[0]?.id).toBe('client-msg-1')
  })

  test('GET /chats/:chatId/messages returns in chronological order', async () => {
    saveMessage({
      id: 'm1',
      chatId: 'chat-1',
      sender: 'user',
      senderName: 'User',
      content: 'old',
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })
    saveMessage({
      id: 'm2',
      chatId: 'chat-1',
      sender: 'assistant',
      senderName: 'Agent',
      content: 'new',
      timestamp: '2026-03-10T11:00:00.000Z',
      isFromMe: true,
      isBotMessage: true,
    })

    const app = createMessagesRoutes(
      { getAgent: () => ({ id: 'agent-1' }) } as any,
      {} as any,
      { handleInbound: mock(() => Promise.resolve()) } as any,
    )

    const res = await app.request('/chats/chat-1/messages')
    const body = await res.json() as Array<{ content: string }>

    expect(body.map((message) => message.content)).toEqual(['old', 'new'])
  })

  test('DELETE /chats/:chatId deletes chat and its messages', async () => {
    upsertChat('chat-1', 'agent-1', 'Chat 1')
    saveMessage({
      id: 'm1',
      chatId: 'chat-1',
      sender: 'user',
      senderName: 'User',
      content: 'bye',
      timestamp: '2026-03-10T10:00:00.000Z',
      isFromMe: false,
      isBotMessage: false,
    })

    const app = createMessagesRoutes(
      { getAgent: () => ({ id: 'agent-1' }) } as any,
      {} as any,
      { handleInbound: mock(() => Promise.resolve()) } as any,
    )

    const res = await app.request('/chats/chat-1', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(getChats()).toEqual([])
    expect(getMessages('chat-1', 10)).toEqual([])
  })
})
