import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

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

  /**
   * 获取 agent 的 MEMORY.md 内容
   */
  getMemory(agentId: string): string {
    const filePath = this.getMemoryFilePath(agentId)

    if (!existsSync(filePath)) {
      return ''
    }

    return readFileSync(filePath, 'utf-8')
  }

  /**
   * 更新 agent 的 MEMORY.md
   */
  updateMemory(agentId: string, content: string): void {
    this.ensureMemoryDir(agentId)
    const filePath = this.getMemoryFilePath(agentId)
    writeFileSync(filePath, content, 'utf-8')
    getLogger().info({ agentId }, 'MEMORY.md 已更新')
  }

  /**
   * 追加每日日志
   */
  appendDailyLog(agentId: string, chatId: string, userMessage: string, botReply: string): void {
    this.ensureLogsDir(agentId)

    const now = new Date()
    const date = now.toISOString().split('T')[0]!
    const time = now.toTimeString().slice(0, 5)
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    const entry = `\n## ${time} [${chatId}]\n**User**: ${userMessage}\n**Assistant**: ${botReply}\n`

    let existing = ''
    if (existsSync(logPath)) {
      existing = readFileSync(logPath, 'utf-8')
    } else {
      existing = `# ${date}\n`
    }

    writeFileSync(logPath, existing + entry, 'utf-8')
    getLogger().debug({ agentId, date }, '每日日志已追加')
  }

  /**
   * 获取每日日志列表（返回日期数组，降序排列）
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
   * 获取某天的日志内容
   */
  getDailyLog(agentId: string, date: string): string {
    const logPath = resolve(this.getLogsDir(agentId), `${date}.md`)

    if (!existsSync(logPath)) {
      return ''
    }

    return readFileSync(logPath, 'utf-8')
  }

  /**
   * 获取记忆上下文（注入到系统提示词中）
   * 支持可配置的天数和字符限制
   */
  getMemoryContext(agentId: string, options?: MemoryContextOptions): string {
    const recentDays = options?.recentDays ?? 3
    const maxContextChars = options?.maxContextChars ?? 10000

    const longTermMemory = this.getMemory(agentId)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, recentDays)

    let recentLogs = ''
    let totalChars = longTermMemory.length

    for (const date of recentDates) {
      const log = this.getDailyLog(agentId, date)
      if (log) {
        // 检查是否超出字符限制
        if (totalChars + log.length > maxContextChars) {
          // 截断最后一段日志
          const remaining = maxContextChars - totalChars
          if (remaining > 100) {
            recentLogs += log.slice(0, remaining) + '\n...[日志已截断]\n'
          }
          break
        }
        totalChars += log.length
        recentLogs += log + '\n'
      }
    }

    return `<memory>
<long_term>
${longTermMemory}
</long_term>
<recent_logs>
${recentLogs.trimEnd()}
</recent_logs>
</memory>`
  }

  /**
   * 归档会话
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

    const header = `# 会话归档\n- Session: ${sessionId}\n- Chat: ${chatId}\n- Date: ${date}\n\n---\n\n`
    writeFileSync(filePath, header + content, 'utf-8')

    logger.info({ agentId, chatId, sessionId }, '会话已归档')
  }

  /**
   * 获取归档会话列表
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
   * 获取归档会话内容
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
