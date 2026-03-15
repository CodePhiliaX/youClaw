import { getLogger } from '../logger/index.ts'

export interface SubagentInfo {
  taskId: string
  agentId: string
  description: string
  status: 'running' | 'completed' | 'failed'
  summary?: string
  startedAt: string
  completedAt?: string
}

/**
 * Track sub-agent lifecycle
 * Record active and recently completed sub-agent tasks
 */
export class SubagentTracker {
  private active: Map<string, SubagentInfo> = new Map()    // taskId -> info
  private recent: SubagentInfo[] = []                       // Recently completed tasks
  private maxRecent: number = 50

  /**
   * Record sub-agent start
   */
  track(agentId: string, taskId: string, description: string): void {
    const info: SubagentInfo = {
      taskId,
      agentId,
      description,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    this.active.set(taskId, info)
    getLogger().debug({ agentId, taskId, description }, 'Sub-agent started')
  }

  /**
   * Update sub-agent progress
   */
  updateProgress(taskId: string, summary?: string): void {
    const info = this.active.get(taskId)
    if (info) {
      info.summary = summary
      getLogger().debug({ taskId, summary }, 'Sub-agent progress updated')
    }
  }

  /**
   * Mark sub-agent completed
   */
  complete(taskId: string, status: 'completed' | 'failed', summary: string): void {
    const info = this.active.get(taskId)
    if (info) {
      info.status = status
      info.summary = summary
      info.completedAt = new Date().toISOString()

      this.active.delete(taskId)
      this.recent.unshift(info)

      // Limit recent record count
      if (this.recent.length > this.maxRecent) {
        this.recent = this.recent.slice(0, this.maxRecent)
      }

      getLogger().debug({ taskId, status, summary }, 'Sub-agent completed')
    }
  }

  /**
   * Get active sub-agent list
   */
  getActive(agentId?: string): SubagentInfo[] {
    const all = Array.from(this.active.values())
    if (agentId) {
      return all.filter((info) => info.agentId === agentId)
    }
    return all
  }

  /**
   * Get recently completed sub-agent list
   */
  getRecent(agentId?: string, limit: number = 10): SubagentInfo[] {
    let results = this.recent
    if (agentId) {
      results = results.filter((info) => info.agentId === agentId)
    }
    return results.slice(0, limit)
  }
}
