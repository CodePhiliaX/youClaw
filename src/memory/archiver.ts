import { readFileSync } from 'node:fs'
import { getLogger } from '../logger/index.ts'
import type { MemoryManager } from './manager.ts'

interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Conversation archiver: parse SDK transcript (JSONL) and format as Markdown
 */
export class ConversationArchiver {
  constructor(private memoryManager: MemoryManager) {}

  /**
   * Archive conversation from SDK transcript file
   */
  async archive(agentId: string, transcriptPath: string, chatId: string): Promise<string | null> {
    const logger = getLogger()

    try {
      const raw = readFileSync(transcriptPath, 'utf-8')
      const entries = this.parseTranscript(raw)

      if (entries.length === 0) {
        logger.debug({ agentId, transcriptPath }, 'Empty transcript, skipping archive')
        return null
      }

      const title = this.generateTitle(entries)
      const now = new Date()
      const date = now.toISOString().split('T')[0]!
      const sanitizedTitle = this.sanitizeFilename(title)
      const filename = `${date}-${sanitizedTitle}.md`

      const content = this.formatMarkdown(title, chatId, now, entries)
      this.memoryManager.saveConversationArchive(agentId, filename, content)

      logger.info({ agentId, filename, entries: entries.length }, 'Conversation archived')
      return filename
    } catch (err) {
      logger.error({ agentId, transcriptPath, error: err instanceof Error ? err.message : String(err) }, 'Conversation archive failed')
      return null
    }
  }

  /**
   * Parse user/assistant messages from JSONL content
   */
  parseTranscript(raw: string): TranscriptEntry[] {
    const entries: TranscriptEntry[] = []

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue

      try {
        const obj = JSON.parse(line)

        if (obj.type === 'user' || obj.role === 'user') {
          const content = this.extractContent(obj)
          if (content) {
            entries.push({ role: 'user', content })
          }
        } else if (obj.type === 'assistant' || obj.role === 'assistant') {
          const content = this.extractContent(obj)
          if (content) {
            entries.push({ role: 'assistant', content })
          }
        }
      } catch {
        // Skip invalid JSON line
      }
    }

    return entries
  }

  /**
   * Extract text content from message object
   */
  private extractContent(obj: Record<string, unknown>): string {
    // Direct string
    if (typeof obj.content === 'string') return obj.content

    // Nested in message.content
    const message = obj.message as Record<string, unknown> | undefined
    if (message && typeof message.content === 'string') return message.content

    // Array format (Claude SDK format)
    const contentArr = (message?.content ?? obj.content) as Array<Record<string, unknown>> | undefined
    if (Array.isArray(contentArr)) {
      return contentArr
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n')
    }

    return ''
  }

  /**
   * Generate title from the first user message
   */
  private generateTitle(entries: TranscriptEntry[]): string {
    const firstUser = entries.find((e) => e.role === 'user')
    if (!firstUser) return 'conversation'

    // Take first line, truncate to 50 chars
    const firstLine = firstUser.content.split('\n')[0] ?? 'conversation'
    return firstLine.slice(0, 50)
  }

  /**
   * Sanitize filename: lowercase, non-alphanumeric to -, remove consecutive -, max 50 chars
   */
  private sanitizeFilename(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'conversation'
  }

  /**
   * Format as Markdown
   */
  private formatMarkdown(title: string, chatId: string, archivedAt: Date, entries: TranscriptEntry[]): string {
    const parts: string[] = []
    parts.push(`# ${title}`)
    parts.push('')
    parts.push(`**Chat**: ${chatId}`)
    parts.push(`**Archived**: ${archivedAt.toISOString()}`)
    parts.push('')
    parts.push('---')
    parts.push('')

    for (const entry of entries) {
      const label = entry.role === 'user' ? 'User' : 'Assistant'
      // Truncate oversized content
      const content = entry.content.length > 2000
        ? entry.content.slice(0, 2000) + '\n\n*(truncated)*'
        : entry.content
      parts.push(`## ${label}`)
      parts.push(content)
      parts.push('')
    }

    return parts.join('\n')
  }
}
