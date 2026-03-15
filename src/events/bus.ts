import type { AgentEvent, EventFilter, EventHandler, Unsubscribe } from './types.ts'

interface Subscriber {
  filter: EventFilter
  handler: EventHandler
}

// Global event bus, decoupling Agent execution from multi-channel output
export class EventBus {
  private subscribers: Set<Subscriber> = new Set()

  subscribe(filter: EventFilter, handler: EventHandler): Unsubscribe {
    const subscriber: Subscriber = { filter, handler }
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  emit(event: AgentEvent): void {
    for (const sub of this.subscribers) {
      if (this.matches(event, sub.filter)) {
        try {
          sub.handler(event)
        } catch {
          // Subscriber errors should not affect other subscribers
        }
      }
    }
  }

  private matches(event: AgentEvent, filter: EventFilter): boolean {
    if (filter.chatId && 'chatId' in event && event.chatId !== filter.chatId) {
      return false
    }
    if (filter.agentId && 'agentId' in event && event.agentId !== filter.agentId) {
      return false
    }
    if (filter.types && !filter.types.includes(event.type)) {
      return false
    }
    return true
  }

  // Current subscriber count (for debugging)
  get subscriberCount(): number {
    return this.subscribers.size
  }
}
