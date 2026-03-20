import { beforeEach, describe, expect, test } from 'bun:test'
import { useChatStore } from '../web/src/stores/chat'

describe('chat store completion flow', () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: {},
      activeChatId: null,
    })
  })

  test('completeMessage keeps the chat processing until processing=false arrives', () => {
    const store = useChatStore.getState()

    store.initChat('chat-1')
    store.setProcessing('chat-1', true)
    store.completeMessage('chat-1', 'first reply', [])

    const chat = useChatStore.getState().chats['chat-1']
    expect(chat).toBeDefined()
    expect(chat?.messages).toHaveLength(1)
    expect(chat?.messages[0]?.content).toBe('first reply')
    expect(chat?.isProcessing).toBe(true)
    expect(chat?.chatStatus).toBe('submitted')

    useChatStore.getState().setProcessing('chat-1', false)

    const completed = useChatStore.getState().chats['chat-1']
    expect(completed?.isProcessing).toBe(false)
    expect(completed?.chatStatus).toBe('ready')
  })
})
