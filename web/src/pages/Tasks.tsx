import { useState, useEffect, useCallback } from 'react'
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
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import {
  Clock,
  Plus,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  XCircle,
  Timer,
  CalendarClock,
  Copy,
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
  if (type === 'interval') {
    const ms = parseInt(value, 10)
    if (ms < 60_000) return `every ${ms / 1000}s`
    if (ms < 3_600_000) return `every ${ms / 60_000}m`
    return `every ${ms / 3_600_000}h`
  }
  if (type === 'once') return `once: ${new Date(value).toLocaleString()}`
  return value
}

// 将毫秒转回分钟（用于 interval 编辑时回显）
function msToMinutes(ms: string): string {
  const n = parseInt(ms, 10)
  if (isNaN(n)) return ms
  return String(n / 60_000)
}

// 将 ISO 时间转为 datetime-local 格式
function isoToDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

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

export function Tasks() {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<ScheduledTaskDTO[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TaskRunLogDTO[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('view')

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null

  const loadTasks = useCallback(() => {
    getTaskList().then(setTasks).catch(() => {})
  }, [])

  useEffect(() => {
    loadTasks()
    getAgents().then((list) => setAgents(list.map((a) => ({ id: a.id, name: a.name })))).catch(() => {})
  }, [loadTasks])

  // 选中任务时加载日志
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
    // 刷新日志
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
    if (!confirm(t.tasks.confirmDelete)) return
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
    } catch {}
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
      {/* 左面板 — 任务列表 */}
      <SidePanel>
        <div className="h-12 shrink-0 px-3 border-b border-[var(--subtle-border)] flex items-center justify-between">
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

        {/* 任务列表 */}
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

      {/* 右面板 */}
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
            onDelete={() => handleDelete(selectedTask.id)}
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
    </div>
  )
}

// ===== 任务详情面板 =====

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
      {/* 标题 + 操作按钮 */}
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

      {/* 状态信息 */}
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

      {/* 运行记录 */}
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

// ===== 任务表单（新建 + 编辑共用） =====

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
  const isEdit = !!task

  const [name, setName] = useState(task?.name ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [agentId, setAgentId] = useState(task?.agent_id ?? agents[0]?.id ?? '')
  const [prompt, setPrompt] = useState(task?.prompt ?? '')
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>(
    (task?.schedule_type as any) ?? 'interval'
  )
  const [scheduleValue, setScheduleValue] = useState(() => {
    if (!task) return ''
    if (task.schedule_type === 'interval') return msToMinutes(task.schedule_value)
    if (task.schedule_type === 'once') return isoToDatetimeLocal(task.schedule_value)
    return task.schedule_value
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!agentId || !prompt || !scheduleValue) {
      setError(t.tasks.allRequired)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      let finalValue = scheduleValue
      if (scheduleType === 'interval') {
        const mins = parseFloat(scheduleValue)
        if (isNaN(mins) || mins <= 0) {
          setError(t.tasks.invalidInterval)
          setSubmitting(false)
          return
        }
        finalValue = String(Math.round(mins * 60_000))
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
          <label className="block text-xs text-muted-foreground mb-1">{t.tasks.name}</label>
          <input
            data-testid="task-input-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.tasks.namePlaceholder}
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t.tasks.description}</label>
          <input
            data-testid="task-input-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.tasks.descriptionPlaceholder}
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Agent (仅新建时可选) */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t.tasks.agent}</label>
          <select
            data-testid="task-select-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isEdit}
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t.tasks.prompt}</label>
          <textarea
            data-testid="task-input-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t.tasks.promptPlaceholder}
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        {/* Schedule Type */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t.tasks.scheduleType}</label>
          <div className="flex gap-2">
            {(['interval', 'cron', 'once'] as const).map((st) => (
              <button
                key={st}
                data-testid={`task-schedule-type-${st}`}
                type="button"
                onClick={() => {
                  setScheduleType(st)
                  setScheduleValue('')
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
          <label className="block text-xs text-muted-foreground mb-1">
            {scheduleType === 'interval' && t.tasks.intervalMinutes}
            {scheduleType === 'cron' && t.tasks.cronExpression}
            {scheduleType === 'once' && t.tasks.runAt}
          </label>
          <input
            data-testid="task-input-schedule"
            type={scheduleType === 'once' ? 'datetime-local' : 'text'}
            value={scheduleValue}
            onChange={(e) => setScheduleValue(e.target.value)}
            placeholder={
              scheduleType === 'interval'
                ? t.tasks.intervalPlaceholder
                : scheduleType === 'cron'
                  ? t.tasks.cronPlaceholder
                  : ''
            }
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {scheduleType === 'cron' && (
            <p className="text-xs text-muted-foreground mt-1">{t.tasks.cronHelp}</p>
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
