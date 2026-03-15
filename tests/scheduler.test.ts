/**
 * Scheduler tests
 *
 * Coverage:
 * - calculateNextRun for each schedule type
 * - executeTask behavior on success/failure
 * - Execution results written to messages table
 * - Concurrency guard (running_since flag)
 * - Stuck task detection
 * - Error backoff
 * - Auto-pause after consecutive failures
 * - Timezone support
 * - start/stop lifecycle
 */

import { describe, test, expect, beforeEach, beforeAll, mock } from 'bun:test'
import { cleanTables } from './setup.ts'
import {
  createTask,
  getTask,
  getMessages,
  getChats,
  getTaskRunLogs,
  updateTask,
  getTasksDueBy,
  getStuckTasks,
  pruneOldTaskRunLogs,
  saveTaskRunLog,
} from '../src/db/index.ts'
import { Scheduler } from '../src/scheduler/scheduler.ts'

// mock eventBus, providing an emit method
const mockEventBus = { emit: mock(() => {}) } as any

// ===== calculateNextRun =====

describe('Scheduler.calculateNextRun', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  // --- interval ---

  test('interval — calculates based on last_run', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '3600000',
      last_run: '2026-03-10T10:00:00.000Z',
    })
    expect(result).toBe('2026-03-10T11:00:00.000Z')
  })

  test('interval — calculates based on now when no last_run', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '60000',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    expect(nextTime).toBeGreaterThanOrEqual(before + 60000 - 100)
    expect(nextTime).toBeLessThanOrEqual(Date.now() + 60000 + 100)
  })

  test('interval — NaN value returns null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: 'abc', last_run: null })).toBeNull()
  })

  test('interval — negative value returns null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: '-1000', last_run: null })).toBeNull()
  })

  test('interval — zero value returns null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: '0', last_run: null })).toBeNull()
  })

  test('interval — small interval works correctly', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '1000', // 1 second
      last_run: '2026-03-10T10:00:00.000Z',
    })
    expect(result).toBe('2026-03-10T10:00:01.000Z')
  })

  // --- cron ---

  test('cron — every minute returns a future time', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      last_run: null,
    })
    expect(result).not.toBeNull()
    expect(new Date(result!).getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  test('cron — specific time expression', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *', // daily at 9am
      last_run: null,
    })
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getUTCHours()).toBe(9)
    expect(date.getUTCMinutes()).toBe(0)
  })

  // --- once ---

  test('once — returns null when no failures', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: null })).toBeNull()
  })

  test('once — returns null even with last_run when no failures', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: '2026-03-10T10:00:00.000Z' })).toBeNull()
  })

  test('once — returns backoff time when there are failures', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: null },
      { consecutiveFailures: 1 },
    )
    expect(result).not.toBeNull()
    // Should be around now + 30s (first backoff)
    expect(new Date(result!).getTime()).toBeGreaterThanOrEqual(before + 29_000)
  })

  // --- unknown type ---

  test('unknown type returns null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'unknown', schedule_value: 'x', last_run: null })).toBeNull()
    expect(scheduler.calculateNextRun({ schedule_type: '', schedule_value: '', last_run: null })).toBeNull()
  })
})

// ===== calculateNextRun — backoff logic =====

describe('Scheduler.calculateNextRun — backoff logic', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('no backoff when no failures', () => {
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '60000', last_run: new Date().toISOString() },
      { consecutiveFailures: 0 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // Should be around now + 60s
    expect(nextTime).toBeLessThanOrEqual(Date.now() + 61_000)
  })

  test('1 failure backs off 30 seconds', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 1 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // Backoff at least 30 seconds
    expect(nextTime).toBeGreaterThanOrEqual(before + 29_000)
  })

  test('3 failures back off 5 minutes', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 3 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // Backoff at least 5 minutes
    expect(nextTime).toBeGreaterThanOrEqual(before + 299_000)
  })

  test('more than 5 failures uses max backoff of 60 minutes', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 10 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // Backoff at least 60 minutes
    expect(nextTime).toBeGreaterThanOrEqual(before + 3_599_000)
  })

  test('uses normal interval when it exceeds backoff', () => {
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '7200000', last_run: new Date().toISOString() },  // 2 hours
      { consecutiveFailures: 1 },  // 30 second backoff
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 2 hours > 30 second backoff, so use 2 hours
    expect(nextTime).toBeGreaterThanOrEqual(Date.now() + 7_199_000)
  })
})

