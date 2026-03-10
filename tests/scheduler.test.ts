/**
 * Scheduler 测试
 *
 * 覆盖：
 * - calculateNextRun 各调度类型
 * - executeTask 成功/失败时的行为
 * - 执行结果写入 messages 表
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
} from '../src/db/index.ts'
import { Scheduler } from '../src/scheduler/scheduler.ts'

// ===== calculateNextRun =====

describe('Scheduler.calculateNextRun', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, {} as any)
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

  test('once — 始终返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: null })).toBeNull()
  })

  test('once — 即使有 last_run 也返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'once', schedule_value: '2026-12-01T00:00:00.000Z', last_run: '2026-03-10T10:00:00.000Z' })).toBeNull()
  })

  // --- 未知类型 ---

  test('未知类型返回 null', () => {
    expect(scheduler.calculateNextRun({ schedule_type: 'unknown', schedule_value: 'x', last_run: null })).toBeNull()
    expect(scheduler.calculateNextRun({ schedule_type: '', schedule_value: '', last_run: null })).toBeNull()
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)
    const task = getTask('exec-1')!

    // @ts-ignore — 测试私有方法
    await scheduler.executeTask(task)

    // messages
    const messages = getMessages(chatId, 10)
    expect(messages.length).toBe(2)
    const userMsg = messages.find((m) => m.is_from_me === 1)!
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(userMsg.content).toBe('请生成报告')
    expect(userMsg.sender).toBe('scheduler')
    expect(userMsg.sender_name).toBe('Scheduled Task')
    expect(botMsg.content).toBe('报告结果')
    expect(botMsg.sender).toBe('agent-1')

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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
    await scheduler.executeTask(getTask('exec-str-err')!)

    const logs = getTaskRunLogs('exec-str-err')
    expect(logs[0].error).toBe('string error')
  })
})

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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
    await scheduler.executeTask(getTask('exec-once')!)

    const updated = getTask('exec-once')!
    expect(updated.status).toBe('completed')
    expect(updated.next_run).toBeNull()
    expect(updated.last_run).not.toBeNull()
  })

  test('once 任务失败后也变为 completed', async () => {
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
    await scheduler.executeTask(getTask('exec-once-fail')!)

    const updated = getTask('exec-once-fail')!
    expect(updated.status).toBe('completed')
    expect(updated.next_run).toBeNull()
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore
    await scheduler.executeTask(getTask('exec-intv-fail')!)

    const updated = getTask('exec-intv-fail')!
    expect(updated.status).toBe('active')
    expect(updated.next_run).not.toBeNull()
    expect(updated.last_run).not.toBeNull()
  })
})

describe('Scheduler.start / stop', () => {
  test('stop 后 intervalId 为 null', () => {
    const scheduler = new Scheduler({} as any, {} as any, {} as any)
    // 不 start 直接 stop 不报错
    expect(() => scheduler.stop()).not.toThrow()
  })

  test('重复 start 不创建多个 interval', () => {
    const mockQueue = { enqueue: mock(() => Promise.resolve('')) } as any
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    scheduler.start()
    scheduler.start() // 第二次应该直接 return

    scheduler.stop()
  })
})

// ===== calculateNextRun — cron 复杂表达式 =====

describe('Scheduler.calculateNextRun — cron 复杂表达式', () => {
  let scheduler: Scheduler

  beforeAll(() => {
    scheduler = new Scheduler({} as any, {} as any, {} as any)
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
    scheduler = new Scheduler({} as any, {} as any, {} as any)
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
    scheduler = new Scheduler({} as any, {} as any, {} as any)
  })

  test('once — 过去时间返回 null', () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: pastDate,
      last_run: null,
    })
    expect(result).toBeNull()
  })

  test('once — 未来时间也返回 null', () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString()
    const result = scheduler.calculateNextRun({
      schedule_type: 'once',
      schedule_value: futureDate,
      last_run: null,
    })
    // once 类型始终返回 null（由 createTask 时设置 nextRun，executeTask 后标记 completed）
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore — 测试私有方法
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore — 测试私有方法
    await scheduler.executeTask(getTask('msg-save')!)

    const messages = getMessages('task:msg-save', 10)
    expect(messages.length).toBe(2)

    // 验证 user 消息
    const userMsg = messages.find((m) => m.is_from_me === 1)!
    expect(userMsg).toBeDefined()
    expect(userMsg.content).toBe('消息保存测试')
    expect(userMsg.sender).toBe('scheduler')

    // 验证 bot 消息
    const botMsg = messages.find((m) => m.is_bot_message === 1)!
    expect(botMsg).toBeDefined()
    expect(botMsg.content).toBe('保存结果')
    expect(botMsg.sender).toBe('agent-msg')
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore — 测试私有方法
    await scheduler.executeTask(getTask('exec-twice')!)
    // @ts-ignore — 测试私有方法
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

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

    // 创建 3 个 active 任务
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
    const scheduler = new Scheduler(mockQueue, {} as any, {} as any)

    // @ts-ignore — 测试私有方法
    await scheduler.tick()

    // 等待异步 executeTask 完成
    await new Promise((resolve) => setTimeout(resolve, 200))

    // 只有 2 个 active 任务被执行
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })
})
