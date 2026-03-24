import { describe, expect, test } from 'bun:test'
import './setup.ts'
import { abortRegistry } from '../src/agent/abort-registry.ts'

describe('abort registry', () => {
  test('abort only signals the controller and does not force-close the query', () => {
    const controller = new AbortController()
    let closeCalled = false

    abortRegistry.register('chat-abort', controller)
    abortRegistry.setQuery('chat-abort', {
      [Symbol.asyncIterator]() {
        return this
      },
      next: async () => ({ done: true, value: undefined }),
      close: () => {
        closeCalled = true
      },
    })

    const aborted = abortRegistry.abort('chat-abort')

    expect(aborted).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(closeCalled).toBe(false)
    expect(abortRegistry.has('chat-abort')).toBe(false)
  })
})
