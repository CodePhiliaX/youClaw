import { afterEach, describe, expect, test } from 'bun:test'
import { useChatStore } from '../web/src/stores/chat.ts'

afterEach(() => {
  useChatStore.setState({ chats: {}, activeChatId: null })
})

describe('chat store document status', () => {
  test('tracks parsing and replaces pending entry with final document status', () => {
    const store = useChatStore.getState()
    store.initChat('chat-1')

    useChatStore.getState().setDocumentStatus('chat-1', 'pending', 'report.pdf', 'parsing')
    let chat = useChatStore.getState().chats['chat-1']
    expect(chat?.documentStatuses['report.pdf:pending']?.status).toBe('parsing')

    useChatStore.getState().setDocumentStatus('chat-1', 'doc_123', 'report.pdf', 'parsed')
    chat = useChatStore.getState().chats['chat-1']
    expect(chat?.documentStatuses['report.pdf:pending']).toBeUndefined()
    expect(chat?.documentStatuses['doc_123']).toEqual({
      filename: 'report.pdf',
      status: 'parsed',
      error: undefined,
    })
  })
})
