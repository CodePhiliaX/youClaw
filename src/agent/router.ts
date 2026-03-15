import { getLogger } from '../logger/index.ts'
import type { Binding } from './schema.ts'
import type { AgentInstance } from './types.ts'

/**
 * Route context: metadata describing an inbound message
 */
export interface RouteContext {
  channel: string        // "telegram" | "web" | "api"
  chatId: string
  sender?: string
  isGroup?: boolean
  content?: string       // Used for trigger matching
  tags?: string[]        // Tags passed from web frontend
}

/**
 * Route table entry (for API visualization)
 */
export interface RouteTableEntry {
  agentId: string
  agentName: string
  binding: Binding
}

/**
 * AgentRouter: binding-based message routing system
 *
 * Matching priority rules:
 * 1. chatIds exact match (highest weight)
 * 2. condition match (trigger + isGroup + sender)
 * 3. tags match
 * 4. channel match
 * 5. "*" wildcard (lowest weight)
 * 6. Same weight sorted by priority descending
 */
export class AgentRouter {
  private routeTable: Array<{ agentId: string; binding: Binding; agent: AgentInstance }> = []
  private defaultAgent: AgentInstance | undefined

  /**
   * Build route table from all agents' bindings (sorted by priority descending)
   */
  buildRouteTable(agents: Map<string, AgentInstance>): void {
    const logger = getLogger()
    this.routeTable = []
    this.defaultAgent = undefined

    for (const [agentId, agent] of agents) {
      const bindings = agent.config.bindings
      if (!bindings || bindings.length === 0) {
        // Agents without bindings do not participate in routing (except default)
        if (agentId === 'default') {
          this.defaultAgent = agent
        }
        continue
      }

      for (const binding of bindings) {
        this.routeTable.push({ agentId, binding, agent })
      }
    }

    // Sort by priority descending
    this.routeTable.sort((a, b) => (b.binding.priority ?? 0) - (a.binding.priority ?? 0))

    // If default agent not found in bindings, look in agents map
    if (!this.defaultAgent) {
      this.defaultAgent = agents.get('default')
      if (!this.defaultAgent) {
        const first = agents.values().next()
        this.defaultAgent = first.done ? undefined : first.value
      }
    }

    logger.info({ routeCount: this.routeTable.length }, 'Route table built')
  }

  /**
   * Route decision: return the best matching agent
   */
  resolve(ctx: RouteContext): AgentInstance | undefined {
    let bestMatch: { agent: AgentInstance; score: number } | undefined

    for (const entry of this.routeTable) {
      const score = this.calculateScore(entry.binding, ctx)
      if (score < 0) continue // No match

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { agent: entry.agent, score }
      }
    }

    return bestMatch?.agent ?? this.defaultAgent
  }

  /**
   * Return full route table (for API visualization)
   */
  getRouteTable(): RouteTableEntry[] {
    return this.routeTable.map(({ agentId, binding, agent }) => ({
      agentId,
      agentName: agent.config.name,
      binding,
    }))
  }

  /**
   * Calculate match score between a route entry and context
   * Returns -1 for no match, otherwise a score (higher is better)
   */
  private calculateScore(binding: Binding, ctx: RouteContext): number {
    let score = binding.priority ?? 0

    // Channel match
    if (binding.channel !== '*' && binding.channel !== ctx.channel) {
      return -1 // Channel mismatch
    }

    // chatIds exact match (highest weight)
    if (binding.chatIds && binding.chatIds.length > 0) {
      if (binding.chatIds.includes(ctx.chatId)) {
        score += 10000
      } else {
        return -1 // chatIds constraint present but not matched
      }
    }

    // Condition match
    if (binding.condition) {
      const cond = binding.condition

      // isGroup match
      if (cond.isGroup !== undefined && cond.isGroup !== ctx.isGroup) {
        return -1
      }

      // sender match
      if (cond.sender && cond.sender !== ctx.sender) {
        return -1
      }

      // trigger regex match
      if (cond.trigger && ctx.content) {
        try {
          const regex = new RegExp(cond.trigger, 'i')
          if (regex.test(ctx.content)) {
            score += 1000
          } else {
            return -1
          }
        } catch {
          return -1 // Invalid regex
        }
      } else if (cond.trigger && !ctx.content) {
        return -1
      }

      score += 500 // Has conditions and all matched
    }

    // Tags match
    if (binding.tags && binding.tags.length > 0 && ctx.tags) {
      const matched = binding.tags.some((tag) => ctx.tags!.includes(tag))
      if (matched) {
        score += 100
      } else {
        return -1 // Tags constraint present but not matched
      }
    } else if (binding.tags && binding.tags.length > 0 && !ctx.tags) {
      return -1 // Tags constraint present but context has no tags
    }

    // Wildcard channel gets lowest score
    if (binding.channel === '*') {
      score -= 1
    }

    return score
  }
}
