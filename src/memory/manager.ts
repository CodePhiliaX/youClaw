import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import type { MemoryIndexer } from './indexer.ts'
import {
  MemoryExtractor,
  type CuratedMemoryUpdate,
  type DailyMemoryItem,
  type MemoryExtractionResult,
  type MemoryExtractionRunner,
} from './extractor.ts'

const GLOBAL_AGENT_ID = '_global'
const MEMORY_SECTION_ORDER = ['Profile', 'Schedule', 'Preferences', 'Relationships', 'Projects', 'Notes'] as const
type MemorySection = (typeof MEMORY_SECTION_ORDER)[number]

type StructuredMemoryStore = Record<MemorySection, Map<string, string>>

export interface MemoryContextOptions {
  recentDays?: number
  maxContextChars?: number
  query?: string
}

export interface ArchivedConversation {
  sessionId: string
  date: string
  size: number
}

export interface SavedSessionSummary {
  filename: string
  filePath: string
}

export class MemoryManager {
  private indexer: MemoryIndexer | null = null

  constructor(private extractor: MemoryExtractionRunner | null = new MemoryExtractor()) {}

  attachIndexer(indexer: MemoryIndexer | null): void {
    this.indexer = indexer
  }

  private getRootMemoryFilePath(agentId: string): string {
    const agentsDir = getPaths().agents
    return resolve(agentsDir, agentId, 'MEMORY.md')
  }

  private getAgentMemoryDir(agentId: string): string {
    const agentsDir = getPaths().agents
    return resolve(agentsDir, agentId, 'memory')
  }

  private getMemoryFilePath(agentId: string): string {
    if (agentId === GLOBAL_AGENT_ID) {
      return resolve(this.getAgentMemoryDir(agentId), 'MEMORY.md')
    }
    return this.getRootMemoryFilePath(agentId)
  }

