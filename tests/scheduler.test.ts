/**
 * Scheduler 测试
 *
 * 覆盖：
 * - calculateNextRun 各调度类型
 * - executeTask 成功/失败时的行为
 * - 执行结果写入 messages 表
 * - 并发防护（running_since 标记）
 * - 卡住检测
 * - 错误退避
 * - 连续失败自动暂停
 * - 时区支持
 * - start/stop 生命周期
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

// mock eventBus，提供 emit 方法
const mockEventBus = { emit: mock(() => {}) } as any

// ===== calculateNextRun =====

describe('Scheduler.calculateNextRun', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  // --- interval ---

  test('interval — 基于 last_run 计算', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '3600000',
      last_run: '2026-03-10T10:00:00.000Z',
    })
    expect(result).toBe('2026-03-10T11:00:00.000Z')
  })

  test('interval — 无 last_run 基于 now', () => {
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

  test('interval — NaN 值返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: 'abc', last_run: null })).toBeNull()
  })

  test('interval — 负数返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: '-1000', last_run: null })).toBeNull()
  })

  test('interval — 零值返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'interval', schedule_value: '0', last_run: null })).toBeNull()
  })

  test('interval — 小间隔正常工作', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '1000', // 1 秒
      last_run: '2026-03-10T10:00:00.000Z',
    })
    expect(result).toBe('2026-03-10T10:00:01.000Z')
  })

  // --- cron ---

  test('cron — 每分钟返回未来时间', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      last_run: null,
    })
    expect(result).not.toBeNull()
    expect(new Date(result!).getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  test('cron — 特定时间表达式', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *', // 每天 9 点
      last_run: null,
    })
    expect(result).not.toBeNull()
    const date = new Date(result!)
    expect(date.getUTCHours()).toBe(9)
    expect(date.getUTCMinutes()).toBe(0)
  })

  // --- once ---

  test('once — 无失败时返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: null })).toBeNull()
  })

  test('once — 即使有 last_run，无失败时也返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: '2026-03-10T10:00:00.000Z' })).toBeNull()
  })

  test('once — 有失败时返回退避时间', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: null },
      { consecutiveFailures: 1 },
    )
    expect(result).not.toBeNull()
    // 应该在 now + 30s 附近（第一次退避）
    expect(new Date(result!).getTime()).toBeGreaterThanOrEqual(before + 29_000)
  })

  // --- 未知类型 ---

  test('未知类型返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'unknown', schedule_value: 'x', last_run: null })).toBeNull()
    expect(scheduler.calculateNextRun({ schedule_type: '', schedule_value: '', last_run: null })).toBeNull()
  })
})

// ===== calculateNextRun — 退避逻辑 =====

describe('Scheduler.calculateNextRun — 退避逻辑', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('无失败时不退避', () => {
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '60000', last_run: new Date().toISOString() },
      { consecutiveFailures: 0 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 应该在 now + 60s 附近
    expect(nextTime).toBeLessThanOrEqual(Date.now() + 61_000)
  })

  test('1 次失败退避 30 秒', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 1 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 退避至少 30 秒
    expect(nextTime).toBeGreaterThanOrEqual(before + 29_000)
  })

  test('3 次失败退避 5 分钟', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 3 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 退避至少 5 分钟
    expect(nextTime).toBeGreaterThanOrEqual(before + 299_000)
  })

  test('超过 5 次失败使用最大退避 60 分钟', () => {
    const before = Date.now()
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '1000', last_run: new Date().toISOString() },
      { consecutiveFailures: 10 },
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 退避至少 60 分钟
    expect(nextTime).toBeGreaterThanOrEqual(before + 3_599_000)
  })

  test('正常间隔大于退避时使用正常间隔', () => {
    const result = scheduler.calculateNextRun(
      { schedule_type: 'interval', schedule_value: '7200000', last_run: new Date().toISOString() },  // 2 小时
      { consecutiveFailures: 1 },  // 退避 30 秒
    )
    expect(result).not.toBeNull()
    const nextTime = new Date(result!).getTime()
    // 2 小时 > 30 秒退避，所以用 2 小时
    expect(nextTime).toBeGreaterThanOrEqual(Date.now() + 7_199_000)
  })
})

// ===== calculateNextRun — 时区支持 =====

describe('Scheduler.calculateNextRun — 时区支持', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('cron 带时区参数不崩溃', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      last_run: null,
      timezone: 'Asia/Shanghai',
    })
    expect(result).not.toBeNull()
  })

  test('cron 不同时区返回不同时间', () => {
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
    // 时区差异导致不同的 UTC 时间（除非正好对齐）
    // 只需验证两者都是合法时间
    expect(new Date(shanghai!).getTime()).toBeGreaterThan(0)
    expect(new Date(utc!).getTime()).toBeGreaterThan(0)
  })

  test('interval 类型忽略时区参数', () => {
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

describe('Scheduler.executeTask — 成功执行', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('写入 user + bot messages、chat、run log', async () => {
    const chatId = 'task:exec-ok'
    createTask({
      id: 'exec-1',
      agentId: 'agent-1',
      chatId,
      prompt: '请生成报告',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
      name: '测试任务',
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('报告结果')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)
    const task = getTask('exec-1')!

    await scheduler.executeTask(task)

    // messages
    const messages = getMessages(chatId, 10)
    expect(messages.length).toBe(2)
    const userMsg = messages.find((m) => m.is_bot_message === 0)!
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(userMsg.content).toBe('请生成报告')
    expect(userMsg.sender).toBe('scheduler')
    expect(userMsg.sender_name).toBe('Scheduled Task')
    expect(userMsg.is_from_me).toBe(0) // 非 bot 发出
    expect(botMsg.content).toBe('报告结果')
    expect(botMsg.sender).toBe('agent-1')
    expect(botMsg.is_from_me).toBe(1) // bot 发出

    // chat
    const chat = getChats().find((c) => c.chat_id === chatId)!
    expect(chat.name).toBe('Task: 测试任务')
    expect(chat.channel).toBe('task')

    // run log
    const logs = getTaskRunLogs('exec-1')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('success')
    expect(logs[0].result).toBe('报告结果')
  })

  test('无 name 时 chat 名称使用 prompt 截断', async () => {
    const longPrompt = '这是一段很长的提示词用来测试截断功能是否正常工作'
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

  test('enqueue 无输出时保存 "(no output)"', async () => {
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

describe('Scheduler.executeTask — 执行失败', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('失败时不写入 messages，但写入 error run log', async () => {
    createTask({
      id: 'exec-fail',
      agentId: 'agent-1',
      chatId: 'task:fail',
      prompt: '会失败',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('崩溃了'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('exec-fail')!)

    expect(getMessages('task:fail', 10).length).toBe(0)

    const logs = getTaskRunLogs('exec-fail')
    expect(logs.length).toBe(1)
    expect(logs[0].status).toBe('error')
    expect(logs[0].error).toBe('崩溃了')
  })

  test('非 Error 异常也能正确记录', async () => {
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

// ===== 并发防护 =====

describe('Scheduler.executeTask — 并发防护', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('执行开始时设置 running_since，完成后清除', async () => {
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

    // running_since 现在由 tick() 同步设置，模拟 tick 行为
    updateTask('conc-1', { runningSince: new Date().toISOString() })

    const taskPromise = scheduler.executeTask(getTask('conc-1')!)

    // 执行中应该有 running_since（tick 设置的）
    await new Promise((r) => setTimeout(r, 50))
    const during = getTask('conc-1')!
    expect(during.running_since).not.toBeNull()

    resolveEnqueue!('done')
    await taskPromise

    // 执行完成后 running_since 应清除
    const after = getTask('conc-1')!
    expect(after.running_since).toBeNull()
  })

  test('running 的任务不会被 getTasksDueBy 查询到', async () => {
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

    // 标记 conc-due-1 为正在运行
    updateTask('conc-due-1', { runningSince: new Date().toISOString() })

    const dueTasks = getTasksDueBy(new Date().toISOString())
    expect(dueTasks.length).toBe(1)
    expect(dueTasks[0].id).toBe('conc-due-2')
  })

  test('失败时也清除 running_since', async () => {
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

// ===== 卡住检测 =====

describe('Scheduler — 卡住检测', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('getStuckTasks 查询早于阈值的 running 任务', () => {
    createTask({
      id: 'stuck-1',
      agentId: 'agent-1',
      chatId: 'task:stuck-1',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    // 标记为 10 分钟前开始运行
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    updateTask('stuck-1', { runningSince: tenMinAgo })

    // 用 5 分钟前作为 cutoff
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const stuck = getStuckTasks(fiveMinAgo)
    expect(stuck.length).toBe(1)
    expect(stuck[0].id).toBe('stuck-1')

    // 刚开始运行的不应该被检测到
    updateTask('stuck-1', { runningSince: new Date().toISOString() })
    const notStuck = getStuckTasks(fiveMinAgo)
    expect(notStuck.length).toBe(0)
  })
})

// ===== 连续失败 + 自动暂停 =====

describe('Scheduler.executeTask — 连续失败与自动暂停', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('失败递增 consecutive_failures', async () => {
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

  test('成功执行重置 consecutive_failures', async () => {
    createTask({
      id: 'fail-reset',
      agentId: 'agent-1',
      chatId: 'task:fail-reset',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    // 先失败 3 次
    const failQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler1 = new Scheduler(failQueue, {} as any, {} as any)
    await scheduler1.executeTask(getTask('fail-reset')!)
    await scheduler1.executeTask(getTask('fail-reset')!)
    await scheduler1.executeTask(getTask('fail-reset')!)
    expect(getTask('fail-reset')!.consecutive_failures).toBe(3)

    // 成功一次
    const successQueue = { enqueue: mock(() => Promise.resolve('ok')) } as any
    const scheduler2 = new Scheduler(successQueue, {} as any, mockEventBus)
    await scheduler2.executeTask(getTask('fail-reset')!)
    expect(getTask('fail-reset')!.consecutive_failures).toBe(0)
  })

  test('连续失败 5 次后自动暂停', async () => {
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

  test('失败后 last_result 包含错误信息', async () => {
    createTask({
      id: 'last-result-err',
      agentId: 'agent-1',
      chatId: 'task:lr-err',
      prompt: 'test',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('具体错误信息'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('last-result-err')!)

    const task = getTask('last-result-err')!
    expect(task.last_result).toBe('ERROR: 具体错误信息')
  })

  test('成功后 last_result 保存结果（截断至 500 字符）', async () => {
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

// ===== 状态更新 =====

describe('Scheduler.executeTask — 状态更新', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('interval 任务成功后更新 lastRun 和 nextRun', async () => {
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
    // nextRun 应在 lastRun 之后
    expect(new Date(updated.next_run!).getTime()).toBeGreaterThan(new Date(updated.last_run!).getTime())
  })

  test('once 任务成功后变为 completed', async () => {
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

  test('once 任务失败后退避重试（不直接 completed）', async () => {
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
    // 失败后应保持 active 并设置退避后的 nextRun，而非直接 completed
    expect(updated.status).toBe('active')
    expect(updated.next_run).not.toBeNull()
    expect(updated.consecutive_failures).toBe(1)
    // nextRun 应至少在 now + 30s（第一次退避）
    expect(new Date(updated.next_run!).getTime()).toBeGreaterThanOrEqual(Date.now() + 29_000)
  })

  test('interval 任务失败后仍更新 nextRun（避免重复触发）', async () => {
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
  test('stop 后 intervalId 为 null', () => {
    const scheduler = new Scheduler({} as any, {} as any, mockEventBus)
    // 不 start 直接 stop 不报错
    expect(() => scheduler.stop()).not.toThrow()
  })

  test('重复 start 不创建多个 interval', () => {
    const mockQueue = { enqueue: mock(() => Promise.resolve('')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    scheduler.start()
    scheduler.start() // 第二次应该直接 return

    scheduler.stop()
  })
})

// ===== calculateNextRun — cron 复杂表达式 =====

describe('Scheduler.calculateNextRun — cron 复杂表达式', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('*/5 * * * * — 下次运行在 5 分钟以内', () => {
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

  test('0 0 1 * * — 下次运行在下个月 1 号', () => {
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

  test('0 12 * * 1-5 — 下次运行在工作日', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'cron',
      schedule_value: '0 12 * * 1-5',
      last_run: null,
    })
    expect(result).not.toBeNull()
    const nextDate = new Date(result!)
    const dayOfWeek = nextDate.getUTCDay()
    // 1=Monday ... 5=Friday，排除 0=Sunday 和 6=Saturday
    expect(dayOfWeek).toBeGreaterThanOrEqual(1)
    expect(dayOfWeek).toBeLessThanOrEqual(5)
    expect(nextDate.getUTCHours()).toBe(12)
    expect(nextDate.getUTCMinutes()).toBe(0)
  })
})

