import { Cron } from 'croner'
import {
  deleteTaskById,
  getTaskById,
  insertTaskRecord,
  listAllTasks,
  listTaskRunLogs,
  listTasks,
  listTasksByName,
  updateTaskById,
} from './repository.ts'
import type { ScheduledTask, TaskRunLog } from '../db/index.ts'
import { calculateTaskNextRun } from './schedule.ts'

export type TaskScheduleType = 'cron' | 'interval' | 'once'
export type TaskStatus = 'active' | 'paused' | 'completed'
export type DeliveryMode = 'push' | 'none'
export type TaskWriteAction = 'create' | 'update' | 'pause' | 'resume' | 'delete'

export interface TaskListFilters {
  chatId?: string
  name?: string
  status?: TaskStatus
  limit?: number
}

export interface CreateScheduledTaskInput {
  id?: string
  agentId: string
  chatId: string
  prompt: string
  scheduleType: TaskScheduleType
  scheduleValue: string
  name?: string
  description?: string
  timezone?: string | null
  deliveryMode?: DeliveryMode
  deliveryTarget?: string | null
}

export interface UpdateScheduledTaskInput {
  prompt?: string
  scheduleType?: TaskScheduleType
  scheduleValue?: string
  status?: TaskStatus
  name?: string
  description?: string
  timezone?: string | null
  deliveryMode?: DeliveryMode
  deliveryTarget?: string | null
}

export interface TaskActionInput {
  agentId: string
  action: TaskWriteAction
  chatId: string
  name: string
  prompt?: string
  scheduleType?: TaskScheduleType
  scheduleValue?: string
  description?: string
  timezone?: string | null
  deliveryMode?: DeliveryMode
  deliveryTarget?: string | null
}

export interface TaskActionResult {
  action: TaskWriteAction
  matchedTaskId: string
  task: ScheduledTask | null
}

export class TaskServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'TaskServiceError'
  }
}

function badRequest(message: string): never {
  throw new TaskServiceError(message, 400)
}

function notFound(message = 'Task not found'): never {
  throw new TaskServiceError(message, 404)
}

function conflict(message: string): never {
  throw new TaskServiceError(message, 409)
}

function requireTask(id: string): ScheduledTask {
  const task = getTaskById(id)
  if (!task) notFound()
  return task
}

function normalizeName(name: string): string {
  return name.trim()
}

function normalizeOptionalName(name?: string | null): string | null {
  if (name === undefined || name === null) return null
  const normalized = normalizeName(name)
  return normalized || null
}

function findTasksByName(agentId: string, chatId: string, name: string): ScheduledTask[] {
  return listTasksByName(agentId, chatId, name)
}

function ensureUniqueTaskName(
  agentId: string,
  chatId: string,
  name: string | null,
  options?: { excludeTaskId?: string },
): void {
  if (!name) return

  const duplicates = findTasksByName(agentId, chatId, name)
    .filter((task) => task.id !== options?.excludeTaskId)

  if (duplicates.length > 0) {
    conflict(`Task already exists for chat "${chatId}" with name "${name}"`)
  }
}

function validateDelivery(deliveryMode?: DeliveryMode, deliveryTarget?: string | null): void {
  if (deliveryMode === 'push' && !deliveryTarget) {
    badRequest('deliveryTarget is required when deliveryMode is "push"')
  }
}

function validateSchedule(
  scheduleType: TaskScheduleType,
  scheduleValue: string,
  timezone?: string | null,
): void {
  if (scheduleType === 'cron') {
    try {
      const opts: { timezone?: string } = {}
      if (timezone) opts.timezone = timezone
      new Cron(scheduleValue, opts)
      return
    } catch {
      badRequest('Invalid cron expression')
    }
  }

  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10)
    if (isNaN(ms) || ms < 60_000) {
      badRequest('Interval must be >= 60000ms')
    }
    return
  }

  const date = new Date(scheduleValue)
  if (isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    badRequest('once must be a future ISO date')
  }
}

function calculateManagedNextRun(
  scheduleType: TaskScheduleType,
  scheduleValue: string,
  lastRun: string | null,
  timezone?: string | null,
): string | null {
  if (scheduleType === 'once') return scheduleValue
  return calculateTaskNextRun({
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    last_run: lastRun,
    timezone,
  })
}

export function listTasksForAgent(agentId: string, filters: TaskListFilters = {}): ScheduledTask[] {
  const name = filters.name?.trim()
  return listTasks({
    agentId,
    chatId: filters.chatId,
    status: filters.status,
    name: name || undefined,
    limit: filters.limit,
  })
}

