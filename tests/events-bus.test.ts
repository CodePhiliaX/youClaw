import { describe, test, expect, mock } from 'bun:test'
import { EventBus } from '../src/events/bus.ts'

describe('EventBus', () => {
  test('filters events by type, agentId, and chatId', () => {
    const bus = new EventBus()
    const handler = mock(() => {})

    bus.subscribe({ types: ['complete'], agentId: 'agent-1', chatId: 'chat-1' }, handler)

    bus.emit({ type: 'complete', agentId: 'agent-1', chatId: 'chat-1', fullText: 'ok', sessionId: 's1' })
    bus.emit({ type: 'complete', agentId: 'agent-1', chatId: 'chat-2', fullText: 'skip', sessionId: 's2' })
    bus.emit({ type: 'stream', agentId: 'agent-1', chatId: 'chat-1', text: 'skip' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe removes the subscriber', () => {
    const bus = new EventBus()
    const handler = mock(() => {})

    const unsubscribe = bus.subscribe({}, handler)
    expect(bus.subscriberCount).toBe(1)

    unsubscribe()
    expect(bus.subscriberCount).toBe(0)

    bus.emit({ type: 'processing', agentId: 'agent-1', chatId: 'chat-1', isProcessing: true })
    expect(handler).toHaveBeenCalledTimes(0)
  })

  test('a single subscriber throwing does not affect other subscribers', () => {
    const bus = new EventBus()
    const badHandler = mock(() => {
      throw new Error('boom')
    })
    const goodHandler = mock(() => {})

    bus.subscribe({}, badHandler)
    bus.subscribe({}, goodHandler)

    bus.emit({ type: 'error', agentId: 'agent-1', chatId: 'chat-1', error: 'failed' })

    expect(badHandler).toHaveBeenCalledTimes(1)
    expect(goodHandler).toHaveBeenCalledTimes(1)
  })
})
