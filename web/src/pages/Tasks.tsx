import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getTaskList,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  runScheduledTask,
  getScheduledTaskLogs,
  cloneScheduledTask,
  getAgents,
} from '../api/client'
import type { ScheduledTaskDTO, TaskRunLogDTO } from '../api/client'
import { cn } from '../lib/utils'
import { buildCronExpression, createDefaultCronDraft, parseCronExpression, type CronDraft, type CronMode } from '../lib/task-cron'
import { INTERVAL_UNITS, buildIntervalScheduleValue, formatIntervalLabel, parseIntervalScheduleValue, type IntervalUnit } from '../lib/task-interval'
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import { useDragRegion } from "@/hooks/useDragRegion"
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import {
  Clock,
  Plus,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  XCircle,
  Timer,
  CalendarClock,
  CalendarDays,
  Copy,
  Clock3,
  Pencil,
  PlayCircle,
} from 'lucide-react'

type Agent = { id: string; name: string }

function formatRelative(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const absDiff = Math.abs(diffMs)

  if (absDiff < 60_000) return diffMs > 0 ? 'in <1m' : '<1m ago'
  if (absDiff < 3_600_000) {
    const m = Math.round(absDiff / 60_000)
    return diffMs > 0 ? `in ${m}m` : `${m}m ago`
  }
  if (absDiff < 86_400_000) {
    const h = Math.round(absDiff / 3_600_000)
    return diffMs > 0 ? `in ${h}h` : `${h}h ago`
  }
  return date.toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function scheduleLabel(type: string, value: string): string {
  if (type === 'cron') return `cron: ${value}`
  if (type === 'interval') return formatIntervalLabel(value)
  if (type === 'once') return `once: ${new Date(value).toLocaleString()}`
  return value
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

// Convert ISO time to datetime-local format
function isoToDatetimeLocal(iso: string): string {
  try {
    return formatDatetimeLocal(new Date(iso))
  } catch {
    return iso
  }
}

function parseDatetimeLocal(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) return null
  return parsed
}

function createDefaultOnceDate(): Date {
  const next = new Date()
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)
  return next
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function shiftMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => pad2(hour))
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => pad2(minute))
const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, day) => String(day + 1))
const WHEEL_ITEM_HEIGHT = 40
const WHEEL_VISIBLE_ROWS = 5
const FORM_LABEL_CLASS = 'block text-sm font-medium text-foreground/90'
const FORM_LABEL_WITH_MARGIN_CLASS = `${FORM_LABEL_CLASS} mb-1.5`
const INLINE_FIELD_LABEL_CLASS = 'flex items-center gap-1 text-sm font-medium text-foreground/85'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    paused: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-zinc-500/20 text-zinc-400',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', colors[status] ?? 'bg-zinc-500/20 text-zinc-400')}>
      {status}
    </span>
  )
}

type PanelMode = 'view' | 'create' | 'edit'
type OnceMode = 'in5m' | 'in30m' | 'in1h' | 'tomorrow9' | 'custom' | null

function createInitialCronState(task?: ScheduledTaskDTO): {
  mode: CronMode
  draft: CronDraft
  customValue: string
} {
  if (task?.schedule_type !== 'cron') {
    return {
      mode: 'daily',
      draft: createDefaultCronDraft(),
      customValue: '',
    }
  }

  const parsed = parseCronExpression(task.schedule_value)
  if (parsed) {
    return {
      mode: parsed.mode,
      draft: parsed.draft,
      customValue: task.schedule_value,
    }
  }

  return {
    mode: 'custom',
    draft: createDefaultCronDraft(),
    customValue: task.schedule_value,
  }
}

function createRelativeOnceDate(minutesFromNow: number): Date {
  const next = new Date()
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + minutesFromNow)
  return next
}

function createTomorrowAtNine(): Date {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  return next
}

