import { beforeEach, describe, expect, test } from 'bun:test'
import './setup.ts'
import { cleanTables } from './setup.ts'
import { createTask, updateTask } from '../src/db/index.ts'
import {
  deleteTaskRunLogsOlderThan,
  insertTaskRunLog,
  listAllTasks,
  listDueTasks,
  listStuckTasks,
  listTaskRunLogs,
  listTasks,
  listTasksByName,
} from '../src/task/repository.ts'

beforeEach(() => cleanTables('scheduled_tasks', 'task_run_logs'))

describe('task repository listTasks', () => {
  test('filters by agent/chat/status/name and applies limit in SQL-facing query API', () => {
    createTask({
      id: 'repo-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Daily Summary',
    })
    createTask({
      id: 'repo-2',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Other Task',
    })
    createTask({
      id: 'repo-3',
      agentId: 'agent-1',
      chatId: 'chat-2',
      prompt: 'third',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Daily Summary',
    })
    createTask({
      id: 'repo-4',
      agentId: 'agent-2',
      chatId: 'chat-1',
      prompt: 'fourth',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Daily Summary',
    })
    updateTask('repo-2', { status: 'paused' })

    const filtered = listTasks({
      agentId: 'agent-1',
      chatId: 'chat-1',
      status: 'active',
      name: 'Daily Summary',
      limit: 10,
    })

    expect(filtered.map((task) => task.id)).toEqual(['repo-1'])
  })

  test('supports exact-name filters and orders by created_at desc', async () => {
    createTask({
      id: 'repo-order-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Trimmed Name',
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    createTask({
      id: 'repo-order-2',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Trimmed Name',
    })

    const filtered = listTasks({
      agentId: 'agent-1',
      name: '  Trimmed Name  '.trim(),
      limit: 1,
    })

    expect(filtered.length).toBe(1)
    expect(filtered[0]?.id).toBe('repo-order-2')
  })

  test('listAllTasks returns all tasks in created_at desc order', async () => {
    createTask({
      id: 'repo-all-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    createTask({
      id: 'repo-all-2',
      agentId: 'agent-2',
      chatId: 'chat-2',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })

    expect(listAllTasks().map((task) => task.id)).toEqual(['repo-all-2', 'repo-all-1'])
    expect(listAllTasks(1).map((task) => task.id)).toEqual(['repo-all-2'])
  })

  test('listTasksByName returns all duplicates for conflict detection', () => {
    createTask({
      id: 'repo-name-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Duplicate Name',
    })
    createTask({
      id: 'repo-name-2',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'second',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Duplicate Name',
    })

    expect(listTasksByName('agent-1', 'chat-1', 'Duplicate Name').map((task) => task.id).sort()).toEqual([
      'repo-name-1',
      'repo-name-2',
    ])
  })
})

describe('task repository scheduling and logs', () => {
  test('listDueTasks and listStuckTasks query the expected task subsets', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    const oldRunning = new Date(Date.now() - 10 * 60_000).toISOString()

    createTask({
      id: 'repo-due-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'due',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: past,
    })
    createTask({
      id: 'repo-due-2',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'future',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: future,
    })
    createTask({
      id: 'repo-stuck-1',
      agentId: 'agent-1',
      chatId: 'chat-1',
      prompt: 'stuck',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: future,
    })
    updateTask('repo-stuck-1', { runningSince: oldRunning })

    expect(listDueTasks(new Date().toISOString()).map((task) => task.id)).toEqual(['repo-due-1'])
    expect(listStuckTasks(new Date(Date.now() - 5 * 60_000).toISOString()).map((task) => task.id)).toEqual(['repo-stuck-1'])
  })

  test('task run log repository methods preserve order and support pruning', () => {
    insertTaskRunLog({
      taskId: 'repo-log-1',
      runAt: '2026-03-10T10:00:00.000Z',
      durationMs: 100,
      status: 'success',
      result: 'ok',
      deliveryStatus: 'sent',
    })
    insertTaskRunLog({
      taskId: 'repo-log-1',
      runAt: '2026-03-11T10:00:00.000Z',
      durationMs: 200,
      status: 'error',
      error: 'boom',
      deliveryStatus: 'skipped',
    })

    const logs = listTaskRunLogs('repo-log-1')
    expect(logs.map((log) => log.run_at)).toEqual([
      '2026-03-11T10:00:00.000Z',
      '2026-03-10T10:00:00.000Z',
    ])

    const deleted = deleteTaskRunLogsOlderThan('2026-03-11T00:00:00.000Z')
    expect(deleted).toBe(1)
    expect(listTaskRunLogs('repo-log-1').length).toBe(1)
  })
})