export function listScheduledTasks(limit?: number): ScheduledTask[] {
  return listAllTasks(limit)
}

export function getScheduledTask(id: string): ScheduledTask | null {
  return getTaskById(id)
}

export function getScheduledTaskRunLogs(taskId: string, limit?: number): TaskRunLog[] {
  return listTaskRunLogs(taskId, limit)
}

export function findTaskByName(agentId: string, chatId: string, name: string): ScheduledTask | null {
  const normalized = normalizeName(name)
  if (!normalized) return null

  const matches = findTasksByName(agentId, chatId, normalized)
  if (matches.length > 1) {
    conflict(`Multiple tasks exist for chat "${chatId}" with name "${normalized}"`)
  }
  return matches[0] ?? null
}

export function createScheduledTask(input: CreateScheduledTaskInput): ScheduledTask {
  const normalizedName = normalizeOptionalName(input.name)
  const deliveryMode = input.deliveryMode ?? 'none'
  const deliveryTarget = input.deliveryTarget ?? null

  ensureUniqueTaskName(input.agentId, input.chatId, normalizedName)
  validateDelivery(deliveryMode, deliveryTarget)
  validateSchedule(input.scheduleType, input.scheduleValue, input.timezone)

  const nextRun = calculateManagedNextRun(
    input.scheduleType,
    input.scheduleValue,
    null,
    input.timezone,
  )

  if (!nextRun) {
    badRequest('Invalid schedule value')
  }

  const id = input.id ?? crypto.randomUUID()
  insertTaskRecord({
    id,
    agentId: input.agentId,
    chatId: input.chatId,
    prompt: input.prompt,
    scheduleType: input.scheduleType,
    scheduleValue: input.scheduleValue,
    nextRun,
    name: normalizedName ?? undefined,
    description: input.description,
    timezone: input.timezone ?? undefined,
    deliveryMode,
    deliveryTarget: deliveryTarget ?? undefined,
  })
  return requireTask(id)
}

export function updateScheduledTaskById(id: string, updates: UpdateScheduledTaskInput): ScheduledTask {
  const existing = requireTask(id)
  const existingName = normalizeOptionalName(existing.name)
  const nextName = updates.name !== undefined ? normalizeOptionalName(updates.name) : existingName
  const deliveryMode = updates.deliveryMode ?? (existing.delivery_mode as DeliveryMode | null) ?? 'none'
  const deliveryTarget = updates.deliveryTarget !== undefined ? updates.deliveryTarget : existing.delivery_target

  validateDelivery(deliveryMode, deliveryTarget)
  if (updates.name !== undefined && nextName !== existingName) {
    ensureUniqueTaskName(existing.agent_id, existing.chat_id, nextName, { excludeTaskId: id })
  }

  const next: Parameters<typeof updateTaskById>[1] = {}

  if (updates.prompt !== undefined) next.prompt = updates.prompt
  if (updates.name !== undefined) next.name = nextName
  if (updates.description !== undefined) next.description = updates.description
  if (updates.timezone !== undefined) next.timezone = updates.timezone
  if (updates.deliveryMode !== undefined) next.deliveryMode = updates.deliveryMode
  if (updates.deliveryTarget !== undefined) next.deliveryTarget = updates.deliveryTarget
  if (updates.scheduleType !== undefined) next.scheduleType = updates.scheduleType
  if (updates.scheduleValue !== undefined) next.scheduleValue = updates.scheduleValue

  const scheduleType = (updates.scheduleType ?? existing.schedule_type) as TaskScheduleType
  const scheduleValue = updates.scheduleValue ?? existing.schedule_value
  const timezone = updates.timezone !== undefined ? updates.timezone : existing.timezone
  const scheduleChanged = updates.scheduleType !== undefined || updates.scheduleValue !== undefined || updates.timezone !== undefined

  if (scheduleChanged) {
    validateSchedule(scheduleType, scheduleValue, timezone)
    next.nextRun = calculateManagedNextRun(scheduleType, scheduleValue, existing.last_run, timezone)
  }

  if (updates.status !== undefined) {
    next.status = updates.status
    if (updates.status === 'completed') {
      next.nextRun = null
    }
    if (updates.status === 'active' && existing.status !== 'active') {
      if (existing.status === 'completed' && !scheduleChanged) {
        validateSchedule(scheduleType, scheduleValue, timezone)
      }
      next.consecutiveFailures = 0
      if (!scheduleChanged) {
        next.nextRun = calculateManagedNextRun(scheduleType, scheduleValue, existing.last_run, timezone)
      }
    }
  }

  if (Object.keys(next).length === 0) return existing

  updateTaskById(id, next)
  return requireTask(id)
}

