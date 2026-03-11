import { useState, useEffect, useCallback } from 'react'
import {
  getAgents, getMemory, updateMemory, getMemoryLogs, getMemoryLog,
  getGlobalMemory, updateGlobalMemory,
  getConversationArchives, getConversationArchive,
  searchMemory,
} from '../api/client'
import { Brain, Save, Pencil, X, ChevronRight, Calendar, FileText, Globe, MessageSquare, Search } from 'lucide-react'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'

type Agent = {
  id: string
  name: string
}

type ConversationArchive = {
  filename: string
  date: string
}

type SearchResult = {
  agentId: string
  fileType: string
  filePath: string
  snippet: string
  rank: number
}

// 特殊标记：表示全局 Memory
const GLOBAL_ID = '__global__'

export function Memory() {
  const { t } = useI18n()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [memoryContent, setMemoryContent] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [logDates, setLogDates] = useState<string[]>([])
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<Record<string, string>>({})

  // 对话存档
  const [archives, setArchives] = useState<ConversationArchive[]>([])
  const [expandedArchive, setExpandedArchive] = useState<string | null>(null)
  const [archiveContent, setArchiveContent] = useState<Record<string, string>>({})

  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // 右栏 tab
  const [rightTab, setRightTab] = useState<'logs' | 'archives' | 'search'>('logs')

  // 加载 agents 列表
  useEffect(() => {
    getAgents()
      .then((list) => {
        setAgents(list)
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0]!.id)
        }
      })
      .catch(() => {})
  }, [])

  // 是否选中全局 Memory
  const isGlobal = selectedAgentId === GLOBAL_ID

  // 当选择 agent 变化时，加载记忆和日志
  const loadMemoryData = useCallback((agentId: string) => {
    if (!agentId) return

    if (agentId === GLOBAL_ID) {
      // 全局 Memory
      getGlobalMemory()
        .then((res) => {
          setMemoryContent(res.content)
          setEditContent(res.content)
        })
        .catch(() => {
          setMemoryContent('')
          setEditContent('')
        })
      setLogDates([])
      setArchives([])
    } else {
      // Agent Memory
      getMemory(agentId)
        .then((res) => {
          setMemoryContent(res.content)
          setEditContent(res.content)
        })
        .catch(() => {
          setMemoryContent('')
          setEditContent('')
        })

      getMemoryLogs(agentId)
        .then(setLogDates)
        .catch(() => setLogDates([]))

      getConversationArchives(agentId)
        .then(setArchives)
        .catch(() => setArchives([]))
    }

    setExpandedDate(null)
    setLogContent({})
    setExpandedArchive(null)
    setArchiveContent({})
    setIsEditing(false)
    setSearchResults([])
    setSearchQuery('')
  }, [])

  useEffect(() => {
    if (selectedAgentId) {
      loadMemoryData(selectedAgentId)
    }
  }, [selectedAgentId, loadMemoryData])

  // 保存 MEMORY.md
  const handleSave = async () => {
    if (!selectedAgentId) return
    setIsSaving(true)
    try {
      if (isGlobal) {
        await updateGlobalMemory(editContent)
      } else {
        await updateMemory(selectedAgentId, editContent)
      }
      setMemoryContent(editContent)
      setIsEditing(false)
    } catch {
      // 静默处理
    } finally {
      setIsSaving(false)
    }
  }

  // 展开/收起日志
  const toggleDate = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null)
      return
    }

    setExpandedDate(date)

    if (!logContent[date] && selectedAgentId && !isGlobal) {
      try {
        const res = await getMemoryLog(selectedAgentId, date)
        setLogContent((prev) => ({ ...prev, [date]: res.content }))
      } catch {
        setLogContent((prev) => ({ ...prev, [date]: t.memory.loadFailed }))
      }
    }
  }

  // 展开/收起存档
  const toggleArchive = async (filename: string) => {
    if (expandedArchive === filename) {
      setExpandedArchive(null)
      return
    }

    setExpandedArchive(filename)

    if (!archiveContent[filename] && selectedAgentId && !isGlobal) {
      try {
        const res = await getConversationArchive(selectedAgentId, filename)
        setArchiveContent((prev) => ({ ...prev, [filename]: res.content }))
      } catch {
        setArchiveContent((prev) => ({ ...prev, [filename]: t.memory.loadFailed }))
      }
    }
  }

  // 搜索
  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const results = await searchMemory(searchQuery, isGlobal ? undefined : selectedAgentId)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：Agent 选择器 */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Brain className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{t.memory.title}</h1>
        <select
          data-testid="memory-select-agent"
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          className="ml-4 px-3 py-1.5 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value={GLOBAL_ID}>
            🌐 Global Memory
          </option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.id})
            </option>
          ))}
        </select>
      </div>

      {/* 主内容：左右分栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：MEMORY.md */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex items-center gap-2">
              {isGlobal ? <Globe className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium">
                {isGlobal ? 'Global MEMORY.md' : t.memory.memoryFile}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={() => {
                      setEditContent(memoryContent)
                      setIsEditing(false)
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                  >
                    <X className="h-3 w-3" />
                    {t.common.cancel}
                  </button>
                  <button
                    data-testid="memory-save-btn"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" />
                    {isSaving ? t.memory.saving : t.common.save}
                  </button>
                </>
              ) : (
                <button
                  data-testid="memory-edit-btn"
                  onClick={() => {
                    setEditContent(memoryContent)
                    setIsEditing(true)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  {t.common.edit}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {isEditing ? (
              <textarea
                data-testid="memory-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-full bg-transparent text-sm font-mono resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
                placeholder={t.memory.writePlaceholder}
              />
            ) : (
              <div className="text-sm whitespace-pre-wrap font-mono text-foreground/80">
                {memoryContent || (
                  <span className="text-muted-foreground italic">
                    {t.memory.noContent}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：日志 / 对话存档 / 搜索 */}
        <div className="w-[380px] flex flex-col min-w-0">
          {/* Tab 切换 */}
          {!isGlobal && (
            <div className="flex border-b border-border">
              <button
                data-testid="memory-tab-logs"
                onClick={() => setRightTab('logs')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors',
                  rightTab === 'logs' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Calendar className="h-3.5 w-3.5" />
                {t.memory.dailyLogs}
              </button>
              <button
                data-testid="memory-tab-archives"
                onClick={() => setRightTab('archives')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors',
                  rightTab === 'archives' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Archives
              </button>
              <button
                data-testid="memory-tab-search"
                onClick={() => setRightTab('search')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors',
                  rightTab === 'search' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Search className="h-3.5 w-3.5" />
                Search
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {/* 全局模式：只显示搜索 */}
            {isGlobal ? (
              <div className="p-3">
                <div className="flex gap-2 mb-3">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search all memory..."
                    className="flex-1 px-3 py-1.5 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={isSearching}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
                {renderSearchResults()}
              </div>
            ) : (
              <>
                {rightTab === 'logs' && renderLogs()}
                {rightTab === 'archives' && renderArchives()}
                {rightTab === 'search' && renderSearchTab()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  function renderLogs() {
    if (logDates.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">{t.memory.noLogs}</p>
          </div>
        </div>
      )
    }

    return (
      <div className="p-2 space-y-1">
        {logDates.map((date) => (
          <div key={date}>
            <button
              onClick={() => toggleDate(date)}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-left transition-colors',
                expandedDate === date
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform',
                  expandedDate === date && 'rotate-90',
                )}
              />
              <Calendar className="h-3.5 w-3.5" />
              <span className="font-mono">{date}</span>
            </button>

            {expandedDate === date && (
              <div className="mt-1 mx-2 p-3 rounded-md bg-muted/50 border border-border/50">
                <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/70 overflow-x-auto">
                  {logContent[date] ?? t.common.loading}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  function renderArchives() {
    if (archives.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No conversation archives</p>
          </div>
        </div>
      )
    }

    return (
      <div className="p-2 space-y-1">
        {archives.map((archive) => (
          <div key={archive.filename}>
            <button
              onClick={() => toggleArchive(archive.filename)}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-left transition-colors',
                expandedArchive === archive.filename
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 transition-transform',
                  expandedArchive === archive.filename && 'rotate-90',
                )}
              />
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-mono text-xs truncate">{archive.filename}</span>
            </button>

            {expandedArchive === archive.filename && (
              <div className="mt-1 mx-2 p-3 rounded-md bg-muted/50 border border-border/50">
                <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/70 overflow-x-auto">
                  {archiveContent[archive.filename] ?? t.common.loading}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  function renderSearchTab() {
    return (
      <div className="p-3">
        <div className="flex gap-2 mb-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search memory..."
            className="flex-1 px-3 py-1.5 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
        {renderSearchResults()}
      </div>
    )
  }

  function renderSearchResults() {
    if (searchResults.length === 0 && searchQuery && !isSearching) {
      return <p className="text-xs text-muted-foreground">No results</p>
    }

    return (
      <div className="space-y-2">
        {searchResults.map((result, i) => (
          <div key={i} className="p-2 rounded-md bg-muted/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-foreground">{result.agentId}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">{result.fileType}</span>
            </div>
            <p className="text-xs font-mono text-foreground/70 whitespace-pre-wrap">{result.snippet}</p>
          </div>
        ))}
      </div>
    )
  }
}