export function Tasks() {
  const { t } = useI18n()
  const drag = useDragRegion()
  const [tasks, setTasks] = useState<ScheduledTaskDTO[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TaskRunLogDTO[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('view')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null

  const loadTasks = useCallback(() => {
    getTaskList().then(setTasks).catch(() => {})
  }, [])

  useEffect(() => {
    loadTasks()
    getAgents().then((list) => setAgents(list.map((a) => ({ id: a.id, name: a.name })))).catch(() => {})
  }, [loadTasks])

  // Load logs when task is selected
  const selectTask = async (id: string) => {
    setSelectedId(id)
    setPanelMode('view')
    setLogsLoading(true)
    try {
      const data = await getScheduledTaskLogs(id)
      setLogs(data)
    } catch {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  const handleRun = async (id: string) => {
    await runScheduledTask(id).catch(() => {})
    loadTasks()
    // Refresh logs
    if (id === selectedId) {
      getScheduledTaskLogs(id).then(setLogs).catch(() => {})
    }
  }

  const handleTogglePause = async (task: ScheduledTaskDTO) => {
    const newStatus = task.status === 'active' ? 'paused' : 'active'
    await updateScheduledTask(task.id, { status: newStatus }).catch(() => {})
    loadTasks()
  }

  const handleDelete = async (id: string) => {
    await deleteScheduledTask(id).catch(() => {})
    if (selectedId === id) {
      setSelectedId(null)
      setPanelMode('view')
    }
    loadTasks()
  }

  const handleClone = async (id: string) => {
    try {
      const cloned = await cloneScheduledTask(id)
      loadTasks()
      setSelectedId(cloned.id)
      setPanelMode('view')
    } catch {
      return
    }
  }

  const agentName = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId)
    return a?.name ?? agentId
  }


  const handleCreateNew = () => {
    setSelectedId(null)
    setPanelMode('create')
  }

  return (
    <div className="flex h-full">
      {/* Left panel — Task list */}
      <SidePanel>
        <div className="h-9 shrink-0 px-3 border-b border-[var(--subtle-border)] flex items-center justify-between" {...drag}>
          <h2 className="font-semibold text-sm">{t.tasks.title}</h2>
          <button
            data-testid="task-create-btn"
            onClick={handleCreateNew}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
            title={t.tasks.createTask}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Clock className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">{t.tasks.noTasks}</p>
                <p className="text-xs mt-1">{t.tasks.noTasksHint}</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  data-testid="task-item"
                  onClick={() => selectTask(task.id)}
                  className={cn(
                    'px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/30',
                    selectedId === task.id && 'bg-accent/50'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate max-w-[180px]">
                      {task.name || task.prompt.slice(0, 40)}
                    </span>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{agentName(task.agent_id)}</span>
                    <span className="flex items-center gap-0.5">
                      <Timer className="h-3 w-3" />
                      {scheduleLabel(task.schedule_type, task.schedule_value)}
                    </span>
                  </div>
                  {!task.name && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">{task.prompt.slice(0, 60)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SidePanel>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {panelMode === 'create' ? (
          <TaskForm
            agents={agents}
            onSaved={() => {
              loadTasks()
              setPanelMode('view')
            }}
            onCancel={() => setPanelMode('view')}
          />
        ) : panelMode === 'edit' && selectedTask ? (
          <TaskForm
            agents={agents}
            task={selectedTask}
            onSaved={() => {
              loadTasks()
              setPanelMode('view')
            }}
            onCancel={() => setPanelMode('view')}
          />
        ) : selectedTask ? (
          <TaskDetail
            task={selectedTask}
            logs={logs}
            logsLoading={logsLoading}
            agentName={agentName(selectedTask.agent_id)}
            onEdit={() => setPanelMode('edit')}
            onClone={() => handleClone(selectedTask.id)}
            onTogglePause={() => handleTogglePause(selectedTask)}
            onRun={() => handleRun(selectedTask.id)}
            onDelete={() => setDeleteId(selectedTask.id)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <CalendarClock className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">{t.tasks.selectTask}</p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.tasks.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>{''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) handleDelete(deleteId); setDeleteId(null) }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== Task detail panel =====

function TaskDetail({
  task,
  logs,
  logsLoading,
  agentName,
  onEdit,
  onClone,
  onTogglePause,
  onRun,
  onDelete,
}: {
  task: ScheduledTaskDTO
  logs: TaskRunLogDTO[]
  logsLoading: boolean
  agentName: string
  onEdit: () => void
  onClone: () => void
  onTogglePause: () => void
  onRun: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="p-6 space-y-6">
      {/* Title + action buttons */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{task.name || t.tasks.noName}</h2>
          {task.description && <p className="text-sm text-muted-foreground mt-1">{task.description}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid="task-edit-btn"
            onClick={onEdit}
            className="p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t.common.edit}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            data-testid="task-clone-btn"
            onClick={onClone}
            className="p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t.tasks.clone}
          >
            <Copy className="h-4 w-4" />
          </button>
          {task.status !== 'completed' && (
            <button
              data-testid="task-pause-btn"
              onClick={onTogglePause}
              className="p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={task.status === 'active' ? t.tasks.disable : t.tasks.enable}
            >
              {task.status === 'active' ? <Pause className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            </button>
          )}
          <button
            data-testid="task-run-btn"
            onClick={onRun}
            className="p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t.tasks.runNow}
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            data-testid="task-delete-btn"
            onClick={onDelete}
            className="p-2 rounded hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-colors"
            title={t.common.delete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status info */}
      <div className="grid grid-cols-2 gap-4">
        <InfoField label={t.tasks.agent} value={agentName} />
        <InfoField label="Status">
          <StatusBadge status={task.status} />
        </InfoField>
        <InfoField label={t.tasks.schedule} value={scheduleLabel(task.schedule_type, task.schedule_value)} />
        <InfoField label={t.tasks.nextRun} value={formatRelative(task.next_run)} />
        <InfoField label={t.tasks.created} value={new Date(task.created_at).toLocaleString()} />
        <InfoField label={t.tasks.lastRun} value={task.last_run ? new Date(task.last_run).toLocaleString() : '-'} />
        <InfoField label={t.tasks.taskId} value={task.id} mono />
      </div>

      {/* Prompt */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">{t.tasks.prompt}</div>
        <div className="text-sm bg-accent/20 rounded p-3 border border-border whitespace-pre-wrap">{task.prompt}</div>
      </div>

      {/* Run history */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">{t.tasks.recentRuns}</div>
        {logsLoading ? (
          <div className="text-xs text-muted-foreground">{t.common.loading}</div>
        ) : logs.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t.tasks.noRuns}</div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {logs.slice(0, 20).map((log) => (
              <div
                key={log.id}
                data-testid="task-log-item"
                className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-accent/10 border border-border"
              >
                {log.status === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
                )}
                <span className="text-muted-foreground">{new Date(log.run_at).toLocaleString()}</span>
                <span className="text-muted-foreground">{formatDuration(log.duration_ms)}</span>
                {log.error && <span className="text-red-400 truncate flex-1">{log.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoField({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      {children ?? <div className={cn('text-sm', mono && 'font-mono text-xs')}>{value}</div>}
    </div>
  )
}

function WheelPicker({
  label,
  value,
  options,
  onChange,
  disabled,
  testIdPrefix,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
  testIdPrefix: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const index = options.indexOf(value)
    if (index === -1) return
    const targetTop = index * WHEEL_ITEM_HEIGHT
    if (Math.abs(container.scrollTop - targetTop) > 1) {
      container.scrollTo({ top: targetTop, behavior: 'auto' })
    }
  }, [options, value])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current)
      }
    }
  }, [])

  const commitFromScroll = () => {
    const container = containerRef.current
    if (!container) return
    const index = Math.max(0, Math.min(options.length - 1, Math.round(container.scrollTop / WHEEL_ITEM_HEIGHT)))
    const nextValue = options[index]
    if (nextValue && nextValue !== value) {
      onChange(nextValue)
    }
    container.scrollTo({ top: index * WHEEL_ITEM_HEIGHT, behavior: 'smooth' })
  }

  const handleScroll = () => {
    if (disabled) return
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current)
    }
    scrollTimerRef.current = window.setTimeout(() => {
      commitFromScroll()
    }, 80)
  }

  const handleClick = (nextValue: string) => {
    if (disabled) return
    onChange(nextValue)
    const index = options.indexOf(nextValue)
    if (index >= 0) {
      containerRef.current?.scrollTo({ top: index * WHEEL_ITEM_HEIGHT, behavior: 'smooth' })
    }
  }

  return (
    <div className="space-y-1.5">
      <div className={INLINE_FIELD_LABEL_CLASS}>
        <Clock3 className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div
        data-testid={testIdPrefix}
        data-value={value}
        className="relative"
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 rounded-md border border-primary/30 bg-primary/5" style={{ height: WHEEL_ITEM_HEIGHT }} />
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="relative h-[200px] overflow-y-auto rounded-md border border-input bg-background [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{
            paddingTop: `${((WHEEL_VISIBLE_ROWS - 1) / 2) * WHEEL_ITEM_HEIGHT}px`,
            paddingBottom: `${((WHEEL_VISIBLE_ROWS - 1) / 2) * WHEEL_ITEM_HEIGHT}px`,
          }}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`${testIdPrefix}-option-${option}`}
              aria-selected={value === option}
              onClick={() => handleClick(option)}
              disabled={disabled}
              className={cn(
                'flex w-full snap-center items-center justify-center text-base transition-colors',
                value === option ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
              style={{ height: WHEEL_ITEM_HEIGHT }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function OnceDateTimePicker({
  value,
  onChange,
  disabled,
  open,
  onOpenChange,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const initialValue = parseDatetimeLocal(value) ?? createDefaultOnceDate()
  const [selectedDate, setSelectedDate] = useState<Date>(initialValue)
  const [visibleMonth, setVisibleMonth] = useState<Date>(startOfMonth(initialValue))
  const [hour, setHour] = useState(() => pad2(initialValue.getHours()))
  const [minute, setMinute] = useState(() => pad2(initialValue.getMinutes()))

  const commit = (date: Date, nextHour: string, nextMinute: string) => {
    const next = new Date(date)
    next.setHours(Number(nextHour), Number(nextMinute), 0, 0)
    onChange(formatDatetimeLocal(next))
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return
    setSelectedDate(date)
    setVisibleMonth(startOfMonth(date))
    commit(date, hour, minute)
  }

  const handleHourChange = (nextHour: string) => {
    setHour(nextHour)
    commit(selectedDate, nextHour, minute)
  }

  const handleMinuteChange = (nextMinute: string) => {
    setMinute(nextMinute)
    commit(selectedDate, hour, nextMinute)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <Input
          data-testid="task-input-schedule"
          readOnly
          value={value || t.tasks.onceHelp}
          disabled={disabled}
          tabIndex={-1}
          className={cn(
            "cursor-default bg-accent/30 select-none",
            !value && "text-muted-foreground"
          )}
        />
      </PopoverAnchor>
      <PopoverContent
        data-testid="task-once-popover"
        align="end"
        side="top"
        sideOffset={10}
        alignOffset={4}
        collisionPadding={16}
        sticky="partial"
        className="w-[412px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-border/80 bg-background/95 p-0 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/90"
      >
        <div className="grid h-[312px] max-h-[calc(100vh-2rem)] grid-cols-[minmax(0,1fr)_144px] overflow-hidden">
          <div className="min-w-0 border-r border-border p-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4" />
              <span>{t.tasks.runAt}</span>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                data-testid="calendar-previous-month"
                onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent p-0 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-sm font-medium">
                {visibleMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
              </div>
              <button
                type="button"
                data-testid="calendar-next-month"
                onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent p-0 text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Calendar
              className="p-0"
              hideNavigation
              classNames={{
                month: "w-[248px] space-y-2",
                month_caption: "hidden",
                weekdays: "flex w-full",
                weekday: "w-8 text-[11px] font-normal text-muted-foreground",
                week: "mt-1.5 flex w-full",
                day: "h-8 w-8 p-0 text-center text-sm",
                day_button: "h-8 w-8 rounded-md p-0 font-normal aria-selected:opacity-100",
              }}
              mode="single"
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              selected={selectedDate}
              onSelect={handleDateSelect}
              dayButtonTestIdPrefix="task-once-day"
            />
          </div>

          <div className="flex min-w-0 flex-col bg-accent/10 p-3">
            <div className="grid grid-cols-2 gap-2">
              <WheelPicker
                label={t.tasks.hour}
                value={hour}
                options={HOUR_OPTIONS}
                onChange={handleHourChange}
                disabled={disabled}
                testIdPrefix="task-once-hour"
              />
              <WheelPicker
                label={t.tasks.minute}
                value={minute}
                options={MINUTE_OPTIONS}
                onChange={handleMinuteChange}
                disabled={disabled}
                testIdPrefix="task-once-minute"
              />
            </div>

            <div className="mt-auto">
              <Button type="button" size="sm" className="w-full" onClick={() => onOpenChange(false)}>
                {t.common.confirm}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CronFieldSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
  testId: string
}) {
  return (
    <div className="space-y-1.5">
      <label className={FORM_LABEL_CLASS}>{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger data-testid={testId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              data-testid={`${testId}-option-${option.value}`}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function CronPresetBuilder({
  mode,
  draft,
  customValue,
  onModeChange,
  onDraftChange,
  onCustomValueChange,
  disabled,
}: {
  mode: CronMode
  draft: CronDraft
  customValue: string
  onModeChange: (mode: CronMode) => void
  onDraftChange: (patch: Partial<CronDraft>) => void
  onCustomValueChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useI18n()

  const weekdayOptions = [
    { value: '1', label: t.tasks.weekdayMonday },
    { value: '2', label: t.tasks.weekdayTuesday },
    { value: '3', label: t.tasks.weekdayWednesday },
    { value: '4', label: t.tasks.weekdayThursday },
    { value: '5', label: t.tasks.weekdayFriday },
    { value: '6', label: t.tasks.weekdaySaturday },
    { value: '0', label: t.tasks.weekdaySunday },
  ]

  const cronPreview = buildCronExpression(mode === 'custom' ? 'daily' : mode, draft)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {([
          { mode: 'daily', label: t.tasks.cronDaily },
          { mode: 'weekly', label: t.tasks.cronWeekly },
          { mode: 'monthly', label: t.tasks.cronMonthly },
          { mode: 'custom', label: t.tasks.cronCustom },
        ] as const).map((option) => (
          <button
            key={option.mode}
            type="button"
            data-testid={`task-cron-mode-${option.mode}`}
            onClick={() => onModeChange(option.mode)}
            disabled={disabled}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs transition-colors',
              mode === option.mode
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-accent/20 text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'custom' ? (
        <div className="space-y-2">
          <Input
            data-testid="task-input-schedule"
            type="text"
            value={customValue}
            onChange={(e) => onCustomValueChange(e.target.value)}
            placeholder={t.tasks.cronPlaceholder}
            disabled={disabled}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">{t.tasks.cronCustomHelp}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={cn('grid gap-3', mode === 'daily' ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
            {mode === 'weekly' && (
              <CronFieldSelect
                label={t.tasks.weekday}
                value={draft.weekday}
                options={weekdayOptions}
                onChange={(weekday) => onDraftChange({ weekday })}
                disabled={disabled}
                testId="task-cron-weekday"
              />
            )}

            {mode === 'monthly' && (
              <CronFieldSelect
                label={t.tasks.dayOfMonth}
                value={draft.dayOfMonth}
                options={DAY_OF_MONTH_OPTIONS.map((day) => ({ value: day, label: day }))}
                onChange={(dayOfMonth) => onDraftChange({ dayOfMonth })}
                disabled={disabled}
                testId="task-cron-day"
              />
            )}

            <CronFieldSelect
              label={t.tasks.hour}
              value={draft.hour}
              options={HOUR_OPTIONS.map((hour) => ({ value: hour, label: hour }))}
              onChange={(hour) => onDraftChange({ hour })}
              disabled={disabled}
              testId="task-cron-hour"
            />

            <CronFieldSelect
              label={t.tasks.minute}
              value={draft.minute}
              options={MINUTE_OPTIONS.map((minute) => ({ value: minute, label: minute }))}
              onChange={(minute) => onDraftChange({ minute })}
              disabled={disabled}
              testId="task-cron-minute"
            />
          </div>

          <div className="rounded-md border border-dashed border-border bg-accent/10 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t.tasks.cronPreview}</div>
            <div data-testid="task-cron-preview" className="mt-1 font-mono text-sm">
              {cronPreview}
            </div>
          </div>
        </div>
      )}

      {mode !== 'custom' && (
        <p className="text-xs text-muted-foreground">{t.tasks.cronHelp}</p>
      )}
    </div>
  )
}

// ===== Task form (shared for create + edit) =====

function TaskForm({
  agents,
  task,
  onSaved,
  onCancel,
}: {
  agents: Agent[]
  task?: ScheduledTaskDTO
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const intervalUnitLabels: Record<IntervalUnit, string> = {
    minute: t.tasks.minute,
    hour: t.tasks.hour,
    day: t.tasks.day,
    week: t.tasks.week,
  }
  const isEdit = !!task
  const initialCronState = createInitialCronState(task)
  const initialIntervalInput = task?.schedule_type === 'interval'
    ? parseIntervalScheduleValue(task.schedule_value)
    : { value: '', unit: 'minute' as IntervalUnit }
  const initialScheduleType: 'cron' | 'interval' | 'once' =
    task?.schedule_type === 'cron' || task?.schedule_type === 'once'
      ? task.schedule_type
      : 'interval'

  const [name, setName] = useState(task?.name ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [agentId, setAgentId] = useState(task?.agent_id ?? agents[0]?.id ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>(initialScheduleType)
  const [scheduleValue, setScheduleValue] = useState(() => {
    if (!task) return ''
    if (task.schedule_type === 'interval') return initialIntervalInput.value
    if (task.schedule_type === 'once') return isoToDatetimeLocal(task.schedule_value)
    return ''
  })
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(initialIntervalInput.unit)
  const [cronMode, setCronMode] = useState<CronMode>(initialCronState.mode)
  const [cronDraft, setCronDraft] = useState<CronDraft>(initialCronState.draft)
  const [cronCustomValue, setCronCustomValue] = useState(initialCronState.customValue)
  const [onceMode, setOnceMode] = useState<OnceMode>(() =>
    task?.schedule_type === 'once' ? 'custom' : null
  )
  const [oncePickerOpen, setOncePickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const cronScheduleValue = cronMode === 'custom'
    ? cronCustomValue.trim()
    : buildCronExpression(cronMode, cronDraft)

  useEffect(() => {
    if (!isEdit && !agentId && agents[0]?.id) {
      setAgentId(agents[0].id)
    }
  }, [agentId, agents, isEdit])

  const applyOncePreset = (mode: Exclude<OnceMode, 'custom' | null>) => {
    const next =
      mode === 'in5m'
        ? createRelativeOnceDate(5)
        : mode === 'in30m'
          ? createRelativeOnceDate(30)
          : mode === 'in1h'
            ? createRelativeOnceDate(60)
            : createTomorrowAtNine()

    setOnceMode(mode)
    setOncePickerOpen(false)
    setScheduleValue(formatDatetimeLocal(next))
  }

  const openCustomOncePicker = () => {
    if (!scheduleValue) {
      setScheduleValue(formatDatetimeLocal(createDefaultOnceDate()))
    }
    setOnceMode('custom')
    setOncePickerOpen(true)
  }

  const handleCronModeChange = (mode: CronMode) => {
    if (mode === 'custom') {
      setCronCustomValue((current) => current || buildCronExpression(cronMode === 'custom' ? 'daily' : cronMode, cronDraft))
    }
    setCronMode(mode)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rawScheduleValue = scheduleType === 'cron' ? cronScheduleValue : scheduleValue

    if (!agentId || !prompt || !rawScheduleValue) {
      setError(t.tasks.allRequired)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      let finalValue = rawScheduleValue
      if (scheduleType === 'interval') {
        const intervalScheduleValue = buildIntervalScheduleValue(scheduleValue, intervalUnit)
        const intervalMs = intervalScheduleValue ? Number.parseInt(intervalScheduleValue, 10) : Number.NaN
        if (!intervalScheduleValue || Number.isNaN(intervalMs) || intervalMs < 60_000) {
          setError(t.tasks.invalidInterval)
          setSubmitting(false)
          return
        }
        finalValue = intervalScheduleValue
      }
      if (scheduleType === 'once') {
        const d = new Date(scheduleValue)
        if (isNaN(d.getTime())) {
          setError(t.tasks.invalidDate)
          setSubmitting(false)
          return
        }
        finalValue = d.toISOString()
      }

      if (isEdit && task) {
        await updateScheduledTask(task.id, {
          prompt,
          scheduleType,
          scheduleValue: finalValue,
          name: name || undefined,
          description: description || undefined,
        })
      } else {
        const chatId = `task:${crypto.randomUUID().slice(0, 8)}`
        await createScheduledTask({
          agentId,
          chatId,
          prompt,
          scheduleType,
          scheduleValue: finalValue,
          name: name || undefined,
          description: description || undefined,
        })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-4">{isEdit ? t.tasks.editTitle : t.tasks.createTitle}</h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        {/* Name */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>{t.tasks.name}</label>
          <input
            data-testid="task-input-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.tasks.namePlaceholder}
            className="w-full rounded-md border border-border bg-accent/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Description */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>{t.tasks.description}</label>
          <input
            data-testid="task-input-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.tasks.descriptionPlaceholder}
            className="w-full rounded-md border border-border bg-accent/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Agent (only selectable when creating) */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>{t.tasks.agent}</label>
          <Select
            value={agentId}
            onValueChange={setAgentId}
            disabled={isEdit}
          >
            <SelectTrigger data-testid="task-select-agent" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Prompt */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>{t.tasks.prompt}</label>
          <textarea
            data-testid="task-input-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t.tasks.promptPlaceholder}
            className="w-full resize-none rounded-md border border-border bg-accent/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Schedule Type */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>{t.tasks.scheduleType}</label>
          <div className="flex gap-2">
            {(['interval', 'cron', 'once'] as const).map((st) => (
              <button
                key={st}
                data-testid={`task-schedule-type-${st}`}
                type="button"
                onClick={() => {
                  setScheduleType(st)
                  setError('')
                  if (st === 'once') {
                    if (task?.schedule_type === 'once') {
                      setScheduleValue(isoToDatetimeLocal(task.schedule_value))
                      setOnceMode('custom')
                    } else {
                      setScheduleValue('')
                      setOnceMode(null)
                    }
                    setOncePickerOpen(false)
                    return
                  }
                  if (st === 'interval') {
                    const nextIntervalInput = task?.schedule_type === 'interval'
                      ? parseIntervalScheduleValue(task.schedule_value)
                      : { value: '', unit: 'minute' as IntervalUnit }
                    setScheduleValue(nextIntervalInput.value)
                    setIntervalUnit(nextIntervalInput.unit)
                  } else {
                    setScheduleValue('')
                  }
                  setOnceMode(null)
                  setOncePickerOpen(false)
                }}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md border transition-colors',
                  scheduleType === st
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-accent/30 border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {st === 'interval' ? t.tasks.interval : st === 'cron' ? t.tasks.cron : t.tasks.once}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule Value */}
        <div>
          <label className={FORM_LABEL_WITH_MARGIN_CLASS}>
            {scheduleType === 'interval' && t.tasks.interval}
            {scheduleType === 'cron' && t.tasks.cronExpression}
            {scheduleType === 'once' && t.tasks.runAt}
          </label>
          {scheduleType === 'once' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {([
                  { mode: 'in5m', label: t.tasks.onceQuick5m, testId: 'task-once-preset-5m' },
                  { mode: 'in30m', label: t.tasks.onceQuick30m, testId: 'task-once-preset-30m' },
                  { mode: 'in1h', label: t.tasks.onceQuick1h, testId: 'task-once-preset-1h' },
                  { mode: 'tomorrow9', label: t.tasks.onceQuickTomorrow9, testId: 'task-once-preset-tomorrow9' },
                ] as const).map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    data-testid={option.testId}
                    onClick={() => applyOncePreset(option.mode)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs transition-colors',
                      onceMode === option.mode
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-accent/20 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="task-once-preset-custom"
                  onClick={openCustomOncePicker}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs transition-colors',
                    onceMode === 'custom'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-accent/20 text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.tasks.onceQuickCustom}
                </button>
              </div>
              <OnceDateTimePicker
                key={scheduleValue || 'task-once-empty'}
                value={scheduleValue}
                onChange={setScheduleValue}
                disabled={submitting}
                open={oncePickerOpen}
                onOpenChange={setOncePickerOpen}
              />
            </div>
          ) : scheduleType === 'cron' ? (
            <CronPresetBuilder
              mode={cronMode}
              draft={cronDraft}
              customValue={cronCustomValue}
              onModeChange={handleCronModeChange}
              onDraftChange={(patch) => setCronDraft((current) => ({ ...current, ...patch }))}
              onCustomValueChange={setCronCustomValue}
              disabled={submitting}
            />
          ) : (
            <div className="flex gap-2">
              <input
                data-testid="task-input-schedule"
                type="number"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                inputMode="decimal"
                min="0"
                step="any"
                placeholder={t.tasks.intervalPlaceholder}
                className="flex-1 rounded-md border border-border bg-accent/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Select
                value={intervalUnit}
                onValueChange={(value) => setIntervalUnit(value as IntervalUnit)}
                disabled={submitting}
              >
                <SelectTrigger data-testid="task-select-interval-unit" className="w-[140px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVAL_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {intervalUnitLabels[unit]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {error && <p data-testid="task-form-error" className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            data-testid="task-submit-btn"
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? t.tasks.saving : isEdit ? t.common.save : t.common.create}
          </button>
          <button
            data-testid="task-cancel-btn"
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </form>
    </div>
  )
}
