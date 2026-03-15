/**
 * Database scheduled task CRUD tests
 *
 * Covers createTask / getTask / getTasks / updateTask / deleteTask / getTasksDueBy
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { cleanTables } from './setup.ts'
import {
  createTask,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  getTasksDueBy,
  saveTaskRunLog,
  getTaskRunLogs,
} from '../src/db/index.ts'

describe('createTask', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('without name/description, fields are null', () => {
    createTask({
      id: 'ct-1',
      agentId: 'agent-1',
      chatId: 'task:abc',
      prompt: 'do something',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })

    const task = getTask('ct-1')
    expect(task).not.toBeNull()
    expect(task!.name).toBeNull()
    expect(task!.description).toBeNull()
    expect(task!.status).toBe('active')
  })

  test('with name and description provided', () => {
    createTask({
      id: 'ct-2',
      agentId: 'agent-1',
      chatId: 'task:def',
      prompt: 'do something',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      nextRun: new Date().toISOString(),
      name: 'Daily Report',
      description: 'Generate daily report every morning at 9am',
    })

    const task = getTask('ct-2')
    expect(task!.name).toBe('Daily Report')
    expect(task!.description).toBe('Generate daily report every morning at 9am')
    expect(task!.schedule_type).toBe('cron')
    expect(task!.schedule_value).toBe('0 9 * * *')
  })

  test('with only name and no description', () => {
    createTask({
      id: 'ct-3',
      agentId: 'agent-1',
      chatId: 'task:ghi',
      prompt: 'check health',
      scheduleType: 'interval',
      scheduleValue: '300000',
      nextRun: new Date().toISOString(),
      name: 'Health Check',
    })

    const task = getTask('ct-3')
    expect(task!.name).toBe('Health Check')
    expect(task!.description).toBeNull()
  })

  test('created_at is automatically set', () => {
    const before = new Date().toISOString()
    createTask({
      id: 'ct-4',
      agentId: 'agent-1',
      chatId: 'task:jkl',
      prompt: 'test',
      scheduleType: 'once',
      scheduleValue: new Date().toISOString(),
      nextRun: new Date().toISOString(),
    })
    const after = new Date().toISOString()

    const task = getTask('ct-4')
    expect(task!.created_at >= before).toBe(true)
    expect(task!.created_at <= after).toBe(true)
  })
})

describe('getTask', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('existing task returns complete object', () => {
    createTask({
      id: 'gt-1',
      agentId: 'agent-x',
      chatId: 'task:gt',
      prompt: 'test prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: '2026-03-10T10:00:00.000Z',
      name: 'Test',
      description: 'Description',
    })

    const task = getTask('gt-1')!
    expect(task.id).toBe('gt-1')
    expect(task.agent_id).toBe('agent-x')
    expect(task.chat_id).toBe('task:gt')
    expect(task.prompt).toBe('test prompt')
    expect(task.schedule_type).toBe('interval')
    expect(task.schedule_value).toBe('60000')
    expect(task.next_run).toBe('2026-03-10T10:00:00.000Z')
    expect(task.last_run).toBeNull()
    expect(task.status).toBe('active')
    expect(task.name).toBe('Test')
    expect(task.description).toBe('Description')
  })

  test('non-existent task returns null', () => {
    expect(getTask('non-existent')).toBeNull()
  })
})

describe('getTasks', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('returns all tasks', () => {
    createTask({ id: 'lt-1', agentId: 'a', chatId: 'c1', prompt: 'p1', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
    createTask({ id: 'lt-2', agentId: 'b', chatId: 'c2', prompt: 'p2', scheduleType: 'cron', scheduleValue: '0 9 * * *', nextRun: new Date().toISOString() })

    const tasks = getTasks()
    expect(tasks.length).toBe(2)
    const ids = tasks.map((t) => t.id).sort()
    expect(ids).toEqual(['lt-1', 'lt-2'])
  })

  test('empty table returns empty array', () => {
    expect(getTasks().length).toBe(0)
  })
})

describe('updateTask', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks')
    createTask({
      id: 'ut-1',
      agentId: 'agent-1',
      chatId: 'task:ut',
      prompt: 'original prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })
  })

  test('update name', () => {
    updateTask('ut-1', { name: 'New Name' })
    expect(getTask('ut-1')!.name).toBe('New Name')
  })

  test('update description', () => {
    updateTask('ut-1', { description: 'New Description' })
    expect(getTask('ut-1')!.description).toBe('New Description')
  })

  test('update prompt', () => {
    updateTask('ut-1', { prompt: 'updated prompt' })
    expect(getTask('ut-1')!.prompt).toBe('updated prompt')
  })

  test('update status', () => {
    updateTask('ut-1', { status: 'paused' })
    expect(getTask('ut-1')!.status).toBe('paused')
  })

  test('update scheduleValue', () => {
    updateTask('ut-1', { scheduleValue: '120000' })
    expect(getTask('ut-1')!.schedule_value).toBe('120000')
  })

  test('update nextRun', () => {
    const next = '2026-06-01T00:00:00.000Z'
    updateTask('ut-1', { nextRun: next })
    expect(getTask('ut-1')!.next_run).toBe(next)
  })

  test('update nextRun to null', () => {
    updateTask('ut-1', { nextRun: null })
    expect(getTask('ut-1')!.next_run).toBeNull()
  })

  test('update lastRun', () => {
    const lastRun = new Date().toISOString()
    updateTask('ut-1', { lastRun })
    expect(getTask('ut-1')!.last_run).toBe(lastRun)
  })

  test('update multiple fields at once', () => {
    updateTask('ut-1', {
      name: 'Batch Update',
      description: 'Batch Description',
      prompt: 'new prompt',
      status: 'paused',
    })
    const task = getTask('ut-1')!
    expect(task.name).toBe('Batch Update')
    expect(task.description).toBe('Batch Description')
    expect(task.prompt).toBe('new prompt')
    expect(task.status).toBe('paused')
  })

  test('empty updates do not throw', () => {
    expect(() => updateTask('ut-1', {})).not.toThrow()
    // Original data remains unchanged
    expect(getTask('ut-1')!.prompt).toBe('original prompt')
  })
})

describe('deleteTask', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks', 'task_run_logs')

    createTask({
      id: 'del-1',
      agentId: 'agent-1',
      chatId: 'task:del',
      prompt: 'test',
      scheduleType: 'once',
      scheduleValue: new Date().toISOString(),
      nextRun: new Date().toISOString(),
      name: 'To Be Deleted',
    })
    saveTaskRunLog({ taskId: 'del-1', runAt: new Date().toISOString(), durationMs: 100, status: 'success', result: 'ok' })
    saveTaskRunLog({ taskId: 'del-1', runAt: new Date().toISOString(), durationMs: 200, status: 'error', error: 'fail' })
  })

  test('after deleting a task, both the task and its logs are gone', () => {
    expect(getTask('del-1')).not.toBeNull()
    expect(getTaskRunLogs('del-1').length).toBe(2)

    deleteTask('del-1')

    expect(getTask('del-1')).toBeNull()
    expect(getTaskRunLogs('del-1').length).toBe(0)
  })

  test('deleting a non-existent task does not throw', () => {
    expect(() => deleteTask('non-existent')).not.toThrow()
  })
})

describe('getTasksDueBy', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks')

    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 3_600_000).toISOString()

    // active + past due
    createTask({ id: 'due-1', agentId: 'a', chatId: 'c1', prompt: 'past active', scheduleType: 'interval', scheduleValue: '60000', nextRun: past })
    // active + not yet due
    createTask({ id: 'due-2', agentId: 'a', chatId: 'c2', prompt: 'future active', scheduleType: 'interval', scheduleValue: '60000', nextRun: future })
    // paused + past due
    createTask({ id: 'due-3', agentId: 'a', chatId: 'c3', prompt: 'past paused', scheduleType: 'interval', scheduleValue: '60000', nextRun: past })
    updateTask('due-3', { status: 'paused' })
    // completed + past due
    createTask({ id: 'due-4', agentId: 'a', chatId: 'c4', prompt: 'past completed', scheduleType: 'once', scheduleValue: past, nextRun: past })
    updateTask('due-4', { status: 'completed' })
    // active + null nextRun
    createTask({ id: 'due-5', agentId: 'a', chatId: 'c5', prompt: 'null next', scheduleType: 'once', scheduleValue: past, nextRun: past })
    updateTask('due-5', { nextRun: null })
  })

  test('only returns active tasks with next_run <= current time', () => {
    const due = getTasksDueBy(new Date().toISOString())
    expect(due.length).toBe(1)
    expect(due[0].id).toBe('due-1')
  })

  test('returns empty array when no tasks are due', () => {
    cleanTables('scheduled_tasks')
    expect(getTasksDueBy(new Date().toISOString()).length).toBe(0)
  })
})

describe('saveTaskRunLog + getTaskRunLogs', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('save success log', () => {
    saveTaskRunLog({
      taskId: 'log-task-1',
      runAt: '2026-03-10T10:00:00.000Z',
      durationMs: 1500,
      status: 'success',
      result: 'output data',
    })

    const logs = getTaskRunLogs('log-task-1')
    expect(logs.length).toBe(1)
    expect(logs[0].task_id).toBe('log-task-1')
    expect(logs[0].run_at).toBe('2026-03-10T10:00:00.000Z')
    expect(logs[0].duration_ms).toBe(1500)
    expect(logs[0].status).toBe('success')
    expect(logs[0].result).toBe('output data')
    expect(logs[0].error).toBeNull()
  })

  test('save failure log', () => {
    saveTaskRunLog({
      taskId: 'log-task-2',
      runAt: new Date().toISOString(),
      durationMs: 50,
      status: 'error',
      error: 'connection timeout',
    })

    const logs = getTaskRunLogs('log-task-2')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('error')
    expect(logs[0].error).toBe('connection timeout')
    expect(logs[0].result).toBeNull()
  })

  test('multiple logs sorted by run_at DESC', () => {
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T08:00:00.000Z', durationMs: 100, status: 'success' })
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T10:00:00.000Z', durationMs: 200, status: 'success' })
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T09:00:00.000Z', durationMs: 150, status: 'error', error: 'err' })

    const logs = getTaskRunLogs('log-multi')
    expect(logs.length).toBe(3)
    expect(logs[0].run_at).toBe('2026-03-10T10:00:00.000Z')
    expect(logs[1].run_at).toBe('2026-03-10T09:00:00.000Z')
    expect(logs[2].run_at).toBe('2026-03-10T08:00:00.000Z')
  })

  test('limit parameter restricts returned count', () => {
    for (let i = 0; i < 10; i++) {
      saveTaskRunLog({ taskId: 'log-limit', runAt: new Date(Date.now() + i * 1000).toISOString(), durationMs: 100, status: 'success' })
    }

    const logs = getTaskRunLogs('log-limit', 3)
    expect(logs.length).toBe(3)
  })

  test('non-existent taskId returns empty array', () => {
    expect(getTaskRunLogs('non-existent').length).toBe(0)
  })
})

// ===== Additional test scenarios =====

describe('createTask — special characters', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('name with quotes, HTML tags, & symbol, description with emoji, stored and read correctly', () => {
    createTask({
      id: 'special-1',
      agentId: 'agent-1',
      chatId: 'task:special',
      prompt: 'test special chars',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: '\'quotes"double<html>&amp;',
      description: '🔥🚀',
    })

    const task = getTask('special-1')
    expect(task).not.toBeNull()
    expect(task!.name).toBe('\'quotes"double<html>&amp;')
    expect(task!.description).toBe('🔥🚀')
  })
})

describe('createTask — very long strings', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('10000-character prompt stored correctly', () => {
    const longPrompt = 'A'.repeat(10000)
    createTask({
      id: 'long-1',
      agentId: 'agent-1',
      chatId: 'task:long',
      prompt: longPrompt,
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })

    const task = getTask('long-1')
    expect(task).not.toBeNull()
    expect(task!.prompt).toBe(longPrompt)
    expect(task!.prompt.length).toBe(10000)
  })
})

describe('createTask — duplicate ID', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('inserting duplicate ID should throw UNIQUE constraint error', () => {
    createTask({
      id: 'dup-1',
      agentId: 'agent-1',
      chatId: 'task:dup',
      prompt: 'first',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })

    expect(() =>
      createTask({
        id: 'dup-1',
        agentId: 'agent-2',
        chatId: 'task:dup2',
        prompt: 'second',
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        nextRun: new Date().toISOString(),
      })
    ).toThrow()

    // Original data remains unchanged
    const task = getTask('dup-1')
    expect(task!.prompt).toBe('first')
    expect(task!.agent_id).toBe('agent-1')
  })
})

describe('updateTask — updating a non-existent task', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('calling updateTask on a non-existent ID does not throw', () => {
    expect(() => updateTask('non-existent-id', { name: 'Ghost Task' })).not.toThrow()
    // Confirm no record was created
    expect(getTask('non-existent-id')).toBeNull()
  })
})

describe('updateTask — setting name to empty string', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks')
    createTask({
      id: 'empty-name-1',
      agentId: 'agent-1',
      chatId: 'task:empty',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Original Name',
    })
  })

  test('name updated to empty string is stored as empty string, not null', () => {
    updateTask('empty-name-1', { name: '' })
    const task = getTask('empty-name-1')
    expect(task).not.toBeNull()
    expect(task!.name).toBe('')
    expect(task!.name).not.toBeNull()
  })
})

describe('getTasksDueBy — multiple due tasks returned as expected', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('3 active and past-due tasks are all returned', () => {
    const past1 = new Date(Date.now() - 120_000).toISOString()
    const past2 = new Date(Date.now() - 60_000).toISOString()
    const past3 = new Date(Date.now() - 30_000).toISOString()

    createTask({ id: 'multi-due-1', agentId: 'a', chatId: 'c1', prompt: 'p1', scheduleType: 'interval', scheduleValue: '60000', nextRun: past1 })
    createTask({ id: 'multi-due-2', agentId: 'a', chatId: 'c2', prompt: 'p2', scheduleType: 'interval', scheduleValue: '60000', nextRun: past2 })
    createTask({ id: 'multi-due-3', agentId: 'a', chatId: 'c3', prompt: 'p3', scheduleType: 'interval', scheduleValue: '60000', nextRun: past3 })

    const due = getTasksDueBy(new Date().toISOString())
    expect(due.length).toBe(3)
    const ids = due.map((t) => t.id).sort()
    expect(ids).toEqual(['multi-due-1', 'multi-due-2', 'multi-due-3'])
  })
})

describe('getTasksDueBy — exact boundary test', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('task with nextRun exactly equal to cutoff time should be returned (<=)', () => {
    const exactTime = '2026-06-15T12:00:00.000Z'
    createTask({
      id: 'boundary-1',
      agentId: 'a',
      chatId: 'c1',
      prompt: 'boundary test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: exactTime,
    })

    const due = getTasksDueBy(exactTime)
    expect(due.length).toBe(1)
    expect(due[0].id).toBe('boundary-1')
  })
})

describe('saveTaskRunLog — both result and error provided', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('when both result and error are provided, both are stored correctly', () => {
    saveTaskRunLog({
      taskId: 'both-1',
      runAt: '2026-03-10T10:00:00.000Z',
      durationMs: 500,
      status: 'error',
      result: 'partial output before failure',
      error: 'timeout after 500ms',
    })

    const logs = getTaskRunLogs('both-1')
    expect(logs.length).toBe(1)
    expect(logs[0].result).toBe('partial output before failure')
    expect(logs[0].error).toBe('timeout after 500ms')
    expect(logs[0].status).toBe('error')
  })
})

describe('saveTaskRunLog — very large result', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('50000-character result stored correctly', () => {
    const largeResult = 'X'.repeat(50000)
    saveTaskRunLog({
      taskId: 'large-result-1',
      runAt: '2026-03-10T12:00:00.000Z',
      durationMs: 3000,
      status: 'success',
      result: largeResult,
    })

    const logs = getTaskRunLogs('large-result-1')
    expect(logs.length).toBe(1)
    expect(logs[0].result).toBe(largeResult)
    expect(logs[0].result!.length).toBe(50000)
  })
})

// ===== Delivery field tests =====

describe('createTask — delivery fields', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('without deliveryMode, defaults to none', () => {
    createTask({
      id: 'dlv-db-1',
      agentId: 'agent-1',
      chatId: 'task:dlv',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })

    const task = getTask('dlv-db-1')!
    expect(task.delivery_mode).toBe('none')
    expect(task.delivery_target).toBeNull()
  })

  test('with deliveryMode=push and deliveryTarget', () => {
    createTask({
      id: 'dlv-db-2',
      agentId: 'agent-1',
      chatId: 'task:dlv2',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      deliveryMode: 'push',
      deliveryTarget: 'tg:123456',
    })

    const task = getTask('dlv-db-2')!
    expect(task.delivery_mode).toBe('push')
    expect(task.delivery_target).toBe('tg:123456')
  })

  test('when deliveryMode=none, deliveryTarget is null', () => {
    createTask({
      id: 'dlv-db-3',
      agentId: 'agent-1',
      chatId: 'task:dlv3',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      deliveryMode: 'none',
    })

    const task = getTask('dlv-db-3')!
    expect(task.delivery_mode).toBe('none')
    expect(task.delivery_target).toBeNull()
  })
})

describe('updateTask — delivery fields', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks')
    createTask({
      id: 'dlv-up-1',
      agentId: 'agent-1',
      chatId: 'task:dlv-up',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
    })
  })

  test('update deliveryMode and deliveryTarget', () => {
    updateTask('dlv-up-1', { deliveryMode: 'push', deliveryTarget: 'tg:999' })
    const task = getTask('dlv-up-1')!
    expect(task.delivery_mode).toBe('push')
    expect(task.delivery_target).toBe('tg:999')
  })

  test('set deliveryTarget to null', () => {
    updateTask('dlv-up-1', { deliveryMode: 'push', deliveryTarget: 'tg:111' })
    updateTask('dlv-up-1', { deliveryMode: 'none', deliveryTarget: null })
    const task = getTask('dlv-up-1')!
    expect(task.delivery_mode).toBe('none')
    expect(task.delivery_target).toBeNull()
  })
})

describe('saveTaskRunLog — delivery_status field', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('save log with deliveryStatus', () => {
    saveTaskRunLog({
      taskId: 'dlv-log-1',
      runAt: new Date().toISOString(),
      durationMs: 100,
      status: 'success',
      result: 'ok',
      deliveryStatus: 'sent',
    })

    const logs = getTaskRunLogs('dlv-log-1')
    expect(logs[0].delivery_status).toBe('sent')
  })

  test('without deliveryStatus, value is null', () => {
    saveTaskRunLog({
      taskId: 'dlv-log-2',
      runAt: new Date().toISOString(),
      durationMs: 100,
      status: 'success',
    })

    const logs = getTaskRunLogs('dlv-log-2')
    expect(logs[0].delivery_status).toBeNull()
  })

  test('deliveryStatus value is failed', () => {
    saveTaskRunLog({
      taskId: 'dlv-log-3',
      runAt: new Date().toISOString(),
      durationMs: 100,
      status: 'success',
      deliveryStatus: 'failed',
    })

    const logs = getTaskRunLogs('dlv-log-3')
    expect(logs[0].delivery_status).toBe('failed')
  })

  test('deliveryStatus value is skipped', () => {
    saveTaskRunLog({
      taskId: 'dlv-log-4',
      runAt: new Date().toISOString(),
      durationMs: 100,
      status: 'error',
      error: 'fail',
      deliveryStatus: 'skipped',
    })

    const logs = getTaskRunLogs('dlv-log-4')
    expect(logs[0].delivery_status).toBe('skipped')
  })
})

describe('deleteTask — recreate with same ID after deletion', () => {
  beforeEach(() => cleanTables('scheduled_tasks', 'task_run_logs'))

  test('create, delete, then recreate with same ID does not throw and data is correct', () => {
    createTask({
      id: 'recreate-1',
      agentId: 'agent-1',
      chatId: 'task:old',
      prompt: 'old prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: 'Old Task',
    })

    expect(getTask('recreate-1')).not.toBeNull()
    expect(getTask('recreate-1')!.name).toBe('Old Task')

    deleteTask('recreate-1')
    expect(getTask('recreate-1')).toBeNull()

    // Recreate with the same ID
    createTask({
      id: 'recreate-1',
      agentId: 'agent-2',
      chatId: 'task:new',
      prompt: 'new prompt',
      scheduleType: 'cron',
      scheduleValue: '0 12 * * *',
      nextRun: new Date().toISOString(),
      name: 'New Task',
    })

    const task = getTask('recreate-1')
    expect(task).not.toBeNull()
    expect(task!.agent_id).toBe('agent-2')
    expect(task!.chat_id).toBe('task:new')
    expect(task!.prompt).toBe('new prompt')
    expect(task!.schedule_type).toBe('cron')
    expect(task!.name).toBe('New Task')
  })
})