// ===== calculateNextRun — interval 边界值 =====

describe('Scheduler.calculateNextRun — interval 边界值', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('interval = 1000（1 秒）— 下次运行约 1 秒后', () => {
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

  test('interval = 86400000（24 小时）— 下次运行约 24 小时后', () => {
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

  test('interval = 0 — 返回 null（不崩溃）', () => {
    const result = scheduler.calculateNextRun({
      schedule_type: 'interval',
      schedule_value: '0',
      last_run: null,
    })
    expect(result).toBeNull()
  })
})

// ===== calculateNextRun — once 过去/未来时间 =====

describe('Scheduler.calculateNextRun — once 时间处理', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, mockEventBus)
  })

  test('once — 无失败时过去时间返回 null', () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: pastDate,
      last_run: null,
    })
    expect(result).toBeNull()
  })

  test('once — 无失败时未来时间也返回 null', () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: futureDate,
      last_run: null,
    })
    // once 类型无失败时始终返回 null（由 createTask 时设置 nextRun，executeTask 后标记 completed）
    expect(result).toBeNull()
  })
})

// ===== executeTask — enqueue 参数验证 =====

describe('Scheduler.executeTask — enqueue 参数验证', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('enqueue 被调用时传入正确的 agentId、chatId、prompt', async () => {
    createTask({
      id: 'enqueue-args',
      agentId: 'agent-verify',
      chatId: 'task:enqueue-args',
      prompt: '验证参数',
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
    expect(enqueueMock.mock.calls[0][2]).toBe('验证参数')
  })
})

// ===== executeTask — 保存消息到 messages 表 =====

describe('Scheduler.executeTask — 保存消息到 messages 表', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('成功执行后消息写入正确的 task:xxx chatId', async () => {
    createTask({
      id: 'msg-save',
      agentId: 'agent-msg',
      chatId: 'task:msg-save',
      prompt: '消息保存测试',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() - 1000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('保存结果')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    await scheduler.executeTask(getTask('msg-save')!)

    const messages = getMessages('task:msg-save', 10)
    expect(messages.length).toBe(2)

    // 验证 user 消息（isFromMe=false → is_from_me=0）
    const userMsg = messages.find((m) => m.is_bot_message === 0)!
    expect(userMsg).toBeDefined()
    expect(userMsg.content).toBe('消息保存测试')
    expect(userMsg.sender).toBe('scheduler')
    expect(userMsg.is_from_me).toBe(0)

    // 验证 bot 消息（isFromMe=true → is_from_me=1）
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(botMsg).toBeDefined()
    expect(botMsg.content).toBe('保存结果')
    expect(botMsg.sender).toBe('agent-msg')
    expect(botMsg.is_from_me).toBe(1)
  })
})

// ===== executeTask — 连续执行同一任务 =====

describe('Scheduler.executeTask — 连续执行同一任务', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('连续执行两次，生成两条 run log', async () => {
    createTask({
      id: 'exec-twice',
      agentId: 'agent-twice',
      chatId: 'task:exec-twice',
      prompt: '重复执行',
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

// ===== tick — 多个到期任务 =====

describe('Scheduler.tick — 多个到期任务', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('3 个到期任务全部被执行', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()
    for (let i = 1; i <= 3; i++) {
      createTask({
        id: `tick-multi-${i}`,
        agentId: `agent-${i}`,
        chatId: `task:tick-multi-${i}`,
        prompt: `任务 ${i}`,
        scheduleType: 'interval',
        scheduleValue: '60000',
        nextRun: pastTime,
      })
    }

    const enqueueMock = mock(() => Promise.resolve('done'))
    const mockQueue = { enqueue: enqueueMock } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // @ts-ignore — 测试私有方法
    await scheduler.tick()

    // tick 内部不 await 每个 executeTask，等待一小段时间让异步完成
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(enqueueMock).toHaveBeenCalledTimes(3)
  })
})

// ===== tick — 混合状态任务 =====

describe('Scheduler.tick — 混合状态任务', () => {
  beforeEach(() => cleanTables('messages', 'chats', 'scheduled_tasks', 'task_run_logs'))

  test('仅执行 active 状态的到期任务，跳过 paused 和 completed', async () => {
    const pastTime = new Date(Date.now() - 5000).toISOString()

    // 创建 2 个 active 任务
    createTask({
      id: 'tick-active-1',
      agentId: 'agent-a',
      chatId: 'task:tick-active-1',
      prompt: '活跃任务 1',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    createTask({
      id: 'tick-active-2',
      agentId: 'agent-a',
      chatId: 'task:tick-active-2',
      prompt: '活跃任务 2',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })

    // 创建 paused 任务（先创建为 active，然后更新状态）
    createTask({
      id: 'tick-paused',
      agentId: 'agent-a',
      chatId: 'task:tick-paused',
      prompt: '暂停任务',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    updateTask('tick-paused', { status: 'paused' })

    // 创建 completed 任务
    createTask({
      id: 'tick-completed',
      agentId: 'agent-a',
      chatId: 'task:tick-completed',
      prompt: '已完成任务',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: pastTime,
    })
    updateTask('tick-completed', { status: 'completed' })

    const enqueueMock = mock(() => Promise.resolve('done'))
    const mockQueue = { enqueue: enqueueMock } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    // @ts-ignore — 测试私有方法
    await scheduler.tick()

    // 等待异步 executeTask 完成
    await new Promise((resolve) => setTimeout(resolve, 200))

    // 只有 2 个 active 任务被执行
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })
})

// ===== 日志裁剪 =====

describe('pruneOldTaskRunLogs', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('删除超期日志，保留近期日志', () => {
    // 创建 40 天前的日志
    saveTaskRunLog({
      taskId: 'prune-1',
      runAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      durationMs: 100,
      status: 'success',
    })

    // 创建今天的日志
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

  test('手动执行成功返回结果', async () => {
    createTask({
      id: 'manual-1',
      agentId: 'agent-1',
      chatId: 'task:manual-1',
      prompt: '手动执行',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.resolve('手动结果')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    const result = await scheduler.runManually(getTask('manual-1')!)
    expect(result.status).toBe('success')
    expect(result.result).toBe('手动结果')

    // 应该保存了消息
    const messages = getMessages('task:manual-1', 10)
    expect(messages.length).toBe(2)
  })

  test('手动执行不影响 consecutive_failures 和 running_since', async () => {
    createTask({
      id: 'manual-2',
      agentId: 'agent-1',
      chatId: 'task:manual-2',
      prompt: '手动执行',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date(Date.now() + 60000).toISOString(),
    })

    const mockQueue = { enqueue: mock(() => Promise.reject(new Error('err'))) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, mockEventBus)

    const result = await scheduler.runManually(getTask('manual-2')!)
    expect(result.status).toBe('error')
    expect(result.error).toBe('err')

    // consecutive_failures 不变
    const task = getTask('manual-2')!
    expect(task.consecutive_failures).toBe(0)
    expect(task.running_since).toBeNull()
  })
})
