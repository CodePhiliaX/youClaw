/**
 * 数据库定时任务 CRUD 测试
 *
 * 覆盖 createTask / getTask / getTasks / updateTask / deleteTask / getTasksDueBy
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

  test('不传 name/description，字段为 null', () => {
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

  test('传入 name 和 description', () => {
    createTask({
      id: 'ct-2',
      agentId: 'agent-1',
      chatId: 'task:def',
      prompt: 'do something',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      nextRun: new Date().toISOString(),
      name: '每日报告',
      description: '每天早上9点生成日报',
    })

    const task = getTask('ct-2')
    expect(task!.name).toBe('每日报告')
    expect(task!.description).toBe('每天早上9点生成日报')
    expect(task!.schedule_type).toBe('cron')
    expect(task!.schedule_value).toBe('0 9 * * *')
  })

  test('只传 name 不传 description', () => {
    createTask({
      id: 'ct-3',
      agentId: 'agent-1',
      chatId: 'task:ghi',
      prompt: 'check health',
      scheduleType: 'interval',
      scheduleValue: '300000',
      nextRun: new Date().toISOString(),
      name: '健康检查',
    })

    const task = getTask('ct-3')
    expect(task!.name).toBe('健康检查')
    expect(task!.description).toBeNull()
  })

  test('created_at 自动设置', () => {
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

  test('存在的任务返回完整对象', () => {
    createTask({
      id: 'gt-1',
      agentId: 'agent-x',
      chatId: 'task:gt',
      prompt: 'test prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: '2026-03-10T10:00:00.000Z',
      name: '测试',
      description: '描述',
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
    expect(task.name).toBe('测试')
    expect(task.description).toBe('描述')
  })

  test('不存在的任务返回 null', () => {
    expect(getTask('non-existent')).toBeNull()
  })
})

describe('getTasks', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('返回所有任务', () => {
    createTask({ id: 'lt-1', agentId: 'a', chatId: 'c1', prompt: 'p1', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
    createTask({ id: 'lt-2', agentId: 'b', chatId: 'c2', prompt: 'p2', scheduleType: 'cron', scheduleValue: '0 9 * * *', nextRun: new Date().toISOString() })

    const tasks = getTasks()
    expect(tasks.length).toBe(2)
    const ids = tasks.map((t) => t.id).sort()
    expect(ids).toEqual(['lt-1', 'lt-2'])
  })

  test('空表返回空数组', () => {
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

  test('更新 name', () => {
    updateTask('ut-1', { name: '新名称' })
    expect(getTask('ut-1')!.name).toBe('新名称')
  })

  test('更新 description', () => {
    updateTask('ut-1', { description: '新描述' })
    expect(getTask('ut-1')!.description).toBe('新描述')
  })

  test('更新 prompt', () => {
    updateTask('ut-1', { prompt: 'updated prompt' })
    expect(getTask('ut-1')!.prompt).toBe('updated prompt')
  })

  test('更新 status', () => {
    updateTask('ut-1', { status: 'paused' })
    expect(getTask('ut-1')!.status).toBe('paused')
  })

  test('更新 scheduleValue', () => {
    updateTask('ut-1', { scheduleValue: '120000' })
    expect(getTask('ut-1')!.schedule_value).toBe('120000')
  })

  test('更新 nextRun', () => {
    const next = '2026-06-01T00:00:00.000Z'
    updateTask('ut-1', { nextRun: next })
    expect(getTask('ut-1')!.next_run).toBe(next)
  })

  test('更新 nextRun 为 null', () => {
    updateTask('ut-1', { nextRun: null })
    expect(getTask('ut-1')!.next_run).toBeNull()
  })

  test('更新 lastRun', () => {
    const lastRun = new Date().toISOString()
    updateTask('ut-1', { lastRun })
    expect(getTask('ut-1')!.last_run).toBe(lastRun)
  })

  test('同时更新多个字段', () => {
    updateTask('ut-1', {
      name: '批量更新',
      description: '批量描述',
      prompt: '新 prompt',
      status: 'paused',
    })
    const task = getTask('ut-1')!
    expect(task.name).toBe('批量更新')
    expect(task.description).toBe('批量描述')
    expect(task.prompt).toBe('新 prompt')
    expect(task.status).toBe('paused')
  })

  test('空 updates 不报错', () => {
    expect(() => updateTask('ut-1', {})).not.toThrow()
    // 原数据不变
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
      name: '待删除',
    })
    saveTaskRunLog({ taskId: 'del-1', runAt: new Date().toISOString(), durationMs: 100, status: 'success', result: 'ok' })
    saveTaskRunLog({ taskId: 'del-1', runAt: new Date().toISOString(), durationMs: 200, status: 'error', error: 'fail' })
  })

  test('删除任务后，任务和日志都消失', () => {
    expect(getTask('del-1')).not.toBeNull()
    expect(getTaskRunLogs('del-1').length).toBe(2)

    deleteTask('del-1')

    expect(getTask('del-1')).toBeNull()
    expect(getTaskRunLogs('del-1').length).toBe(0)
  })

  test('删除不存在的任务不报错', () => {
    expect(() => deleteTask('non-existent')).not.toThrow()
  })
})

describe('getTasksDueBy', () => {
  beforeEach(() => {
    cleanTables('scheduled_tasks')

    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 3_600_000).toISOString()

    // active + 已到期
    createTask({ id: 'due-1', agentId: 'a', chatId: 'c1', prompt: 'past active', scheduleType: 'interval', scheduleValue: '60000', nextRun: past })
    // active + 未到期
    createTask({ id: 'due-2', agentId: 'a', chatId: 'c2', prompt: 'future active', scheduleType: 'interval', scheduleValue: '60000', nextRun: future })
    // paused + 已到期
    createTask({ id: 'due-3', agentId: 'a', chatId: 'c3', prompt: 'past paused', scheduleType: 'interval', scheduleValue: '60000', nextRun: past })
    updateTask('due-3', { status: 'paused' })
    // completed + 已到期
    createTask({ id: 'due-4', agentId: 'a', chatId: 'c4', prompt: 'past completed', scheduleType: 'once', scheduleValue: past, nextRun: past })
    updateTask('due-4', { status: 'completed' })
    // active + null nextRun
    createTask({ id: 'due-5', agentId: 'a', chatId: 'c5', prompt: 'null next', scheduleType: 'once', scheduleValue: past, nextRun: past })
    updateTask('due-5', { nextRun: null })
  })

  test('只返回 active 且 next_run <= 当前时间的任务', () => {
    const due = getTasksDueBy(new Date().toISOString())
    expect(due.length).toBe(1)
    expect(due[0].id).toBe('due-1')
  })

  test('没有到期任务时返回空数组', () => {
    cleanTables('scheduled_tasks')
    expect(getTasksDueBy(new Date().toISOString()).length).toBe(0)
  })
})

describe('saveTaskRunLog + getTaskRunLogs', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('保存成功日志', () => {
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

  test('保存失败日志', () => {
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

  test('多条日志按 run_at DESC 排序', () => {
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T08:00:00.000Z', durationMs: 100, status: 'success' })
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T10:00:00.000Z', durationMs: 200, status: 'success' })
    saveTaskRunLog({ taskId: 'log-multi', runAt: '2026-03-10T09:00:00.000Z', durationMs: 150, status: 'error', error: 'err' })

    const logs = getTaskRunLogs('log-multi')
    expect(logs.length).toBe(3)
    expect(logs[0].run_at).toBe('2026-03-10T10:00:00.000Z')
    expect(logs[1].run_at).toBe('2026-03-10T09:00:00.000Z')
    expect(logs[2].run_at).toBe('2026-03-10T08:00:00.000Z')
  })

  test('limit 参数限制返回数量', () => {
    for (let i = 0; i < 10; i++) {
      saveTaskRunLog({ taskId: 'log-limit', runAt: new Date(Date.now() + i * 1000).toISOString(), durationMs: 100, status: 'success' })
    }

    const logs = getTaskRunLogs('log-limit', 3)
    expect(logs.length).toBe(3)
  })

  test('不存在的 taskId 返回空数组', () => {
    expect(getTaskRunLogs('non-existent').length).toBe(0)
  })
})

// ===== 新增测试场景 =====

describe('createTask — 特殊字符', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('name 包含引号、HTML 标签、& 符号，description 包含 emoji，正确存储和读取', () => {
    createTask({
      id: 'special-1',
      agentId: 'agent-1',
      chatId: 'task:special',
      prompt: 'test special chars',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: '\'引号"双引号<html>&amp;',
      description: '🔥🚀',
    })

    const task = getTask('special-1')
    expect(task).not.toBeNull()
    expect(task!.name).toBe('\'引号"双引号<html>&amp;')
    expect(task!.description).toBe('🔥🚀')
  })
})

describe('createTask — 超长字符串', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('10000 字符的 prompt 正确存储', () => {
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

describe('createTask — 重复 ID', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('插入重复 ID 应抛出 UNIQUE 约束错误', () => {
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

    // 原数据不变
    const task = getTask('dup-1')
    expect(task!.prompt).toBe('first')
    expect(task!.agent_id).toBe('agent-1')
  })
})

describe('updateTask — 更新不存在的任务', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('对不存在的 ID 调用 updateTask 不抛出异常', () => {
    expect(() => updateTask('non-existent-id', { name: '幽灵任务' })).not.toThrow()
    // 确认没有创建任何记录
    expect(getTask('non-existent-id')).toBeNull()
  })
})

describe('updateTask — name 设为空字符串', () => {
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
      name: '原始名称',
    })
  })

  test('name 更新为空字符串后存储为空字符串而非 null', () => {
    updateTask('empty-name-1', { name: '' })
    const task = getTask('empty-name-1')
    expect(task).not.toBeNull()
    expect(task!.name).toBe('')
    expect(task!.name).not.toBeNull()
  })
})

describe('getTasksDueBy — 多个到期任务按预期返回', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('3 个 active 且已到期的任务全部返回', () => {
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

describe('getTasksDueBy — 精确边界测试', () => {
  beforeEach(() => cleanTables('scheduled_tasks'))

  test('nextRun 恰好等于 cutoff 时间的任务应被返回（<=）', () => {
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

describe('saveTaskRunLog — result 和 error 都传', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('同时传入 result 和 error，两者都正确存储', () => {
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

describe('saveTaskRunLog — 非常大的 result', () => {
  beforeEach(() => cleanTables('task_run_logs'))

  test('50000 字符的 result 正确存储', () => {
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

describe('deleteTask — 删除后重新创建同 ID', () => {
  beforeEach(() => cleanTables('scheduled_tasks', 'task_run_logs'))

  test('创建、删除、再创建同 ID 的任务不报错且数据正确', () => {
    createTask({
      id: 'recreate-1',
      agentId: 'agent-1',
      chatId: 'task:old',
      prompt: 'old prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
      nextRun: new Date().toISOString(),
      name: '旧任务',
    })

    expect(getTask('recreate-1')).not.toBeNull()
    expect(getTask('recreate-1')!.name).toBe('旧任务')

    deleteTask('recreate-1')
    expect(getTask('recreate-1')).toBeNull()

    // 使用同 ID 重新创建
    createTask({
      id: 'recreate-1',
      agentId: 'agent-2',
      chatId: 'task:new',
      prompt: 'new prompt',
      scheduleType: 'cron',
      scheduleValue: '0 12 * * *',
      nextRun: new Date().toISOString(),
      name: '新任务',
    })

    const task = getTask('recreate-1')
    expect(task).not.toBeNull()
    expect(task!.agent_id).toBe('agent-2')
    expect(task!.chat_id).toBe('task:new')
    expect(task!.prompt).toBe('new prompt')
    expect(task!.schedule_type).toBe('cron')
    expect(task!.name).toBe('新任务')
  })
})
