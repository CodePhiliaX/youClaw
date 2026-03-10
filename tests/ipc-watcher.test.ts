/**
 * IPC Watcher 测试
 *
 * 覆盖：
 * - schedule_task 消息分发（含 name/description）
 * - pause_task / resume_task / cancel_task 分发
 * - 缺少字段时抛出错误
 * - 未知消息类型抛出错误
 * - JSON 文件处理（写入 → 读取 → 删除）
 * - 错误文件移到 errors 目录
 * - writeTasksSnapshot 写入快照
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import './setup.ts'
import { getPaths } from '../src/config/index.ts'
import { IpcWatcher, writeTasksSnapshot } from '../src/ipc/watcher.ts'

const ipcDir = resolve(getPaths().data, 'ipc')

function setupAgentTasksDir(agentId: string): string {
  const tasksDir = join(ipcDir, agentId, 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  return tasksDir
}

function cleanIpcDir() {
  try { rmSync(ipcDir, { recursive: true, force: true }) } catch {}
}

// ===== dispatch 分发逻辑 =====

describe('IpcWatcher — dispatch 分发', () => {
  test('schedule_task 传递 name 和 description', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — 测试私有方法
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'test prompt',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-1',
      name: '任务名',
      description: '任务描述',
    }, 'agent-x')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('test prompt')
    expect(arg.scheduleType).toBe('cron')
    expect(arg.scheduleValue).toBe('0 9 * * *')
    expect(arg.agentId).toBe('agent-x')
    expect(arg.chatId).toBe('chat-1')
    expect(arg.name).toBe('任务名')
    expect(arg.description).toBe('任务描述')
  })

  test('schedule_task 不传 name/description 时为 undefined', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
    }, 'agent-y')

    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBeUndefined()
    expect(arg.description).toBeUndefined()
  })

  test('schedule_task 缺少必要字段抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'schedule_task', prompt: '', schedule_type: 'cron', schedule_value: '0 9 * * *', chatId: 'c' }, 'a')
    }).toThrow('缺少必要字段')

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'schedule_task', prompt: 'p', schedule_type: '', schedule_value: '0 9 * * *', chatId: 'c' }, 'a')
    }).toThrow('缺少必要字段')
  })

  test('pause_task 分发', () => {
    const onPauseTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask,
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({ type: 'pause_task', taskId: 'task-123' }, 'agent-1')
    expect(onPauseTask).toHaveBeenCalledWith('task-123')
  })

  test('pause_task 缺少 taskId 抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'pause_task', taskId: '' }, 'a')
    }).toThrow('缺少必要字段')
  })

  test('resume_task 分发', () => {
    const onResumeTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask,
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({ type: 'resume_task', taskId: 'task-456' }, 'agent-1')
    expect(onResumeTask).toHaveBeenCalledWith('task-456')
  })

  test('resume_task 缺少 taskId 抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'resume_task', taskId: '' }, 'a')
    }).toThrow('缺少必要字段')
  })

  test('cancel_task 分发', () => {
    const onCancelTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask,
    })

    // @ts-ignore
    watcher.dispatch({ type: 'cancel_task', taskId: 'task-789' }, 'agent-1')
    expect(onCancelTask).toHaveBeenCalledWith('task-789')
  })

  test('cancel_task 缺少 taskId 抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'cancel_task', taskId: '' }, 'a')
    }).toThrow('缺少必要字段')
  })

  test('未知消息类型抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({ type: 'unknown_type' }, 'a')
    }).toThrow('未知 IPC 消息类型')
  })
})

// ===== processFile 文件处理 =====

describe('IpcWatcher — 文件处理', () => {
  afterEach(() => cleanIpcDir())

  test('成功处理 JSON 文件后删除', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '1000-abc.json')
    writeFileSync(filePath, JSON.stringify({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
      name: '文件测试',
    }))

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    expect(existsSync(filePath)).toBe(false) // 文件已删除
  })

  test('无效 JSON 移到 errors 目录', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '2000-bad.json')
    writeFileSync(filePath, 'not valid json {{{')

    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(existsSync(filePath)).toBe(false) // 原文件已删除
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
    const errorFiles = readdirSync(errorsDir)
    expect(errorFiles.length).toBeGreaterThan(0)
  })

  test('分发出错时移到 errors 目录', async () => {
    const tasksDir = setupAgentTasksDir('test-agent')
    const filePath = join(tasksDir, '3000-fail.json')
    // 缺少必要字段会导致 dispatch 抛错
    writeFileSync(filePath, JSON.stringify({
      type: 'schedule_task',
      prompt: '',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'c',
    }))

    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'test-agent')

    expect(existsSync(filePath)).toBe(false)
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
  })
})

// ===== writeTasksSnapshot =====

describe('writeTasksSnapshot', () => {
  afterEach(() => cleanIpcDir())

  test('写入快照文件', async () => {
    writeTasksSnapshot('snap-agent', [
      { id: 't1', prompt: 'p1', schedule_type: 'interval', schedule_value: '60000', status: 'active', next_run: '2026-03-10T10:00:00.000Z', last_run: null },
      { id: 't2', prompt: 'p2', schedule_type: 'cron', schedule_value: '0 9 * * *', status: 'paused', next_run: null, last_run: '2026-03-09T09:00:00.000Z' },
    ])

    const snapshotPath = join(ipcDir, 'snap-agent', 'current_tasks.json')
    expect(existsSync(snapshotPath)).toBe(true)

    const content = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    expect(content.updatedAt).toBeTruthy()
    expect(content.tasks.length).toBe(2)
    expect(content.tasks[0].id).toBe('t1')
    expect(content.tasks[1].status).toBe('paused')
  })

  test('空任务列表写入空数组', async () => {
    writeTasksSnapshot('empty-agent', [])

    const snapshotPath = join(ipcDir, 'empty-agent', 'current_tasks.json')
    const content = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    expect(content.tasks.length).toBe(0)
  })

  test('覆盖已有快照', async () => {
    writeTasksSnapshot('overwrite-agent', [
      { id: 't1', prompt: 'old', schedule_type: 'interval', schedule_value: '60000', status: 'active', next_run: null, last_run: null },
    ])
    writeTasksSnapshot('overwrite-agent', [
      { id: 't2', prompt: 'new', schedule_type: 'cron', schedule_value: '* * * * *', status: 'active', next_run: null, last_run: null },
    ])

    const snapshotPath = join(ipcDir, 'overwrite-agent', 'current_tasks.json')
    const content = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    expect(content.tasks.length).toBe(1)
    expect(content.tasks[0].id).toBe('t2')
  })
})

// ===== start / stop =====

describe('IpcWatcher start/stop', () => {
  test('stop 不报错', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    expect(() => watcher.stop()).not.toThrow()
  })

  test('start + stop 正常', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    watcher.start()
    watcher.stop()
  })

  test('重复 start 不创建多个 interval', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })
    watcher.start()
    watcher.start() // 第二次应直接 return
    watcher.stop()
  })
})

// ===== 新增测试场景 =====

describe('IpcWatcher — dispatch schedule_task 各 schedule_type 验证', () => {
  test('schedule_type=interval + schedule_value=60000', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — 测试私有方法
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'interval task',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-interval',
    }, 'agent-interval')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('interval task')
    expect(arg.scheduleType).toBe('interval')
    expect(arg.scheduleValue).toBe('60000')
    expect(arg.agentId).toBe('agent-interval')
    expect(arg.chatId).toBe('chat-interval')
  })

  test('schedule_type=once + schedule_value=ISO date', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    const isoDate = '2026-04-01T12:00:00.000Z'

    // @ts-ignore — 测试私有方法
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'once task',
      schedule_type: 'once',
      schedule_value: isoDate,
      chatId: 'chat-once',
    }, 'agent-once')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.prompt).toBe('once task')
    expect(arg.scheduleType).toBe('once')
    expect(arg.scheduleValue).toBe(isoDate)
    expect(arg.agentId).toBe('agent-once')
    expect(arg.chatId).toBe('chat-once')
  })
})

describe('IpcWatcher — dispatch schedule_task 可选字段组合', () => {
  test('只传 name 不传 description', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'name only',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-n',
      name: '仅名称',
    }, 'agent-n')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBe('仅名称')
    expect(arg.description).toBeUndefined()
  })

  test('只传 description 不传 name', () => {
    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    watcher.dispatch({
      type: 'schedule_task',
      prompt: 'desc only',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-d',
      description: '仅描述',
    }, 'agent-d')

    expect(onScheduleTask).toHaveBeenCalledTimes(1)
    const arg = onScheduleTask.mock.calls[0][0]
    expect(arg.name).toBeUndefined()
    expect(arg.description).toBe('仅描述')
  })
})

describe('IpcWatcher — dispatch schedule_task 缺少字段', () => {
  test('缺少 chatId 抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({
        type: 'schedule_task',
        prompt: 'valid prompt',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
      }, 'agent-no-chat')
    }).toThrow('缺少必要字段')
  })

  test('缺少 schedule_value 抛出错误', () => {
    const watcher = new IpcWatcher({
      onScheduleTask: () => {},
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    expect(() => {
      // @ts-ignore
      watcher.dispatch({
        type: 'schedule_task',
        prompt: 'valid prompt',
        schedule_type: 'cron',
        chatId: 'chat-1',
      }, 'agent-no-sv')
    }).toThrow('缺少必要字段')
  })
})

describe('IpcWatcher — 文件处理（扩展场景）', () => {
  afterEach(() => cleanIpcDir())

  test('非 JSON 扩展名文件被忽略', async () => {
    const tasksDir = setupAgentTasksDir('txt-agent')
    const txtPath = join(tasksDir, '1000-note.txt')
    writeFileSync(txtPath, 'this is plain text')

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // tick 内部通过 filter(f => f.endsWith('.json')) 过滤文件，
    // 因此 .txt 文件不会传入 processFile
    // @ts-ignore — 测试私有方法
    await watcher.tick()

    expect(onScheduleTask).toHaveBeenCalledTimes(0)
    // .txt 文件应仍然存在（未被处理也未被删除）
    expect(existsSync(txtPath)).toBe(true)
  })

  test('空 JSON 对象 {} 被移到 errors 目录', async () => {
    const tasksDir = setupAgentTasksDir('empty-json-agent')
    const filePath = join(tasksDir, '1000-empty.json')
    writeFileSync(filePath, '{}')

    const onScheduleTask = mock(() => {})
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore
    await watcher.processFile(filePath, 'empty-json-agent')

    // {} 没有 type 字段，dispatch 会抛出 "未知 IPC 消息类型"
    expect(onScheduleTask).toHaveBeenCalledTimes(0)
    expect(existsSync(filePath)).toBe(false) // 原文件已删除
    const errorsDir = join(ipcDir, 'errors')
    expect(existsSync(errorsDir)).toBe(true)
    const errorFiles = readdirSync(errorsDir)
    expect(errorFiles.length).toBeGreaterThan(0)
  })

  test('多个文件处理顺序', async () => {
    const tasksDir = setupAgentTasksDir('multi-agent')
    const calls: string[] = []

    // 创建多个文件，时间戳前缀不同
    writeFileSync(join(tasksDir, '2000-b.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'second',
      schedule_type: 'interval',
      schedule_value: '30000',
      chatId: 'chat-2',
    }))
    writeFileSync(join(tasksDir, '1000-a.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'first',
      schedule_type: 'interval',
      schedule_value: '60000',
      chatId: 'chat-1',
    }))
    writeFileSync(join(tasksDir, '3000-c.json'), JSON.stringify({
      type: 'schedule_task',
      prompt: 'third',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      chatId: 'chat-3',
    }))

    const onScheduleTask = mock((data: { prompt: string }) => {
      calls.push(data.prompt)
    })
    const watcher = new IpcWatcher({
      onScheduleTask,
      onPauseTask: () => {},
      onResumeTask: () => {},
      onCancelTask: () => {},
    })

    // @ts-ignore — tick 按文件名排序处理
    await watcher.tick()

    expect(onScheduleTask).toHaveBeenCalledTimes(3)
    // tick 内 sort() 按文件名排序：1000-a < 2000-b < 3000-c
    expect(calls).toEqual(['first', 'second', 'third'])
  })
})

describe('writeTasksSnapshot — 扩展场景', () => {
  afterEach(() => cleanIpcDir())

  test('包含 name 和 description 字段', () => {
    writeTasksSnapshot('named-agent', [
      {
        id: 't-named',
        prompt: 'named task',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        status: 'active',
        next_run: '2026-03-11T09:00:00.000Z',
        last_run: null,
        name: '定时报告',
        description: '每天9点生成报告',
      } as any,
    ])

    const snapshotPath = join(ipcDir, 'named-agent', 'current_tasks.json')
    expect(existsSync(snapshotPath)).toBe(true)

    const content = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    expect(content.tasks.length).toBe(1)
    expect(content.tasks[0].name).toBe('定时报告')
    expect(content.tasks[0].description).toBe('每天9点生成报告')
    expect(content.tasks[0].id).toBe('t-named')
  })

  test('大量任务（100 个）写入正确', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `task-${i}`,
      prompt: `prompt-${i}`,
      schedule_type: 'interval',
      schedule_value: `${(i + 1) * 1000}`,
      status: i % 2 === 0 ? 'active' : 'paused',
      next_run: null,
      last_run: null,
    }))

    writeTasksSnapshot('bulk-agent', tasks)

    const snapshotPath = join(ipcDir, 'bulk-agent', 'current_tasks.json')
    expect(existsSync(snapshotPath)).toBe(true)

    const content = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    expect(content.tasks.length).toBe(100)
    expect(content.tasks[0].id).toBe('task-0')
    expect(content.tasks[99].id).toBe('task-99')
    expect(content.tasks[50].prompt).toBe('prompt-50')
    expect(content.tasks[1].status).toBe('paused')
    expect(content.tasks[2].status).toBe('active')
    expect(content.updatedAt).toBeTruthy()
  })
})
