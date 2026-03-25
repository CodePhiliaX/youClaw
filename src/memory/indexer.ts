import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDatabase } from '../db/index.ts'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'

export interface SearchResult {
  agentId: string
  fileType: string
  filePath: string
  snippet: string
  rank: number
}

/**
 * Full-text search index for memory based on SQLite FTS5
 */
export class MemoryIndexer {
  /**
   * Initialize FTS5 virtual table
   */
  initTable(): void {
    const db = getDatabase()
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        agent_id, file_type, file_path, content, tokenize='unicode61'
      )
    `)
    getLogger().debug('memory_fts table initialized')
  }

  /**
   * Full index rebuild (called on startup)
   */
  rebuildIndex(): void {
    const db = getDatabase()
    const agentsDir = getPaths().agents

    // Clear existing index
    db.exec('DELETE FROM memory_fts')

    if (!existsSync(agentsDir)) return

    const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    let count = 0
    for (const agentId of agentDirs) {
      count += this.indexAgentMemory(agentId)
    }

    getLogger().info({ count }, 'memory index full rebuild complete')
  }

  /**
   * Index all memory files for a single agent
   */
  private indexAgentMemory(agentId: string): number {
    const agentsDir = getPaths().agents
    const memoryDir = resolve(agentsDir, agentId, 'memory')

    let count = 0

    const memoryFile = resolve(agentsDir, agentId, 'MEMORY.md')
    if (existsSync(memoryFile)) {
      const content = readFileSync(memoryFile, 'utf-8')
      if (content.trim()) {
        this.indexFile(agentId, 'memory', memoryFile, content)
        count++
      }
    }

    if (!existsSync(memoryDir)) return count

    const noteFiles = readdirSync(memoryDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    for (const file of noteFiles) {
      const filePath = resolve(memoryDir, file)
      const content = readFileSync(filePath, 'utf-8')
      if (content.trim()) {
        this.indexFile(agentId, 'note', filePath, content)
        count++
      }
    }

    // Index logs/
    const logsDir = resolve(memoryDir, 'logs')
    if (existsSync(logsDir)) {
      const logFiles = readdirSync(logsDir).filter((f) => f.endsWith('.md'))
      for (const file of logFiles) {
        const filePath = resolve(logsDir, file)
        const content = readFileSync(filePath, 'utf-8')
        if (content.trim()) {
          this.indexFile(agentId, 'log', filePath, content)
          count++
        }
      }
    }

    // Index conversations/
    const convDir = resolve(memoryDir, 'conversations')
    if (existsSync(convDir)) {
      const entries = readdirSync(convDir)
      for (const entry of entries) {
        const entryPath = resolve(convDir, entry)
        try {
          if (statSync(entryPath).isDirectory()) {
            const nestedFiles = readdirSync(entryPath).filter((f) => f.endsWith('.md'))
            for (const file of nestedFiles) {
              const filePath = resolve(entryPath, file)
              const content = readFileSync(filePath, 'utf-8')
              if (content.trim()) {
                this.indexFile(agentId, 'conversation', filePath, content)
                count++
              }
            }
            continue
          }
        } catch {
          continue
        }

        if (entry.endsWith('.md')) {
          const content = readFileSync(entryPath, 'utf-8')
          if (content.trim()) {
            this.indexFile(agentId, 'conversation', entryPath, content)
            count++
          }
        }
      }
    }

    const summariesDir = resolve(memoryDir, 'summaries')
    if (existsSync(summariesDir)) {
      const summaryFiles = readdirSync(summariesDir).filter((f) => f.endsWith('.md'))
      for (const file of summaryFiles) {
        const filePath = resolve(summariesDir, file)
        const content = readFileSync(filePath, 'utf-8')
        if (content.trim()) {
          this.indexFile(agentId, 'summary', filePath, content)
          count++
        }
      }
    }

    return count
  }

  /**
   * Incrementally index a single file (delete old records then insert)
   */
  indexFile(agentId: string, fileType: string, filePath: string, content: string): void {
    const db = getDatabase()
    // Delete old index for this file
    db.prepare('DELETE FROM memory_fts WHERE file_path = ?').run(filePath)
    // Insert new index
    db.prepare(
      'INSERT INTO memory_fts (agent_id, file_type, file_path, content) VALUES (?, ?, ?, ?)'
    ).run(agentId, fileType, filePath, content)
  }

  /**
   * Delete file index
   */
  removeFile(filePath: string): void {
    const db = getDatabase()
    db.prepare('DELETE FROM memory_fts WHERE file_path = ?').run(filePath)
  }

  /**
   * Full-text search
   */
  search(queryStr: string, options?: { agentId?: string; fileType?: string; limit?: number }): SearchResult[] {
    const db = getDatabase()
    const limit = options?.limit ?? 20

    // Build FTS5 query: wrap each term in quotes, connect with AND
    const tokens = queryStr.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []

    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' AND ')

    let sql = `SELECT agent_id, file_type, file_path, snippet(memory_fts, 3, '>>>', '<<<', '...', 64) as snippet, rank
               FROM memory_fts
               WHERE memory_fts MATCH ?`
    const params: (string | number)[] = [ftsQuery]

    if (options?.agentId) {
      sql += ' AND agent_id = ?'
      params.push(options.agentId)
    }
    if (options?.fileType) {
      sql += ' AND file_type = ?'
      params.push(options.fileType)
    }

    sql += ' ORDER BY rank LIMIT ?'
    params.push(limit)

    try {
      const rows = db.prepare(sql).all(...params) as Array<{
        agent_id: string
        file_type: string
        file_path: string
        snippet: string
        rank: number
      }>

      return rows.map((r) => ({
        agentId: r.agent_id,
        fileType: r.file_type,
        filePath: r.file_path,
        snippet: r.snippet,
        rank: r.rank,
      }))
    } catch (err) {
      getLogger().warn({ query: queryStr, error: err instanceof Error ? err.message : String(err) }, 'Memory search failed')
      return []
    }
  }
}