export function pauseScheduledTaskById(id: string): ScheduledTask {
  return updateScheduledTaskById(id, { status: 'paused' })
}

export function resumeScheduledTaskById(id: string): ScheduledTask {
  const existing = requireTask(id)
  validateSchedule(
    existing.schedule_type as TaskScheduleType,
    existing.schedule_value,
    existing.timezone,
  )
  const nextRun = calculateManagedNextRun(
    existing.schedule_type as TaskScheduleType,
    existing.schedule_value,
    existing.last_run,
    existing.timezone,
  )

  updateTaskById(id, {
    status: 'active',
    nextRun,
    consecutiveFailures: 0,
  })
  return requireTask(id)
}

export function deleteScheduledTaskById(id: string): ScheduledTask {
  const existing = requireTask(id)
  deleteTaskById(id)
  return existing
}

export function cloneScheduledTaskById(id: string): ScheduledTask {
  const existing = requireTask(id)
  const newId = crypto.randomUUID()
  const chatId = `task:${newId.slice(0, 8)}`
  return createScheduledTask({
    id: newId,
    agentId: existing.agent_id,
    chatId,
    prompt: existing.prompt,
    scheduleType: existing.schedule_type as TaskScheduleType,
    scheduleValue: existing.schedule_value,
    name: existing.name ? `${existing.name} (copy)` : undefined,
    description: existing.description ?? undefined,
    timezone: existing.timezone,
    deliveryMode: (existing.delivery_mode as DeliveryMode | null) ?? undefined,
    deliveryTarget: existing.delivery_target,
  })
}

export function applyTaskAction(input: TaskActionInput): TaskActionResult {
  const name = normalizeName(input.name)
  if (!name) {
    badRequest('Task name is required')
  }

  const existing = findTaskByName(input.agentId, input.chatId, name)

  switch (input.action) {
    case 'create': {
      if (existing) {
        conflict(`Task already exists for chat "${input.chatId}" with name "${name}"`)
      }
      if (!input.prompt || !input.scheduleType || !input.scheduleValue) {
        badRequest('create action requires prompt, scheduleType, and scheduleValue')
      }
      const task = createScheduledTask({
        agentId: input.agentId,
        chatId: input.chatId,
        prompt: input.prompt,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        name,
        description: input.description,
        timezone: input.timezone,
        deliveryMode: input.deliveryMode,
        deliveryTarget: input.deliveryTarget,
      })
      return { action: input.action, matchedTaskId: task.id, task }
    }
    case 'update': {
      if (!existing) {
        notFound(`Task not found for chat "${input.chatId}" with name "${name}"`)
      }
      if (
        input.prompt === undefined &&
        input.scheduleType === undefined &&
        input.scheduleValue === undefined &&
        input.description === undefined &&
        input.timezone === undefined &&
        input.deliveryMode === undefined &&
        input.deliveryTarget === undefined
      ) {
        badRequest('update action requires at least one mutable field (prompt/schedule/timezone/delivery)')
      }
      const task = updateScheduledTaskById(existing.id, {
        prompt: input.prompt,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        description: input.description,
        timezone: input.timezone,
        deliveryMode: input.deliveryMode,
        deliveryTarget: input.deliveryTarget,
      })
      return { action: input.action, matchedTaskId: task.id, task }
    }
    case 'pause': {
      if (!existing) {
        notFound(`Task not found for chat "${input.chatId}" with name "${name}"`)
      }
      const task = pauseScheduledTaskById(existing.id)
      return { action: input.action, matchedTaskId: task.id, task }
    }
    case 'resume': {
      if (!existing) {
        notFound(`Task not found for chat "${input.chatId}" with name "${name}"`)
      }
      const task = resumeScheduledTaskById(existing.id)
      return { action: input.action, matchedTaskId: task.id, task }
    }
    case 'delete': {
      if (!existing) {
        notFound(`Task not found for chat "${input.chatId}" with name "${name}"`)
      }
      deleteScheduledTaskById(existing.id)
      return { action: input.action, matchedTaskId: existing.id, task: null }
    }
    default:
      badRequest(`Unsupported task action: ${String(input.action)}`)
  }
}
