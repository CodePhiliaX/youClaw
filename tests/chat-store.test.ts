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
    expect(chat?.timelineItems).toHaveLength(1)
    expect(chat?.timelineItems[0]).toMatchObject({
      kind: 'document_status',
      documentKey: 'report.pdf:pending',
      filename: 'report.pdf',
      status: 'parsing',
    })

    useChatStore.getState().setDocumentStatus('chat-1', 'doc_123', 'report.pdf', 'parsed')
    chat = useChatStore.getState().chats['chat-1']
    expect(chat?.documentStatuses['report.pdf:pending']).toBeUndefined()
    expect(chat?.documentStatuses['doc_123']).toEqual({
      filename: 'report.pdf',
      status: 'parsed',
      error: undefined,
    })
    expect(chat?.timelineItems).toHaveLength(1)
    expect(chat?.timelineItems[0]).toMatchObject({
      kind: 'document_status',
      documentKey: 'doc_123',
      filename: 'report.pdf',
      status: 'parsed',
    })
  })

  test('preserves live tool and assistant output order in timeline', () => {
    const store = useChatStore.getState()
    store.initChat('chat-1')

    store.addUserMessage('chat-1', {
      id: 'user-1',
      role: 'user',
      content: 'Summarize this file',
      timestamp: '2026-03-19T10:00:00.000Z',
    })
    store.addToolUse('chat-1', {
      id: 'tool-1',
      name: 'Read',
      input: '{"file_path":"/tmp/a.txt"}',
      status: 'running',
    })
    store.appendStreamText('chat-1', 'First answer part.')
    store.addToolUse('chat-1', {
      id: 'tool-2',
      name: 'Grep',
      input: '{"pattern":"revenue"}',
      status: 'running',
    })
    store.appendStreamText('chat-1', 'Second answer part.')

    const chat = useChatStore.getState().chats['chat-1']
    expect(chat?.timelineItems.map((item) => item.kind)).toEqual([
      'message',
      'tool_use',
      'assistant_stream',
      'tool_use',
      'assistant_stream',
    ])

    expect(chat?.timelineItems[1]).toMatchObject({
      kind: 'tool_use',
      name: 'Read',
      status: 'done',
    })
    expect(chat?.timelineItems[2]).toMatchObject({
      kind: 'assistant_stream',
      content: 'First answer part.',
    })
    expect(chat?.timelineItems[3]).toMatchObject({
      kind: 'tool_use',
      name: 'Grep',
      status: 'done',
    })
    expect(chat?.timelineItems[4]).toMatchObject({
      kind: 'assistant_stream',
      content: 'Second answer part.',
    })
  })
})
