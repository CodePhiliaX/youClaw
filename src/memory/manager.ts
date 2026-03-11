import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

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
   * 包含长期记忆和最近 3 天的日志摘要
   */
  getMemoryContext(agentId: string): string {
    const longTermMemory = this.getMemory(agentId)
    const dates = this.getDailyLogDates(agentId)
    const recentDates = dates.slice(0, 3)

    let recentLogs = ''
    for (const date of recentDates) {
      const log = this.getDailyLog(agentId, date)
      if (log) {
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
}
