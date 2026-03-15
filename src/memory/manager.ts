import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

const GLOBAL_AGENT_ID = '_global'

export interface MemoryContextOptions {
  recentDays?: number
  maxContextChars?: number
}

export interface ArchivedConversation {
  sessionId: string
  date: string
  size: number
}

export class MemoryManager {
  private getAgentMemoryDir(agentId: string): string {
    const agentsDir = getPaths().agents
    return resolve(agentsDir, agentId, 'memory')
  }

  private getMemoryFilePath(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'MEMORY.md')
  }

  private getSnapshotFilePath(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
  }

  private getLogsDir(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'logs')
  }

  private getConversationsDir(agentId: string, chatId?: string): string {
    const base = resolve(this.getAgentMemoryDir(agentId), 'conversations')
    if (chatId) {
      return resolve(base, chatId.replace(/[:/]/g, '_'))
    }
    return base
  }

  private ensureMemoryDir(agentId: string): void {
    const memoryDir = this.getAgentMemoryDir(agentId)
    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
    }
  }

  private ensureLogsDir(agentId: string): void {
    const logsDir = this.getLogsDir(agentId)
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }
  }

  private ensureConversationsDir(agentId: string): void {
    const dir = this.getConversationsDir(agentId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // ===== Global Memory =====

  /**
   * Get global MEMORY.md content
   */
  getGlobalMemory(): string {
    return this.getMemory(GLOBAL_AGENT_ID)
  }

  /**
   * Update global MEMORY.md
   */
  updateGlobalMemory(content: string): void {
    this.updateMemory(GLOBAL_AGENT_ID, content)
  }

  // ===== Agent Memory =====

  /**
   * Get agent MEMORY.md content
   */
  getMemory(agentId: string): string {
    const filePath = this.getMemoryFilePath(agentId)

    if (!existsSync(filePath)) {
      return ''
    }

    return readFileSync(filePath, 'utf-8')
  }

  /**
   * Update agent MEMORY.md
   */
  updateMemory(agentId: string, content: string): void {
    this.ensureMemoryDir(agentId)
    const filePath = this.getMemoryFilePath(agentId)
    writeFileSync(filePath, content, 'utf-8')
    getLogger().info({ agentId }, 'MEMORY.md updated')
  }

  /**
   * Truncate text to specified length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + `... *(${text.length} chars total)*`
  }

  /**
   * Append daily log (with truncation support)
   */
  appendDailyLog(agentId: string, chatId: string, userMessage: string, botReply: string, maxLogEntryLength?: number): void {
    this.ensureLogsDir(agentId)

    const maxLen = maxLogEntryLength ?? 500
    const truncatedUser = this.truncate(userMessage, Math.min(maxLen, 300))
    const truncatedReply = this.truncate(botReply, maxLen)

    const now = new Date()
    const date = now.toISOString().split('T')[0]!
    const time = now.toTimeString().slice(0, 5)
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    const entry = `\n## ${time} [${chatId}]\n**User**: ${truncatedUser}\n**Assistant**: ${truncatedReply}\n`

    let existing = ''
    if (existsSync(logPath)) {
      existing = readFileSync(logPath, 'utf-8')
    } else {
      existing = `# ${date}\n`
    }

    writeFileSync(logPath, existing + entry, 'utf-8')
    getLogger().debug({ agentId, date }, 'daily log appended')
  }

  /**
   * Get daily log list (returns date array, descending order)
   */
  getDailyLogDates(agentId: string): string[] {
    const logsDir = this.getLogsDir(agentId)

    if (!existsSync(logsDir)) {
      return []
    }

    const files = readdirSync(logsDir)
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace('.md', ''))
      .sort((a, b) => b.localeCompare(a))
  }

  /**
   * Get log content for a specific date
   */
  getDailyLog(agentId: string, date: string): string {
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    if (!existsSync(logPath)) {
      return ''
    }

    return readFileSync(logPath, 'utf-8')
  }

  /**
   * Prune expired log files
   */
  pruneOldLogs(agentId: string, retainDays: number = 30): number {
    const logsDir = this.getLogsDir(agentId)
    if (!existsSync(logsDir)) return 0

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retainDays)
    const cutoffStr = cutoff.toISOString().split('T')[0]!

    const files = readdirSync(logsDir).filter((f) => f.endsWith('.md'))
    let deleted = 0
    for (const file of files) {
      const date = file.replace('.md', '')
      if (date < cutoffStr) {
        unlinkSync(resolve(logsDir, file))
        deleted++
      }
    }

    if (deleted > 0) {
      getLogger().info({ agentId, deleted, retainDays }, 'old logs pruned')
    }
    return deleted
  }

  /**
   * Get memory context (injected into system prompt)
   * Supports configurable day count and character limit
   */
  getMemoryContext(agentId: string, options?: MemoryContextOptions): string {
    const recentDays = options?.recentDays ?? 3
    const maxContextChars = options?.maxContextChars ?? 10000

    const globalMemory = this.getGlobalMemory()
    const longTermMemory = this.getMemory(agentId)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, recentDays)

    let recentLogs = ''
    let totalChars = longTermMemory.length

    for (const date of recentDates) {
      const log = this.getDailyLog(agentId, date)
      if (log) {
        // Check if character limit exceeded
        if (totalChars + log.length > maxContextChars) {
          // Truncate the last log segment
          const remaining = maxContextChars - totalChars
          if (remaining > 100) {
            recentLogs += log.slice(0, remaining) + '\n...[logs truncated]\n'
          }
          break
        }
        totalChars += log.length
        recentLogs += log + '\n'
      }
    }

    const parts: string[] = ['<memory>']

    if (globalMemory) {
      parts.push(`<global_memory>\n${globalMemory}\n</global_memory>`)
    }

    parts.push(`<long_term>\n${longTermMemory}\n</long_term>`)
    parts.push(`<recent_logs>\n${recentLogs.trimEnd()}\n</recent_logs>`)
    parts.push('</memory>')

    return parts.join('\n')
  }

  // ===== Conversation Archives =====

  /**
   * Get conversation archive list
   */
  getConversationArchives(agentId: string): Array<{ filename: string; date: string }> {
    const dir = this.getConversationsDir(agentId)
    if (!existsSync(dir)) return []

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort((a, b) => b.localeCompare(a))

    return files.map((f) => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})/)
      return { filename: f, date: match ? match[1]! : '' }
    })
  }

  /**
   * Read a single conversation archive
   */
  getConversationArchive(agentId: string, filename: string): string {
    // Security check: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) return ''

    const filePath = resolve(this.getConversationsDir(agentId), filename)
    if (!existsSync(filePath)) return ''

    return readFileSync(filePath, 'utf-8')
  }

  /**
   * Save conversation archive
   */
  saveConversationArchive(agentId: string, filename: string, content: string): void {
    this.ensureConversationsDir(agentId)
    const filePath = resolve(this.getConversationsDir(agentId), filename)
    writeFileSync(filePath, content, 'utf-8')
    getLogger().info({ agentId, filename }, 'conversation archive saved')
  }

  // ===== Snapshots =====

  /**
   * Export agent core memory snapshot
   */
  exportSnapshot(agentId: string): string {
    const globalMemory = this.getGlobalMemory()
    const longTermMemory = this.getMemory(agentId)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, 7)

    const parts: string[] = []
    parts.push(`# Memory Snapshot: ${agentId}`)
    parts.push(`\n**Generated**: ${new Date().toISOString()}\n`)

    if (globalMemory) {
      parts.push('## Global Memory\n')
      parts.push(globalMemory)
      parts.push('')
    }

    parts.push('## Long-term Memory\n')
    parts.push(longTermMemory || '*(empty)*')
    parts.push('')

    if (recentDates.length > 0) {
      parts.push('## Recent Logs Summary\n')
      for (const date of recentDates) {
        const log = this.getDailyLog(agentId, date)
        if (log) {
          parts.push(`### ${date}\n`)
          parts.push(log.length > 1000 ? log.slice(0, 1000) + '\n...(truncated)' : log)
          parts.push('')
        }
      }
    }

    return parts.join('\n')
  }

  /**
   * Save snapshot file
   */
  saveSnapshot(agentId: string): string {
    const content = this.exportSnapshot(agentId)
    this.ensureMemoryDir(agentId)
    const filePath = this.getSnapshotFilePath(agentId)
    writeFileSync(filePath, content, 'utf-8')
    getLogger().info({ agentId }, 'MEMORY_SNAPSHOT.md saved')
    return content
  }

  /**
   * Get snapshot content
   */
  getSnapshot(agentId: string): string {
    const filePath = this.getSnapshotFilePath(agentId)
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8')
  }

  /**
   * Restore from snapshot (when MEMORY.md is empty but MEMORY_SNAPSHOT.md exists)
   */
  restoreFromSnapshot(agentId: string): boolean {
    const memory = this.getMemory(agentId)
    if (memory) return false

    const snapshot = this.getSnapshot(agentId)
    if (!snapshot) return false

    const match = snapshot.match(/## Long-term Memory\n\n([\s\S]*?)(?=\n## |$)/)
    const content = match?.[1]?.trim()

    if (content && content !== '*(empty)*') {
      this.updateMemory(agentId, content)
      getLogger().info({ agentId }, 'memory restored from MEMORY_SNAPSHOT.md')
      return true
    }

    return false
  }

  /**
   * Archive conversation
   */
  archiveConversation(agentId: string, chatId: string, sessionId: string, content: string): void {
    const logger = getLogger()
    const dir = this.getConversationsDir(agentId, chatId)

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const date = new Date().toISOString().split('T')[0]!
    const filename = `${sessionId}.md`
    const filePath = resolve(dir, filename)

    const header = `# Conversation Archive\n- Session: ${sessionId}\n- Chat: ${chatId}\n- Date: ${date}\n\n---\n\n`
    writeFileSync(filePath, header + content, 'utf-8')

    logger.info({ agentId, chatId, sessionId }, 'conversation archived')
  }

  /**
   * Get archived conversation list
   */
  getArchivedConversations(agentId: string, chatId?: string): ArchivedConversation[] {
    const results: ArchivedConversation[] = []
    const baseDir = this.getConversationsDir(agentId)

    if (!existsSync(baseDir)) {
      return results
    }

    const chatDirs = chatId
      ? [chatId.replace(/[:/]/g, '_')]
      : readdirSync(baseDir)

    for (const dir of chatDirs) {
      const chatDir = resolve(baseDir, dir)
      try {
        if (!statSync(chatDir).isDirectory()) continue
      } catch {
        continue
      }

      const files = readdirSync(chatDir).filter((f) => f.endsWith('.md'))
      for (const file of files) {
        const filePath = resolve(chatDir, file)
        try {
          const stat = statSync(filePath)
          results.push({
            sessionId: file.replace('.md', ''),
            date: stat.mtime.toISOString().split('T')[0]!,
            size: stat.size,
          })
        } catch {
          continue
        }
      }
    }

    return results.sort((a, b) => b.date.localeCompare(a.date))
  }

  /**
   * Get archived conversation content
   */
  getArchivedConversation(agentId: string, chatId: string, sessionId: string): string {
    const dir = this.getConversationsDir(agentId, chatId)
    const filePath = resolve(dir, `${sessionId}.md`)

    if (!existsSync(filePath)) {
      return ''
    }

    return readFileSync(filePath, 'utf-8')
  }
}
