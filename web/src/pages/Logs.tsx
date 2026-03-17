import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { getLogDates, getLogEntries } from '../api/client'
import type { LogEntry } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { useLogSSE } from '../hooks/useLogSSE'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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

const LEVEL_MAP: Record<string, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
}

function formatTime(epoch: number): string {
  const d = new Date(epoch)
  return d.toTimeString().split(' ')[0] ?? ''
}

function getToday(): string {
  return new Date().toISOString().split('T')[0]!
}

const PAGE_SIZE = 100
const MAX_ENTRIES = 2000

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
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Scroll refs
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const initialLoadDone = useRef(false)
  // Track total entries fetched via pagination (desc order offset)
  const fetchedCountRef = useRef(0)

  const isToday = selectedDate === getToday()

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

  // Track if user is at bottom of scroll
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Initial load: fetch newest entries (desc order), then reverse for display (oldest on top, newest at bottom)
  const fetchEntries = useCallback(async () => {
    if (!selectedDate) return
    setLoading(true)
    initialLoadDone.current = false
    try {
      const result = await getLogEntries(selectedDate, {
        level: level || undefined,
        category: category || undefined,
        search: debouncedSearch || undefined,
        offset: 0,
        limit: PAGE_SIZE,
        order: 'desc',
      })
      // Reverse so display order is chronological (oldest first, newest at bottom)
      const reversed = [...result.entries].reverse()
      setEntries(reversed)
      setTotal(result.total)
      setHasMore(result.hasMore)
      fetchedCountRef.current = result.entries.length
      setExpandedIdx(null)

      // Scroll to bottom after render
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current
        if (container) {
          container.scrollTop = container.scrollHeight
          isAtBottomRef.current = true
        }
        initialLoadDone.current = true
      })
    } catch {
      setEntries([])
      setTotal(0)
      setHasMore(false)
      fetchedCountRef.current = 0
      initialLoadDone.current = true
    } finally {
      setLoading(false)
    }
  }, [selectedDate, level, category, debouncedSearch])

  // Reload on filter change
  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  // Load older entries (prepend to top)
  const loadOlder = useCallback(async () => {
    if (!selectedDate || !hasMore || loadingOlder) return
    setLoadingOlder(true)
    const container = scrollContainerRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0

    try {
      const result = await getLogEntries(selectedDate, {
        level: level || undefined,
        category: category || undefined,
        search: debouncedSearch || undefined,
        offset: fetchedCountRef.current,
        limit: PAGE_SIZE,
        order: 'desc',
      })
      // Reverse to chronological and prepend
      const older = [...result.entries].reverse()
      fetchedCountRef.current += result.entries.length
      setEntries(prev => [...older, ...prev])
      setHasMore(result.hasMore)

      // Restore scroll position after prepend
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight
          container.scrollTop = newScrollHeight - prevScrollHeight
        }
      })
    } catch {
      // Ignore errors
    } finally {
      setLoadingOlder(false)
    }
  }, [selectedDate, hasMore, loadingOlder, level, category, debouncedSearch])

  // IntersectionObserver to trigger loading older entries when scrolling to top
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const container = scrollContainerRef.current
    if (!sentinel || !container) return

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0]?.isIntersecting && hasMore && !loadingOlder && initialLoadDone.current) {
          loadOlder()
        }
      },
      { root: container, threshold: 0.1 },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadingOlder, loadOlder])

  // SSE: filter matching logic
  const matchesFilters = useCallback((entry: LogEntry): boolean => {
    if (level) {
      const minLevel = LEVEL_MAP[level] ?? 0
      if (entry.level < minLevel) return false
    }
    if (category) {
      const cat = entry.category ?? 'system'
      if (category === 'system' && entry.category) return false
      if (category !== 'system' && cat !== category) return false
    }
    if (debouncedSearch) {
      const s = debouncedSearch.toLowerCase()
      if (!JSON.stringify(entry).toLowerCase().includes(s)) return false
    }
    return true
  }, [level, category, debouncedSearch])

  // SSE: append new log entries
  const handleSSEEntry = useCallback((entry: LogEntry) => {
    if (!matchesFilters(entry)) return

    setEntries(prev => {
      const updated = [...prev, entry]
      // Enforce memory cap
      if (updated.length > MAX_ENTRIES) {
        return updated.slice(updated.length - MAX_ENTRIES)
      }
      return updated
    })
    setTotal(prev => prev + 1)

    // Auto-scroll if user is at bottom
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        const container = scrollContainerRef.current
        if (container) {
          container.scrollTop = container.scrollHeight
        }
      })
    }
  }, [matchesFilters])

  useLogSSE(isToday, handleSSEEntry)

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
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{t.logs.title}</h1>
          {isToday && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              {t.logs.live}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date selector */}
          <Select value={selectedDate} onValueChange={setSelectedDate}>
            <SelectTrigger data-testid="logs-select-date" className="h-8 w-auto min-w-[140px]">
              <SelectValue placeholder={t.logs.selectDate} />
            </SelectTrigger>
            <SelectContent>
              {dates.length === 0 && <SelectItem value="__none__">{t.logs.selectDate}</SelectItem>}
              {dates.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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
          <Select value={level || '__all__'} onValueChange={(v) => setLevel(v === '__all__' ? '' : v)}>
            <SelectTrigger data-testid="logs-select-level" className="h-8 w-auto min-w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l.value || '__all__'} value={l.value || '__all__'}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="rounded-lg border border-border bg-zinc-950 font-mono text-xs" data-testid="logs-list">
          {entries.length === 0 && !loading ? (
            <div className="text-muted-foreground text-center py-12">
              {t.logs.noLogs}
            </div>
          ) : (
            <div className="p-3 space-y-0">
              {/* Top sentinel for loading older entries */}
              <div ref={topSentinelRef} className="h-1" />
              {loadingOlder && (
                <div className="text-center text-muted-foreground py-2 text-[11px]">
                  {t.logs.loadOlder}
                </div>
              )}
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
              {/* Bottom anchor for auto-scroll */}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Bottom bar: Total */}
        {entries.length > 0 && (
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>{total} {t.logs.totalEntries}</span>
          </div>
        )}
      </div>
    </div>
  )
}
