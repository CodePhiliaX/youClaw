import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { getLogDates, getLogEntries } from '../api/client'
import type { LogEntry } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL',
}

const LEVEL_COLORS: Record<number, string> = {
  10: 'text-zinc-500',
  20: 'text-zinc-400',
  30: 'text-blue-400',
  40: 'text-yellow-400',
  50: 'text-red-400',
  60: 'text-red-500',
}

const CATEGORY_COLORS: Record<string, string> = {
  agent: 'bg-purple-500/20 text-purple-400',
  tool_use: 'bg-cyan-500/20 text-cyan-400',
  task: 'bg-orange-500/20 text-orange-400',
  system: 'bg-zinc-500/20 text-zinc-400',
}

function formatTime(epoch: number): string {
  const d = new Date(epoch)
  return d.toTimeString().split(' ')[0] ?? ''
}

const PAGE_SIZE = 100

export function Logs() {
  const { t } = useI18n()
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Load date list
  useEffect(() => {
    getLogDates().then((d) => {
      setDates(d)
      if (d.length > 0 && !selectedDate) {
        setSelectedDate(d[0]!)
      }
    }).catch(() => {})
  }, [])

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Load logs
  const fetchEntries = useCallback(async (offset = 0, append = false) => {
    if (!selectedDate) return
    setLoading(true)
    try {
      const result = await getLogEntries(selectedDate, {
        level: level || undefined,
        category: category || undefined,
        search: debouncedSearch || undefined,
        offset,
        limit: PAGE_SIZE,
      })
      setEntries(prev => append ? [...prev, ...result.entries] : result.entries)
      setTotal(result.total)
      setHasMore(result.hasMore)
    } catch {
      if (!append) {
        setEntries([])
        setTotal(0)
        setHasMore(false)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedDate, level, category, debouncedSearch])

  // Reload on filter change
  useEffect(() => {
    setExpandedIdx(null)
    fetchEntries(0, false)
  }, [fetchEntries])

  const handleLoadMore = () => {
    fetchEntries(entries.length, true)
  }

  const categories = [
    { value: '', label: t.logs.allCategories },
    { value: 'agent', label: t.logs.categoryAgent },
    { value: 'tool_use', label: t.logs.categoryTool },
    { value: 'task', label: t.logs.categoryTask },
    { value: 'system', label: t.logs.categorySystem },
  ]

  const levels = [
    { value: '', label: t.logs.allLevels },
    { value: 'debug', label: 'DEBUG' },
    { value: 'info', label: 'INFO' },
    { value: 'warn', label: 'WARN' },
    { value: 'error', label: 'ERROR' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar: Title + filters */}
      <div className="p-4 pb-3 border-b border-border shrink-0 space-y-3">
        <h1 className="text-lg font-semibold">{t.logs.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date selector */}
          <select
            data-testid="logs-select-date"
            className="h-8 px-2 text-sm rounded-md border border-border bg-background"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          >
            {dates.length === 0 && <option value="">{t.logs.selectDate}</option>}
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Category button group */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {categories.map((c) => (
              <button
                key={c.value}
                data-testid={`logs-category-${c.value || 'all'}`}
                className={cn(
                  'px-3 h-8 text-xs transition-colors',
                  category === c.value
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50',
                )}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Level dropdown */}
          <select
            data-testid="logs-select-level"
            className="h-8 px-2 text-sm rounded-md border border-border bg-background"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            {levels.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>

          {/* Search box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              data-testid="logs-search"
              className="w-full h-8 pl-7 pr-3 text-sm rounded-md border border-border bg-background"
              placeholder={t.logs.searchLogs}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="rounded-lg border border-border bg-zinc-950 font-mono text-xs" data-testid="logs-list">
          {entries.length === 0 && !loading ? (
            <div className="text-muted-foreground text-center py-12">
              {t.logs.noLogs}
            </div>
          ) : (
            <div className="p-3 space-y-0">
              {entries.map((entry, idx) => {
                const levelLabel = LEVEL_LABELS[entry.level] ?? String(entry.level)
                const levelColor = LEVEL_COLORS[entry.level] ?? 'text-zinc-400'
                const cat = entry.category ?? 'system'
                const catColor = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.system
                const isExpanded = expandedIdx === idx

                return (
                  <div key={`${entry.time}-${idx}`}>
                    <div
                      className="flex items-start gap-2 py-0.5 leading-5 cursor-pointer hover:bg-zinc-900/50 rounded px-1 -mx-1"
                      onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                      }
                      <span className="text-zinc-500 shrink-0">{formatTime(entry.time)}</span>
                      <span className={cn('shrink-0 w-12', levelColor)}>{levelLabel}</span>
                      <span className={cn('shrink-0 px-1.5 py-0 rounded text-[10px]', catColor)}>
                        {cat}
                      </span>
                      {entry.agentId && (
                        <span className="text-zinc-500 shrink-0">{entry.agentId}</span>
                      )}
                      <span className="text-zinc-300 break-all flex-1">
                        {entry.msg}
                        {entry.durationMs != null && (
                          <span className="text-zinc-500 ml-2">({(entry.durationMs / 1000).toFixed(1)}s)</span>
                        )}
                        {entry.tool && !entry.msg.includes(entry.tool) && (
                          <span className="text-cyan-400 ml-2">{entry.tool}</span>
                        )}
                      </span>
                    </div>
                    {isExpanded && (
                      <pre className="ml-6 px-3 py-2 my-1 bg-zinc-900 rounded text-zinc-400 overflow-x-auto text-[11px] leading-relaxed">
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Bottom bar: Total + load more */}
        {entries.length > 0 && (
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>{total} {t.logs.totalEntries}</span>
            {hasMore && (
              <button
                data-testid="logs-load-more"
                className="px-3 py-1 rounded-md border border-border hover:bg-accent/50 text-sm"
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? '...' : t.logs.loadMore}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