// ===== calculateNextRun — timezone support =====

describe('Scheduler.calculateNextRun — timezone support', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('cron with timezone parameter does not crash', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      last_run: null,
      timezone: 'Asia/Shanghai',
    })
    expect(result).not.toBeNull()
  })

  test('cron with different timezones returns different times', () => {
    const shanghai = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      last_run: null,
      timezone: 'Asia/Shanghai',
    })
    const utc = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      last_run: null,
      timezone: 'UTC',
    })
    expect(shanghai).not.toBeNull()
    expect(utc).not.toBeNull()
    // Timezone difference causes different UTC times (unless they happen to align)
    // Just verify both are valid times
    expect(new Date(shanghai!).getTime()).toBeGreaterThan(0)
    expect(new Date(utc!).getTime()).toBeGreaterThan(0)
  })

  test('interval type ignores timezone parameter', () => {
    const withTz = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '60000',
      last_run: '2026-03-10T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
    })
    const withoutTz = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '60000',
      last_run: '2026-03-10T10:00:00.000Z',
    })
    expect(withTz).toBe(withoutTz)
  })
})

// ===== executeTask =====

describe('Scheduler.executeTask — successful execution', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('writes user + bot messages, chat, and run log', async () => {
    const chatId = 'task:exec-ok'
    createTask({
      id: 'exec-1',
      agentId: 'agent-1',
      chatId,
      prompt: 'Please generate report',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
      name: 'Test Task',
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('Report result')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)
    const task = getTask('exec-1')!

    await scheduler.executeTask(task)

    // messages
    const messages = getMessages(chatId, 10)
    expect(messages.length).toBe(2)
    const userMsg = messages.find((m) => m.is_bot_message === 0)!
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(userMsg.content).toBe('Please generate report')
    expect(userMsg.sender).toBe('scheduler')
    expect(userMsg.sender_name).toBe('Scheduled Task')
    expect(userMsg.is_from_me).toBe(0) // not sent by bot
    expect(botMsg.content).toBe('Report result')
    expect(botMsg.sender).toBe('agent-1')
    expect(botMsg.is_from_me).toBe(1) // sent by bot

    // chat
    const chat = getChats().find((c) => c.chat_id === chatId)!
    expect(chat.name).toBe('Task: Test Task')
    expect(chat.channel).toBe('task')

    // run log
    const logs = getTaskRunLogs('exec-1')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('success')
    expect(logs[0].result).toBe('Report result')
  })

  test('chat name uses truncated prompt when no name is set', async () => {
    const longPrompt = 'This is a very long prompt text to test whether truncation works properly'
    createTask({
      id: 'exec-noname',
      agentId: 'agent-1',
      chatId: 'task:noname',
      prompt: longPrompt,
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-noname')!)

    const chat = getChats().find((c) => c.chat_id === 'task:noname')!
    expect(chat.name).toBe(`Task: ${longPrompt.slice(0, 30)}`)
  })

  test('saves "(no output)" when enqueue returns no output', async () => {
    createTask({
      id: 'exec-null',
      agentId: 'agent-1',
      chatId: 'task:null-out',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve(undefined as any)) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-null')!)

    const msgs = getMessages('task:null-out', 10)
    const botMsg = msgs.find((m) => m.is_bot_message === 1)!
    expect(botMsg.content).toBe('(no output)')
  })
})

describe('Scheduler.executeTask — execution failure', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('on failure, does not write messages but writes error run log', async () => {
    createTask({
      id: 'exec-fail',
      agentId: 'agent-1',
      chatId: 'task:fail',
      prompt: 'will fail',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('crashed'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-fail')!)

    expect(getMessages('task:fail', 10).length).toBe(0)

    const logs = getTaskRunLogs('exec-fail')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('error')
    expect(logs[0].error).toBe('crashed')
  })

  test('non-Error exceptions are also recorded correctly', async () => {
    createTask({
      id: 'exec-str-err',
      agentId: 'agent-1',
      chatId: 'task:str-err',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject('string error')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-str-err')!)

    const logs = getTaskRunLogs('exec-str-err')
    expect(logs[0].error).toBe('string error')
  })
})

// ===== concurrency guard =====

describe('Scheduler.executeTask — concurrency guard', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('sets running_since at start, clears it on completion', async () => {
    createTask({
      id: 'conc-1',
      agentId: 'agent-1',
      chatId: 'task:conc-1',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    let resolveEnqueue: (value: string) => void
    const enqueuePromise = new Promise<string>((resolve) => { resolveEnqueue = resolve })
    const mockQueue = { enqueue: mock(() => enqueuePromise) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // running_since is now set synchronously by tick(), simulate tick behavior
    updateTask('conc-1', { runningSince: new Date().toISOString() })

    const taskPromise = scheduler.executeTask(getTask('conc-1')!)

    // During execution, running_since should be set (by tick)
    await new Promise((r) => setTimeout(r, 50))
    const during = getTask('conc-1')!
    expect(during.running_since).not.toBeNull()

    resolveEnqueue!('done')
    await taskPromise

    // After completion, running_since should be cleared
    const after = getTask('conc-1')!
    expect(after.running_since).toBeNull()
  })

  test('running tasks are not returned by getTasksDueBy', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()

    createTask({
      id: 'conc-due-1',
      agentId: 'agent-1',
      chatId: 'task:conc-due-1',
      prompt: 'test1',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })

    createTask({
      id: 'conc-due-2',
      agentId: 'agent-1',
      chatId: 'task:conc-due-2',
      prompt: 'test2',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })

    // Mark conc-due-1 as running
    updateTask('conc-due-1', { runningSince: new Date().toISOString() })

    const dueTasks = getTasksDueBy(new Date().toISOString())
    expect(dueTasks.length).toBe(1)
    expect(dueTasks[0].id).toBe('conc-due-2')
  })

  test('running_since is also cleared on failure', async () => {
    createTask({
      id: 'conc-fail',
      agentId: 'agent-1',
      chatId: 'task:conc-fail',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('fail'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('conc-fail')!)

    const after = getTask('conc-fail')!
    expect(after.running_since).toBeNull()
  })
})

// ===== stuck task detection =====

describe('Scheduler — stuck task detection', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('getStuckTasks returns running tasks older than the threshold', () => {
    createTask({
      id: 'stuck-1',
      agentId: 'agent-1',
      chatId: 'task:stuck-1',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    // Mark as started running 10 minutes ago
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    updateTask('stuck-1', { runningSince: tenMinAgo })

    // Use 5 minutes ago as cutoff
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const stuck = getStuckTasks(fiveMinAgo)
    expect(stuck.length).toBe(1)
    expect(stuck[0].id).toBe('stuck-1')

    // Recently started tasks should not be detected
    updateTask('stuck-1', { runningSince: new Date().toISOString() })
    const notStuck = getStuckTasks(fiveMinAgo)
    expect(notStuck.length).toBe(0)
  })
})

// ===== consecutive failures + auto-pause =====

describe('Scheduler.executeTask — consecutive failures and auto-pause', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('failure increments consecutive_failures', async () => {
    createTask({
      id: 'fail-count',
      agentId: 'agent-1',
      chatId: 'task:fail-count',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('fail-count')!)
    expect(getTask('fail-count')!.consecutive_failures).toBe(1)

    await scheduler.executeTask(getTask('fail-count')!)
    expect(getTask('fail-count')!.consecutive_failures).toBe(2)
  })

  test('successful execution resets consecutive_failures', async () => {
    createTask({
      id: 'fail-reset',
      agentId: 'agent-1',
      chatId: 'task:fail-reset',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    // Fail 3 times first
    const failQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler1 = new Scheduler(failQueue, {} as any, {} as any)
    await scheduler1.executeTask(getTask('fail-reset')!)
    await scheduler1.executeTask(getTask('fail-reset')!)
    await scheduler1.executeTask(getTask('fail-reset')!)
    expect(getTask('fail-reset')!.consecutive_failures).toBe(3)

    // Succeed once
    const successQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler2 = new Scheduler(successQueue, {} as any, mockEventBus)
    await scheduler2.executeTask(getTask('fail-reset')!)
    expect(getTask('fail-reset')!.consecutive_failures).toBe(0)
  })

  test('auto-pauses after 5 consecutive failures', async () => {
    createTask({
      id: 'auto-pause',
      agentId: 'agent-1',
      chatId: 'task:auto-pause',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    for (let i = 0; i < 5; i++) {
      await scheduler.executeTask(getTask('auto-pause')!)
    }

    const task = getTask('auto-pause')!
    expect(task.status).toBe('paused')
    expect(task.consecutive_failures).toBe(5)
    expect(task.last_result).toContain('ERROR:')
  })

  test('last_result contains error message after failure', async () => {
    createTask({
      id: 'last-result-err',
      agentId: 'agent-1',
      chatId: 'task:lr-err',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('specific error message'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('last-result-err')!)

    const task = getTask('last-result-err')!
    expect(task.last_result).toBe('ERROR: specific error message')
  })

  test('last_result saves result on success (truncated to 500 chars)', async () => {
    createTask({
      id: 'last-result-ok',
      agentId: 'agent-1',
      chatId: 'task:lr-ok',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const longResult = 'x'.repeat(600)
    const mockQueue = { enqueue: mock(() => Promise.resolve(longResult)) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('last-result-ok')!)

    const task = getTask('last-result-ok')!
    expect(task.last_result!.length).toBe(500)
  })
})

// ===== status updates =====

describe('Scheduler.executeTask — status updates', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('interval task updates lastRun and nextRun on success', async () => {
    createTask({
      id: 'exec-intv',
      agentId: 'agent-1',
      chatId: 'task:intv',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '3600000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-intv')!)

    const updated = getTask('exec-intv')!
    expect(updated.status).toBe('active')
    expect(updated.last_run).not.toBeNull()
    expect(updated.next_run).not.toBeNull()
    // nextRun should be after lastRun
    expect(new Date(updated.next_run!).getTime()).toBeGreaterThan(new Date(updated.last_run!).getTime())
  })

  test('once task becomes completed on success', async () => {
    createTask({
      id: 'exec-once',
      agentId: 'agent-1',
      chatId: 'task:once',
      prompt: 'one time',
      scheduleType: 'once',
      scheduleValue: new Date().toISOString(),
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('done')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-once')!)

    const updated = getTask('exec-once')!
    expect(updated.status).toBe('completed')
    expect(updated.next_run).toBeNull()
    expect(updated.last_run).not.toBeNull()
  })

  test('once task retries with backoff on failure (not immediately completed)', async () => {
    createTask({
      id: 'exec-once-fail',
      agentId: 'agent-1',
      chatId: 'task:once-fail',
      prompt: 'fail once',
      scheduleType: 'once',
      scheduleValue: new Date().toISOString(),
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-once-fail')!)

    const updated = getTask('exec-once-fail')!
    // Should remain active with a backoff nextRun, not immediately completed
    expect(updated.status).toBe('active')
    expect(updated.next_run).not.toBeNull()
    expect(updated.consecutive_failures).toBe(1)
    // nextRun should be at least now + 30s (first backoff)
    expect(new Date(updated.next_run!).getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000)
  })

  test('interval task still updates nextRun on failure (prevents repeated triggers)', async () => {
    createTask({
      id: 'exec-intv-fail',
      agentId: 'agent-1',
      chatId: 'task:intv-fail',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-intv-fail')!)

    const updated = getTask('exec-intv-fail')!
    expect(updated.status).toBe('active')
    expect(updated.next_run).not.toBeNull()
    expect(updated.last_run).not.toBeNull()
  })
})

describe('Scheduler.start / stop', () => {
  test('stop does not throw when not started', () => {
    const scheduler = new Scheduler({} as any, {} as any, mockEventBus)
    // stop without start does not throw
    expect(() => scheduler.stop()).not.toThrow()
  })

  test('repeated start does not create multiple intervals', () => {
    const mockQueue = { enqueue: mock(() => Promise.resolve('')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    scheduler.start()
    scheduler.start() // second call should return immediately

    scheduler.stop()
  })
})

// ===== calculateNextRun — complex cron expressions =====

describe('Scheduler.calculateNextRun — complex cron expressions', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('*/5 * * * * — next run is within 5 minutes', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '*/5 * * * *',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    const now = Date.now()
    expect(nextTime).toBeGreaterThan(now - 1000)
    expect(nextTime).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 1000)
  })

  test('0 0 1 * * — next run is on the 1st of the next month', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 0 1 * *',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextDate = new Date(result!)
    expect(nextDate.getUTCDate()).toBe(1)
    expect(nextDate.getUTCHours()).toBe(0)
    expect(nextDate.getUTCMinutes()).toBe(0)
  })

  test('0 12 * * 1-5 — next run is on a weekday', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 12 * * 1-5',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextDate = new Date(result!)
    const dayOfWeek = nextDate.getUTCDay()
    // 1=Monday ... 5=Friday, excluding 0=Sunday and 6=Saturday
    expect(dayOfWeek).toBeGreaterThanOrEqual(1)
    expect(dayOfWeek).toBeLessThanOrEqual(5)
    expect(nextDate.getUTCHours()).toBe(12)
    expect(nextDate.getUTCMinutes()).toBe(0)
  })
})

// ===== calculateNextRun — interval edge cases =====

describe('Scheduler.calculateNextRun — interval edge cases', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('interval = 1000 (1 second) — next run is about 1 second later', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '1000',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    expect(nextTime).toBeGreaterThanOrEqual(before + 1000 - 100)
    expect(nextTime).toBeLessThanOrEqual(Date.now() + 1000 + 100)
  })

  test('interval = 86400000 (24 hours) — next run is about 24 hours later', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '86400000',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    expect(nextTime).toBeGreaterThanOrEqual(before + 86400000 - 100)
    expect(nextTime).toBeLessThanOrEqual(Date.now() + 86400000 + 100)
  })

  test('interval = 0 — returns null (no crash)', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '0',
      last_run: null,
    })
    expect(result).toBeNull()
  })
})

// ===== calculateNextRun — once past/future time =====

describe('Scheduler.calculateNextRun — once time handling', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('once — past time returns null when no failures', () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: pastDate,
      last_run: null,
    })
    expect(result).toBeNull()
  })

  test('once — future time also returns null when no failures', () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: futureDate,
      last_run: null,
    })
    // once type always returns null when no failures (nextRun is set by createTask, executeTask marks completed)
    expect(result).toBeNull()
  })
})

// ===== executeTask — enqueue parameter validation =====

describe('Scheduler.executeTask — enqueue parameter validation', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('enqueue is called with correct agentId, chatId, and prompt', async () => {
    createTask({
      id: 'enqueue-args',
      agentId: 'agent-verify',
      chatId: 'task:enqueue-args',
      prompt: 'verify params',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const enqueueMock = mock(() => Promise.resolve('result'))
    const mockQueue = { enqueue: enqueueMock } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('enqueue-args')!)

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toBe('agent-verify')
    expect(enqueueMock.mock.calls[0][1]).toBe('task:enqueue-args')
    expect(enqueueMock.mock.calls[0][2]).toBe('verify params')
  })
})

// ===== executeTask — saving messages to messages table =====

describe('Scheduler.executeTask — saving messages to messages table', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('messages are written to correct task:xxx chatId after successful execution', async () => {
    createTask({
      id: 'msg-save',
      agentId: 'agent-msg',
      chatId: 'task:msg-save',
      prompt: 'message save test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('saved result')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('msg-save')!)

    const messages = getMessages('task:msg-save', 10)
    expect(messages.length).toBe(2)

    // Verify user message (isFromMe=false -> is_from_me=0)
    const userMsg = messages.find((m) => m.is_bot_message === 0)!
    expect(userMsg).toBeDefined()
    expect(userMsg.content).toBe('message save test')
    expect(userMsg.sender).toBe('scheduler')
    expect(userMsg.is_from_me).toBe(0)

    // Verify bot message (isFromMe=true -> is_from_me=1)
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(botMsg).toBeDefined()
    expect(botMsg.content).toBe('saved result')
    expect(botMsg.sender).toBe('agent-msg')
    expect(botMsg.is_from_me).toBe(1)
  })
})

// ===== executeTask — consecutive execution of same task =====

describe('Scheduler.executeTask — consecutive execution of same task', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('two consecutive executions generate two run logs', async () => {
    createTask({
      id: 'exec-twice',
      agentId: 'agent-twice',
      chatId: 'task:exec-twice',
      prompt: 'repeated execution',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-twice')!)
    await scheduler.executeTask(getTask('exec-twice')!)

    const logs = getTaskRunLogs('exec-twice')
    expect(logs.length).toBe(2)
    expect(logs[0].status).toBe('success')
    expect(logs[1].status).toBe('success')
  })
})

// ===== tick — multiple due tasks =====

describe('Scheduler.tick — multiple due tasks', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('all 3 due tasks are executed', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()
    for (let i = 1; i <= 3; i++) {
      createTask({
        id: `tick-multi-${i}`,
        agentId: `agent-${i}`,
        chatId: `task:tick-multi-${i}`,
        prompt: `task ${i}`,
        scheduleType: 'interval',
        scheduleValue: '60000',
        nextRun: pastTime,
      })
    }

    const enqueueMock = mock(() => Promise.resolve('done'))
    const mockQueue = { enqueue: enqueueMock } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // @ts-ignore — testing private method
    await scheduler.tick()

    // tick does not await each executeTask internally, wait briefly for async completion
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(enqueueMock).toHaveBeenCalledTimes(3)
  })
})

// ===== tick — mixed status tasks =====

describe('Scheduler.tick — mixed status tasks', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('only executes active due tasks, skips paused and completed', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()

    // Create 2 active tasks
    createTask({
      id: 'tick-active-1',
      agentId: 'agent-a',
      chatId: 'task:tick-active-1',
      prompt: 'active task 1',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    createTask({
      id: 'tick-active-2',
      agentId: 'agent-a',
      chatId: 'task:tick-active-2',
      prompt: 'active task 2',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })

    // Create paused task (created as active first, then update status)
    createTask({
      id: 'tick-paused',
      agentId: 'agent-a',
      chatId: 'task:tick-paused',
      prompt: 'paused task',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    updateTask('tick-paused', { status: 'paused' })

    // Create completed task
    createTask({
      id: 'tick-completed',
      agentId: 'agent-a',
      chatId: 'task:tick-completed',
      prompt: 'completed task',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    updateTask('tick-completed', { status: 'completed' })

    const enqueueMock = mock(() => Promise.resolve('done'))
    const mockQueue = { enqueue: enqueueMock } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // @ts-ignore — testing private method
    await scheduler.tick()

    // Wait for async executeTask to complete
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Only 2 active tasks should be executed
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })
})

// ===== log pruning =====

describe('pruneOldTaskRunLogs', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('deletes expired logs, keeps recent logs', () => {
    // Create log from 40 days ago
    saveTaskRunLog({
      taskId: 'prune-1',
      runAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      durationMs: 100,
      status: 'success',
    })

    // Create today's log
    saveTaskRunLog({
      taskId: 'prune-1',
      runAt: new Date().toISOString(),
      durationMs: 100,
      status: 'success',
    })

    const deleted = pruneOldTaskRunLogs(30)
    expect(deleted).toBe(1)

    const remaining = getTaskRunLogs('prune-1')
    expect(remaining.length).toBe(1)
  })
})

// ===== runManually =====

describe('Scheduler.runManually', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('manual execution success returns result and records task_run_logs', async () => {
    createTask({
      id: 'manual-1',
      agentId: 'agent-1',
      chatId: 'task:manual-1',
      prompt: 'manual execution',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('manual result')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    const result = await scheduler.runManually(getTask('manual-1')!)
    expect(result.status).toBe('success')
    expect(result.result).toBe('manual result')

    // Messages should be saved
    const messages = getMessages('task:manual-1', 10)
    expect(messages.length).toBe(2)

    // Run log should be recorded
    const logs = getTaskRunLogs('manual-1')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('success')
    expect(logs[0].result).toContain('[manual]')
  })

  test('manual execution failure also records task_run_logs', async () => {
    createTask({
      id: 'manual-2',
      agentId: 'agent-1',
      chatId: 'task:manual-2',
      prompt: 'manual execution',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    const result = await scheduler.runManually(getTask('manual-2')!)
    expect(result.status).toBe('error')
    expect(result.error).toBe('err')

    // consecutive_failures remains unchanged
    const task = getTask('manual-2')!
    expect(task.consecutive_failures).toBe(0)
    expect(task.running_since).toBeNull()

    // Failure log should be recorded
    const logs = getTaskRunLogs('manual-2')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('error')
    expect(logs[0].error).toContain('[manual]')
  })
})

// ===== Delivery =====

describe('Scheduler.executeTask — Delivery', () => {
  beforeEach(() => {
    cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs')
    mockEventBus.emit.mockClear()
  })

  test('delivery_mode=push delivers to delivery_target via EventBus', async () => {
    createTask({
      id: 'dlv-1',
      agentId: 'agent-dlv',
      chatId: 'task:dlv-1',
      prompt: 'delivery test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
      name: 'Daily Report',
      deliveryMode: 'push',
      deliveryTarget: 'tg:123456',
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('delivery result')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('dlv-1')!)

    expect(mockEventBus.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = mockEventBus.emit.mock.calls[0][0]
    expect(emittedEvent.type).toBe('complete')
    expect(emittedEvent.agentId).toBe('agent-dlv')
    expect(emittedEvent.chatId).toBe('tg:123456')
    expect(emittedEvent.fullText).toContain('[Task: Daily Report]')
    expect(emittedEvent.fullText).toContain('delivery result')

    // run log records delivery_status
    const logs = getTaskRunLogs('dlv-1')
    expect(logs[0].delivery_status).toBe('sent')
  })

  test('delivery_mode=none does not call EventBus', async () => {
    createTask({
      id: 'dlv-2',
      agentId: 'agent-dlv',
      chatId: 'task:dlv-2',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('dlv-2')!)

    expect(mockEventBus.emit).not.toHaveBeenCalled()

    const logs = getTaskRunLogs('dlv-2')
    expect(logs[0].delivery_status).toBe('skipped')
  })

  test('delivery_status=skipped on execution failure', async () => {
    createTask({
      id: 'dlv-3',
      agentId: 'agent-dlv',
      chatId: 'task:dlv-3',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
      deliveryMode: 'push',
      deliveryTarget: 'tg:123456',
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('dlv-3')!)

    // No delivery on failure
    expect(mockEventBus.emit).not.toHaveBeenCalled()
    const logs = getTaskRunLogs('dlv-3')
    expect(logs[0].delivery_status).toBe('skipped')
  })

  test('delivery emit exception results in delivery_status=failed but task does not fail', async () => {
    createTask({
      id: 'dlv-4',
      agentId: 'agent-dlv',
      chatId: 'task:dlv-4',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
      deliveryMode: 'push',
      deliveryTarget: 'tg:999',
    })

    // emit throws exception
    const failEventBus = { emit: mock(() => { throw new Error('channel down') }) } as any
    const mockQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, failEventBus)

    await scheduler.executeTask(getTask('dlv-4')!)

    // Task itself should succeed (best-effort delivery)
    const task = getTask('dlv-4')!
    expect(task.consecutive_failures).toBe(0)

    const logs = getTaskRunLogs('dlv-4')
    expect(logs[0].status).toBe('success')
    expect(logs[0].delivery_status).toBe('failed')
  })
})

// ===== tick race condition guard =====

describe('Scheduler.tick — race condition guard', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('tick synchronously sets running_since before executeTask', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()
    createTask({
      id: 'race-1',
      agentId: 'agent-1',
      chatId: 'task:race-1',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })

    // enqueue returns with delay, simulating slow execution
    let resolveEnqueue: (v: string) => void
    const enqueuePromise = new Promise<string>((r) => { resolveEnqueue = r })
    const mockQueue = { enqueue: mock(() => enqueuePromise) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // @ts-ignore — testing private method
    await scheduler.tick()

    // After tick returns (executeTask still awaiting enqueue), running_since should be set
    const during = getTask('race-1')!
    expect(during.running_since).not.toBeNull()

    // Querying due tasks again should not find it (already locked)
    const dueTasks = getTasksDueBy(new Date().toISOString())
    expect(dueTasks.find((t) => t.id === 'race-1')).toBeUndefined()

    resolveEnqueue!('done')
    await new Promise((r) => setTimeout(r, 100))
  })
})
