import { useState, useEffect, useRef, useCallback } from 'react'
import { Clock, Bot, Send, Database, Server, Cpu, HardDrive, Calendar } from 'lucide-react'
import { getSystemStatus } from '../api/system'
import type { SystemStatus } from '../api/system'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'

// --- Utility functions ---

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

// --- SSE log event types ---

interface LogEntry {
  id: number
  time: string
  eventType: string
  content: string
}

// --- Components ---

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  status?: 'ok' | 'warn' | 'off'
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3" data-testid="status-card">
      <div
        className={cn(
          'w-9 h-9 rounded-md flex items-center justify-center shrink-0',
          status === 'ok'
            ? 'bg-green-500/15 text-green-400'
            : status === 'warn'
              ? 'bg-yellow-500/15 text-yellow-400'
              : status === 'off'
                ? 'bg-zinc-500/15 text-zinc-400'
                : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export function System() {
  const { t } = useI18n()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logIdRef = useRef(0)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Fetch system status
  const fetchStatus = useCallback(() => {
    getSystemStatus().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Connect to SSE log stream
  useEffect(() => {
    const es = new EventSource('/api/stream/system')
    eventSourceRef.current = es

    const handleEvent = (e: Event) => {
      try {
        const me = e as MessageEvent
        const data = JSON.parse(me.data) as Record<string, unknown>
        logIdRef.current += 1
        const entry: LogEntry = {
          id: logIdRef.current,
          time: new Date().toLocaleTimeString(),
          eventType: (data.type as string) ?? e.type,
          content: summarizeEvent(data),
        }
        setLogs((prev) => {
          const next = [...prev, entry]
          // Keep last 200 entries
          return next.length > 200 ? next.slice(-200) : next
        })
      } catch {
        // ignore parse errors
      }
    }

    es.addEventListener('stream', handleEvent)
    es.addEventListener('complete', handleEvent)
    es.addEventListener('error', handleEvent)
    es.addEventListener('processing', handleEvent)
    es.addEventListener('tool_use', handleEvent)
    es.addEventListener('document_status', handleEvent)
    es.addEventListener('connected', handleEvent)

    es.onerror = () => {
      // EventSource auto-reconnects
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [])

  // Auto-scroll to latest log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  if (!status) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Server className="h-5 w-5 animate-pulse mr-2" />
        {t.system.loadingStatus}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top: Status cards */}
      <div className="p-4 pb-2 border-b border-border shrink-0" data-testid="system-status">
        <h1 className="text-lg font-semibold mb-3">{t.system.title}</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatusCard
            icon={Clock}
            label={t.system.uptime}
            value={formatUptime(status.uptime)}
            status="ok"
          />
          <StatusCard
            icon={Bot}
            label={t.system.agents}
            value={`${status.agents.active} / ${status.agents.total}`}
            sub={`${status.agents.active} ${t.system.active}`}
            status={status.agents.total > 0 ? 'ok' : 'warn'}
          />
          <StatusCard
            icon={Send}
            label={t.system.channels}
            value={
              status.channels && status.channels.length > 0
                ? `${status.channels.filter((c) => c.connected).length} / ${status.channels.length}`
                : status.telegram.connected ? t.system.connected : t.system.disconnected
            }
            sub={
              status.channels && status.channels.length > 0
                ? status.channels.map((c) => c.name).join(', ')
                : undefined
            }
            status={
              status.channels && status.channels.some((c) => c.connected)
                ? 'ok'
                : status.telegram.connected ? 'ok' : 'off'
            }
          />
          <StatusCard
            icon={Database}
            label={t.system.database}
            value={formatBytes(status.database.sizeBytes)}
            status="ok"
          />
        </div>
      </div>

      {/* Middle: Live log stream */}
      <div className="flex-1 flex flex-col min-h-0 p-4 pb-2">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">{t.system.liveEvents}</h2>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-zinc-950 font-mono text-xs p-3">
          {logs.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              {t.system.waitingEvents}
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2 py-0.5 leading-5">
                <span className="text-zinc-500 shrink-0">{log.time}</span>
                <span
                  className={cn(
                    'shrink-0 w-20 text-right',
                    log.eventType === 'error'
                      ? 'text-red-400'
                      : log.eventType === 'complete'
                        ? 'text-green-400'
                        : log.eventType === 'processing'
                          ? 'text-yellow-400'
                          : log.eventType === 'document_status'
                            ? 'text-cyan-400'
                          : log.eventType === 'tool_use'
                            ? 'text-blue-400'
                            : 'text-zinc-400',
                  )}
                >
                  {log.eventType}
                </span>
                <span className="text-zinc-300 break-all">{log.content}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Bottom: System info */}
      <div className="p-4 pt-2 border-t border-border shrink-0">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <InfoItem icon={Cpu} label={t.system.platform} value={status.platform} />
          <InfoItem icon={Server} label={t.system.runtime} value={status.nodeVersion} />
          <InfoItem icon={HardDrive} label={t.system.dbPath} value={status.database.path} />
          <InfoItem icon={Calendar} label={t.system.startedAt} value={formatTime(status.startedAt)} />
        </div>
      </div>
    </div>
  )
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <span className="text-muted-foreground">{label}: </span>
        <span className="text-foreground truncate">{value}</span>
      </div>
    </div>
  )
}

function summarizeEvent(data: Record<string, unknown>): string {
  const type = data.type as string | undefined
  const agentId = data.agentId as string | undefined
  const chatId = data.chatId as string | undefined
  const prefix = agentId ? `[${agentId}]` : ''

  switch (type) {
    case 'stream':
      return `${prefix} streaming to ${chatId ?? 'unknown'}`
    case 'complete':
      return `${prefix} completed response for ${chatId ?? 'unknown'}`
    case 'error':
      return `${prefix} ${(data.error as string) ?? 'unknown error'}`
    case 'processing':
      return `${prefix} ${(data.isProcessing as boolean) ? 'started' : 'finished'} processing ${chatId ?? ''}`
    case 'tool_use':
      return `${prefix} using tool: ${(data.tool as string) ?? 'unknown'}`
    case 'document_status': {
      const filename = (data.filename as string) ?? 'unknown document'
      const status = (data.status as string) ?? 'unknown'
      const error = (data.error as string | undefined)
      return `${prefix} document ${filename} -> ${status}${error ? ` (${error})` : ''}`
    }
    case 'connected':
      return 'SSE connection established'
    default:
      return JSON.stringify(data).slice(0, 120)
  }
}
