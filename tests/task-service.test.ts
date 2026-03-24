import { beforeEach, describe, expect, test } from 'bun:test'
import './setup.ts'
import { cleanTables } from './setup.ts'
import { createTask, getTask } from '../src/db/index.ts'
import {
  TaskServiceError,
  applyTaskAction,
  createScheduledTask,
  listTasksForAgent,
  updateScheduledTaskById,
} from '../src/task/index.ts'

beforeEach(() => cleanTables('scheduled_tasks', 'task_run_logs'))

describe('task service', () => {
  test('listTasksForAgent filters by agent and chat', () => {
    createScheduledTask({
      id: 'svc-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'report',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Daily Report',
    })
    createScheduledTask({
      id: 'svc-2',
      agentId: 'agent-1',
      chatId: 'chat-2',
      prompt: 'digest',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      name: 'Morning Digest',
    })
    createScheduledTask({
      id: 'svc-3',
      agentId: 'agent-2',
      chatId: 'chat-1',
      prompt: 'other',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Other Agent Task',
    })

    expect(listTasksForAgent('agent-1').map((task) => task.id).sort()).toEqual(['svc-1', 'svc-2'])
    expect(listTasksForAgent('agent-1', { chatId: 'chat-1' }).map((task) => task.id)).toEqual(['svc-1'])
  })

  test('applyTaskAction create/update/pause/resume/delete uses chat+name identity', () => {
    const created = applyTaskAction({
      agentId: 'agent-1',
      action: 'create',
      chatId: 'chat-1',
      name: 'Daily Summary',
      prompt: 'summarize today',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
    })

    expect(created.action).toBe('create')
    expect(created.task?.name).toBe('Daily Summary')

    const updated = applyTaskAction({
      agentId: 'agent-1',
      action: 'update',
      chatId: 'chat-1',
      name: 'Daily Summary',
      prompt: 'summarize today in one paragraph',
      scheduleType: 'interval',
      scheduleValue: '120000',
      description: 'Updated by tool',
    })

    expect(updated.task?.prompt).toBe('summarize today in one paragraph')
    expect(updated.task?.schedule_value).toBe('120000')
    expect(updated.task?.description).toBe('Updated by tool')

    const paused = applyTaskAction({
      agentId: 'agent-1',
      action: 'pause',
      chatId: 'chat-1',
      name: 'Daily Summary',
    })
    expect(paused.task?.status).toBe('paused')

    const resumed = applyTaskAction({
      agentId: 'agent-1',
      action: 'resume',
      chatId: 'chat-1',
      name: 'Daily Summary',
    })
    expect(resumed.task?.status).toBe('active')
    expect(resumed.task?.next_run).not.toBeNull()

    const removed = applyTaskAction({
      agentId: 'agent-1',
      action: 'delete',
      chatId: 'chat-1',
      name: 'Daily Summary',
    })
    expect(removed.task).toBeNull()
    expect(getTask(created.matchedTaskId)).toBeNull()
  })

  test('create action rejects duplicate chat+name combinations', () => {
    applyTaskAction({
      agentId: 'agent-1',
      action: 'create',
      chatId: 'chat-1',
      name: 'Daily Summary',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
    })

    expect(() => applyTaskAction({
      agentId: 'agent-1',
      action: 'create',
      chatId: 'chat-1',
      name: 'Daily Summary',
      prompt: 'duplicate',
      scheduleType: 'interval',
      scheduleValue: '60000',
    })).toThrow(TaskServiceError)
  })

  test('createScheduledTask rejects duplicate names within the same chat', () => {
    createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Daily Summary',
    })

    expect(() => createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Daily Summary',
    })).toThrow(TaskServiceError)
  })

  test('updateScheduledTaskById rejects renaming to another task name in the same chat', () => {
    const taskA = createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Task A',
    })
    createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Task B',
    })

    expect(() => updateScheduledTaskById(taskA.id, { name: 'Task B' })).toThrow(TaskServiceError)
  })

  test('updateScheduledTaskById validates the final delivery state', () => {
    const task = createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'push me',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Push Task',
      deliveryMode: 'push',
      deliveryTarget: 'tg:123',
    })

    expect(() => updateScheduledTaskById(task.id, { deliveryTarget: null })).toThrow(TaskServiceError)

    const updated = updateScheduledTaskById(task.id, {
      deliveryMode: 'none',
      deliveryTarget: null,
    })
    expect(updated.delivery_mode).toBe('none')
    expect(updated.delivery_target).toBeNull()
  })

  test('completed interval task can be reactivated with a next_run', () => {
    const task = createScheduledTask({
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'reactivate me',
      scheduleType: 'interval',
      scheduleValue: '60000',
      name: 'Reactivatable Task',
    })

    const completed = updateScheduledTaskById(task.id, { status: 'completed' })
    expect(completed.status).toBe('completed')
    expect(completed.next_run).toBeNull()

    const reactivated = updateScheduledTaskById(task.id, { status: 'active' })
    expect(reactivated.status).toBe('active')
    expect(reactivated.next_run).not.toBeNull()
  })

  test('completed once task with a past schedule cannot be reactivated without a new future schedule', () => {
    const pastIso = new Date(Date.now() - 60_000).toISOString()
    createTask({
      id: 'completed-once-past',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'already ran',
      scheduleType: 'once',
      scheduleValue: pastIso,
      nextRun: pastIso,
      name: 'Past Once Task',
    })
    updateScheduledTaskById('completed-once-past', { status: 'completed' })

    expect(() => updateScheduledTaskById('completed-once-past', { status: 'active' })).toThrow(TaskServiceError)
  })

  test('same name in different chats is allowed', () => {
    applyTaskAction({
      agentId: 'agent-1',
      action: 'create',
      chatId: 'chat-1',
      name: 'Daily Summary',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
    })
    applyTaskAction({
      agentId: 'agent-1',
      action: 'create',
      chatId: 'chat-2',
      name: 'Daily Summary',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
    })

    expect(listTasksForAgent('agent-1', { name: 'Daily Summary' }).length).toBe(2)
  })

  test('applyTaskAction rejects ambiguous legacy duplicates by name', () => {
    createTask({
      id: 'legacy-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first legacy task',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Legacy Duplicate',
    })
    createTask({
      id: 'legacy-2',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second legacy task',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Legacy Duplicate',
    })

    expect(() => applyTaskAction({
      agentId: 'agent-1',
      action: 'update',
      chatId: 'chat-1',
      name: 'Legacy Duplicate',
      prompt: 'should not know which one to edit',
    })).toThrow(TaskServiceError)
  })
})
