import { useState, useEffect, useCallback } from 'react'
import {
  getAgents, getMemory, updateMemory, getMemoryLogs, getMemoryLog,
  getGlobalMemory, updateGlobalMemory,
  getConversationArchives, getConversationArchive,
  searchMemory,
} from '../api/client'
import { Save, Pencil, X, ChevronRight, Calendar, FileText, Globe, MessageSquare, Search, PanelRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import { useDragRegion } from "@/hooks/useDragRegion"

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

const GLOBAL_ID = '__global__'

type MemoryItem = {
  id: string
  label: string
  isGlobal: boolean
}

export function Memory() {
  const { t } = useI18n()
  const drag = useDragRegion()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string>(GLOBAL_ID)
  const [memoryContent, setMemoryContent] = useState('')
  const [editContent, setEditContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [logDates, setLogDates] = useState<string[]>([])
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<Record<string, string>>({})

  const [archives, setArchives] = useState<ConversationArchive[]>([])
  const [expandedArchive, setExpandedArchive] = useState<string | null>(null)
  const [archiveContent, setArchiveContent] = useState<Record<string, string>>({})

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Right panel
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'logs' | 'archives' | 'search'>('logs')

  useEffect(() => {
    getAgents()
      .then((list) => setAgents(list))
      .catch(() => {})
  }, [])

  const isGlobal = selectedId === GLOBAL_ID

  const memoryItems: MemoryItem[] = [
    { id: GLOBAL_ID, label: 'Global Memory', isGlobal: true },
    ...agents.map((a) => ({ id: a.id, label: a.name, isGlobal: false })),
  ]

  const loadMemoryData = useCallback((id: string) => {
    if (!id) return

    if (id === GLOBAL_ID) {
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
      getMemory(id)
        .then((res) => {
          setMemoryContent(res.content)
          setEditContent(res.content)
        })
        .catch(() => {
          setMemoryContent('')
          setEditContent('')
        })

      getMemoryLogs(id)
        .then(setLogDates)
        .catch(() => setLogDates([]))

      getConversationArchives(id)
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
    loadMemoryData(selectedId)
  }, [selectedId, loadMemoryData])

  const handleSave = async () => {
    if (!selectedId) return
    setIsSaving(true)
    try {
      if (isGlobal) {
        await updateGlobalMemory(editContent)
      } else {
        await updateMemory(selectedId, editContent)
      }
      setMemoryContent(editContent)
      setIsEditing(false)
    } catch {
      // Silently ignore
    } finally {
      setIsSaving(false)
    }
  }

  const toggleDate = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null)
      return
    }
    setExpandedDate(date)
    if (!logContent[date] && selectedId && !isGlobal) {
      try {
        const res = await getMemoryLog(selectedId, date)
        setLogContent((prev) => ({ ...prev, [date]: res.content }))
      } catch {
        setLogContent((prev) => ({ ...prev, [date]: t.memory.loadFailed }))
      }
    }
  }

  const toggleArchive = async (filename: string) => {
    if (expandedArchive === filename) {
      setExpandedArchive(null)
      return
    }
    setExpandedArchive(filename)
    if (!archiveContent[filename] && selectedId && !isGlobal) {
      try {
        const res = await getConversationArchive(selectedId, filename)
        setArchiveContent((prev) => ({ ...prev, [filename]: res.content }))
      } catch {
        setArchiveContent((prev) => ({ ...prev, [filename]: t.memory.loadFailed }))
      }
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const results = await searchMemory(searchQuery, isGlobal ? undefined : selectedId)
      setSearchResults(results)
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const selectedItem = memoryItems.find((m) => m.id === selectedId)

  return (
    <div className="flex h-full">
      {/* Left: Memory list */}
      <SidePanel>
        <div className="h-9 shrink-0 px-3 border-b border-[var(--subtle-border)] flex items-center justify-between" {...drag}>
          <h2 className="font-semibold text-sm">{t.memory.title}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {memoryItems.map((item) => (
            <div
              key={item.id}
              role="option"
              aria-selected={selectedId === item.id}
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 cursor-pointer",
                "transition-all duration-200 ease-[var(--ease-soft)]",
                selectedId === item.id
                  ? "bg-primary/8 text-foreground"
                  : "text-muted-foreground hover:bg-[var(--surface-hover)]",
              )}
              onClick={() => setSelectedId(item.id)}
            >
              {item.isGlobal ? (
                <Globe className="h-4 w-4 shrink-0" />
              ) : (
                <FileText className="h-4 w-4 shrink-0" />
              )}
              <span className="text-sm truncate">{item.label}</span>
            </div>
          ))}
        </div>
      </SidePanel>

      {/* Center: Memory content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top toolbar */}
        <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[var(--subtle-border)]">
          <div className="flex items-center gap-2">
            {selectedItem?.isGlobal ? (
              <Globe className="h-4 w-4 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {selectedItem?.isGlobal ? 'Global MEMORY.md' : t.memory.memoryFile}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Edit/Save */}
            {isEditing ? (
              <>
                <button
                  onClick={() => {
                    setEditContent(memoryContent)
                    setIsEditing(false)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  data-testid="memory-save-btn"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button
                data-testid="memory-edit-btn"
                onClick={() => {
                  setEditContent(memoryContent)
                  setIsEditing(true)
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}

            <div className="w-px h-4 bg-border mx-1" />

            {/* Toggle right panel */}
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                panelOpen
                  ? "text-foreground bg-[var(--surface-hover)]"
                  : "text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground",
              )}
              title={t.memory.dailyLogs}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Memory content */}
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

      {/* Right panel: logs / archives / search */}
      {panelOpen && (
        <div className="w-[340px] shrink-0 border-l border-[var(--subtle-border)] flex flex-col">
          {/* Tab switcher */}
          <div className="h-9 shrink-0 flex items-center gap-1 px-3 border-b border-[var(--subtle-border)]">
            {!isGlobal && (
              <>
                <button
                  onClick={() => setPanelTab('logs')}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                    panelTab === 'logs'
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {t.memory.dailyLogs}
                </button>
                <button
                  onClick={() => setPanelTab('archives')}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                    panelTab === 'archives'
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Archives
                </button>
              </>
            )}
            <button
              onClick={() => setPanelTab('search')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                panelTab === 'search'
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-[var(--surface-hover)]",
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {panelTab === 'logs' && !isGlobal && renderLogs()}
            {panelTab === 'archives' && !isGlobal && renderArchives()}
            {panelTab === 'search' && renderSearchTab()}
          </div>
        </div>
      )}
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
                'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg text-left transition-all duration-200 ease-[var(--ease-soft)]',
                expandedDate === date
                  ? 'bg-primary/8 text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--surface-hover)]',
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
              <div className="mt-1 mx-2 p-3 rounded-lg bg-muted/50 border border-[var(--subtle-border)]">
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
                'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg text-left transition-all duration-200 ease-[var(--ease-soft)]',
                expandedArchive === archive.filename
                  ? 'bg-primary/8 text-foreground'
                  : 'text-muted-foreground hover:bg-[var(--surface-hover)]',
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
              <div className="mt-1 mx-2 p-3 rounded-lg bg-muted/50 border border-[var(--subtle-border)]">
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
            className="flex-1 bg-[var(--surface-raised)] border border-[var(--subtle-border)] rounded-xl px-3 py-1.5 text-sm transition-all duration-200 ease-[var(--ease-soft)] focus:outline-none focus:border-primary/40 focus:shadow-[0_0_0_3px_oklch(0.55_0.2_25/0.1)]"
          />
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-xl text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)] disabled:opacity-50"
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
          <div key={i} className="p-2.5 rounded-lg bg-muted/50 border border-[var(--subtle-border)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-foreground">{result.agentId}</span>
              <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">{result.fileType}</span>
            </div>
            <p className="text-xs font-mono text-foreground/70 whitespace-pre-wrap">{result.snippet}</p>
          </div>
        ))}
      </div>
    )
  }
}