  private getSnapshotFilePath(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'MEMORY_SNAPSHOT.md')
  }

  private getLogsDir(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'logs')
  }

  private getDailyMemoryNotePath(agentId: string, date: string): string {
    return resolve(this.getAgentMemoryDir(agentId), `${date}.md`)
  }

  private getConversationsDir(agentId: string, chatId?: string): string {
    const base = resolve(this.getAgentMemoryDir(agentId), 'conversations')
    if (chatId) {
      return resolve(base, chatId.replace(/[:/]/g, '_'))
    }
    return base
  }

  private getSummariesDir(agentId: string): string {
    return resolve(this.getAgentMemoryDir(agentId), 'summaries')
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

  private createEmptyStructuredMemory(): StructuredMemoryStore {
    return {
      Profile: new Map(),
      Schedule: new Map(),
      Preferences: new Map(),
      Relationships: new Map(),
      Projects: new Map(),
      Notes: new Map(),
    }
  }

  private normalizeMemorySection(section: string): MemorySection {
    const normalized = section.trim().toLowerCase()
    if (normalized.includes('profile') || normalized.includes('identity')) return 'Profile'
    if (normalized.includes('schedule') || normalized.includes('routine') || normalized.includes('time')) return 'Schedule'
    if (normalized.includes('preference') || normalized.includes('like') || normalized.includes('food')) return 'Preferences'
    if (normalized.includes('relationship') || normalized.includes('family') || normalized.includes('people')) return 'Relationships'
    if (normalized.includes('project') || normalized.includes('work')) return 'Projects'
    return 'Notes'
  }

  private normalizeMemoryKey(key: string): string {
    return key
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'note'
  }

  private parseStructuredMemory(content: string): StructuredMemoryStore {
    const store = this.createEmptyStructuredMemory()
    let currentSection: MemorySection | null = null

    for (const rawLine of content.split('\n')) {
      const heading = rawLine.match(/^##\s+(.+?)\s*$/)
      if (heading) {
        currentSection = this.normalizeMemorySection(heading[1]!)
        continue
      }

      if (!currentSection) continue
      const entry = rawLine.match(/^- (?:`([^`]+)`|([^:]+)):\s+(.+?)\s*$/)
      if (!entry) continue

      const key = this.normalizeMemoryKey(entry[1] ?? entry[2] ?? '')
      const value = (entry[3] ?? '').trim()
      if (!key || !value) continue
      store[currentSection].set(key, value)
    }

    return store
  }

  private renderStructuredMemory(store: StructuredMemoryStore): string {
    const parts = ['# Long-term Memory', '']

    for (const section of MEMORY_SECTION_ORDER) {
      parts.push(`## ${section}`, '')
      const entries = Array.from(store[section].entries()).sort(([a], [b]) => a.localeCompare(b))
      if (entries.length === 0) {
        parts.push('<!-- empty -->', '')
        continue
      }
      for (const [key, value] of entries) {
        parts.push(`- \`${key}\`: ${value}`)
      }
      parts.push('')
    }

    return parts.join('\n').trimEnd() + '\n'
  }

  private getDailyMemoryNoteDates(agentId: string): string[] {
    const memoryDir = this.getAgentMemoryDir(agentId)
    if (!existsSync(memoryDir)) return []

    return readdirSync(memoryDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .map((name) => name.replace(/\.md$/, ''))
      .sort((a, b) => b.localeCompare(a))
  }

  private getDailyMemoryNote(agentId: string, date: string): string {
    const filePath = this.getDailyMemoryNotePath(agentId, date)
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8')
  }

  private appendDailyMemoryNote(
    agentId: string,
    chatId: string,
    userMessage: string,
    items: DailyMemoryItem[],
  ): void {
    if (items.length === 0) return

    this.ensureMemoryDir(agentId)
    const now = new Date()
    const date = now.toISOString().split('T')[0]!
    const time = now.toTimeString().slice(0, 5)
    const filePath = this.getDailyMemoryNotePath(agentId, date)
    const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : `# ${date}\n`
    const seen = new Set(existing.split('\n').map((line) => line.trim()))
    const deduped = items.filter((item) => !seen.has(`- ${item.text}`))
    if (deduped.length === 0) return
    const entryLines = [
      '',
      `## ${time} [${chatId}]`,
      `- Source: ${this.truncate(userMessage.replace(/\s+/g, ' ').trim(), 300)}`,
      ...deduped.map((item) => `- ${item.text}`),
      '',
    ]
    writeFileSync(filePath, existing + entryLines.join('\n'), 'utf-8')
    this.indexFile(agentId, 'note', filePath)
  }

  private applyCuratedMemoryUpdates(agentId: string, updates: CuratedMemoryUpdate[]): CuratedMemoryUpdate[] {
    if (updates.length === 0) return []

    const store = this.parseStructuredMemory(this.getMemory(agentId))
    const applied: CuratedMemoryUpdate[] = []

    for (const update of updates) {
      const section = this.normalizeMemorySection(update.section)
      const key = this.normalizeMemoryKey(update.key)
      const value = update.value.trim()
      if (!key || !value) continue
      if (store[section].get(key) === value) continue
      store[section].set(key, value)
      applied.push({ section, key, value })
    }

    if (applied.length > 0) {
      this.updateMemory(agentId, this.renderStructuredMemory(store))
    }

    return applied
  }

  private ensureConversationsDir(agentId: string): void {
    const dir = this.getConversationsDir(agentId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private ensureSummariesDir(agentId: string): void {
    const dir = this.getSummariesDir(agentId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private indexFile(agentId: string, fileType: string, filePath: string): void {
    if (!this.indexer || !existsSync(filePath)) return

    const content = readFileSync(filePath, 'utf-8')
    if (!content.trim()) {
      this.indexer.removeFile(filePath)
      return
    }

    this.indexer.indexFile(agentId, fileType, filePath, content)
  }

  private removeIndexedFile(filePath: string): void {
    this.indexer?.removeFile(filePath)
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
    this.indexFile(agentId, 'memory', filePath)
    getLogger().info({ agentId }, 'MEMORY.md updated')
  }

  async rememberTurn(agentId: string, chatId: string, userMessage: string, assistantReply: string): Promise<MemoryExtractionResult> {
    if (!this.extractor) {
      return { dailyMemories: [], curatedUpdates: [] }
    }
    if (!userMessage.trim()) return { dailyMemories: [], curatedUpdates: [] }
    if (!assistantReply.trim() || assistantReply.startsWith('Error:')) {
      return { dailyMemories: [], curatedUpdates: [] }
    }

    const now = new Date().toISOString().split('T')[0]!
    const currentDailyMemory = this.getDailyMemoryNote(agentId, now)

    const extracted = await this.extractor.extractTurnMemory({
      agentId,
      chatId,
      currentMemory: this.getMemory(agentId),
      currentDailyMemory,
      userMessage,
      assistantReply,
    })

    if (extracted.dailyMemories.length > 0) {
      this.appendDailyMemoryNote(agentId, chatId, userMessage, extracted.dailyMemories)
    }
    const appliedCurated = this.applyCuratedMemoryUpdates(agentId, extracted.curatedUpdates)
    return {
      dailyMemories: extracted.dailyMemories,
      curatedUpdates: appliedCurated,
    }
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
    this.indexFile(agentId, 'log', logPath)
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
        const filePath = resolve(logsDir, file)
        unlinkSync(filePath)
        this.removeIndexedFile(filePath)
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
    const recentDays = options?.recentDays ?? 2
    const maxContextChars = options?.maxContextChars ?? 10000
    const query = options?.query?.trim()

    const globalMemory = this.getGlobalMemory()
    const longTermMemory = this.getMemory(agentId)
    const noteDates = this.getDailyMemoryNoteDates(agentId)
    const recentNoteDates = noteDates.slice(0, recentDays)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, recentDays)
    const summaryFiles = this.getSessionSummaryFiles(agentId).slice(0, recentDays)
    const relevantHits = query && this.indexer
      ? this.indexer.search(query, { agentId, limit: 6 })
      : []

    let recentLogs = ''
    let recentNotes = ''
    let recentSummaries = ''
    let totalChars = globalMemory.length + longTermMemory.length
    let relevantMemoryHits = ''

    for (const hit of relevantHits) {
      const snippet = hit.snippet.trim()
      if (!snippet) continue

      const block = `- [${hit.fileType}] ${hit.filePath}\n${snippet}\n`
      if (totalChars + block.length > maxContextChars) {
        break
      }

      totalChars += block.length
      relevantMemoryHits += block
    }

    for (const date of recentNoteDates) {
      const note = this.getDailyMemoryNote(agentId, date)
      if (!note) continue

      if (totalChars + note.length > maxContextChars) {
        const remaining = maxContextChars - totalChars
        if (remaining > 100) {
          recentNotes += note.slice(0, remaining) + '\n...[memory notes truncated]\n'
        }
        break
      }

      totalChars += note.length
      recentNotes += note + '\n'
    }

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

    for (const filename of summaryFiles) {
      const filePath = resolve(this.getSummariesDir(agentId), filename)
      if (!existsSync(filePath)) continue

      const content = readFileSync(filePath, 'utf-8')
      if (!content.trim()) continue

      if (totalChars + content.length > maxContextChars) {
        const remaining = maxContextChars - totalChars
        if (remaining > 100) {
          recentSummaries += content.slice(0, remaining) + '\n...[session summaries truncated]\n'
        }
        break
      }

      totalChars += content.length
      recentSummaries += content + '\n'
    }

    const parts: string[] = ['<memory>']

    if (globalMemory) {
      parts.push(`<global_memory>\n${globalMemory}\n</global_memory>`)
    }

    if (recentNotes.trim()) {
      parts.push(`<recent_notes>\n${recentNotes.trimEnd()}\n</recent_notes>`)
    }
    parts.push(`<long_term>\n${longTermMemory}\n</long_term>`)
    if (relevantMemoryHits.trim()) {
      parts.push(`<relevant_memory_hits>\n${relevantMemoryHits.trimEnd()}\n</relevant_memory_hits>`)
    }
    parts.push(`<recent_logs>\n${recentLogs.trimEnd()}\n</recent_logs>`)
    if (recentSummaries.trim()) {
      parts.push(`<session_summaries>\n${recentSummaries.trimEnd()}\n</session_summaries>`)
    }
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
    this.indexFile(agentId, 'conversation', filePath)
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
    this.indexFile(agentId, 'conversation', filePath)

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

  getSessionSummaryFiles(agentId: string): string[] {
    const dir = this.getSummariesDir(agentId)
    if (!existsSync(dir)) return []

    return readdirSync(dir)
      .filter((file) => file.endsWith('.md'))
      .sort((a, b) => b.localeCompare(a))
  }

  saveSessionSummary(
    agentId: string,
    chatId: string,
    sessionId: string,
    summary: string,
    metadata?: { trigger?: string; model?: string },
  ): SavedSessionSummary | null {
    const cleanedSummary = summary.trim()
    if (!cleanedSummary) return null

    this.ensureSummariesDir(agentId)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'chat'
    const filename = `${timestamp}-${safeChatId}-${sessionId}.md`
    const filePath = resolve(this.getSummariesDir(agentId), filename)
    const content = [
      '# Session Summary',
      '',
      `- Agent: ${agentId}`,
      `- Chat: ${chatId}`,
      `- Session: ${sessionId}`,
      metadata?.trigger ? `- Trigger: ${metadata.trigger}` : null,
      metadata?.model ? `- Model: ${metadata.model}` : null,
      `- Saved: ${new Date().toISOString()}`,
      '',
      '## Summary',
      '',
      cleanedSummary,
      '',
    ].filter(Boolean).join('\n')

    writeFileSync(filePath, content, 'utf-8')
    this.indexFile(agentId, 'summary', filePath)
    getLogger().info({ agentId, chatId, sessionId, filename }, 'session summary saved')
    return { filename, filePath }
  }
}
