/**
 * REST API tasks routes tests
 *
 * Coverage:
 * - GET /tasks
 * - POST /tasks (with name/description, validation)
 * - PUT /tasks/:id (with name/description/scheduleType)
 * - POST /tasks/:id/clone
 * - DELETE /tasks/:id
 * - POST /tasks/:id/run (with messages persistence)
 * - GET /tasks/:id/logs
 */

import { describe, test, expect, beforeAll, beforeEach, mock } from 'bun:test'
import { cleanTables } from './setup.ts'
import {
  createTask,
  getTask,
  getTasks,
  saveTaskRunLog,
  getMessages,
  getChats,
  getTaskRunLogs,
} from '../src/db/index.ts'
import type { ScheduledTask } from '../src/db/index.ts'
import { createTasksRoutes } from '../src/routes/tasks.ts'

let app: ReturnType<typeof createTasksRoutes>
let mockAgentQueue: any

beforeAll(() => {
  mockAgentQueue = {
    enqueue: mock(() => Promise.resolve('agent response')),
  }

  const mockScheduler = {
    calculateNextRun: (task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'last_run'>) => {
      if (task.schedule_type === 'interval') {
        const ms = parseInt(task.schedule_value, 10)
        if (isNaN(ms) || ms <= 0) return null
        const base = task.last_run ? new Date(task.last_run) : new Date()
        return new Date(base.getTime() + ms).toISOString()
      }
      if (task.schedule_type === 'once') return null
      if (task.schedule_type === 'cron') return new Date(Date.now() + 60_000).toISOString()
      return null
    },
    runManually: async (task: ScheduledTask) => {
      try {
        const result = await mockAgentQueue.enqueue(task.agent_id, task.chat_id, task.prompt)
        // Simulate saveTaskMessages
        const { saveMessage, upsertChat } = await import('../src/db/index.ts')
        const runId = crypto.randomUUID().slice(0, 8)
        const runAt = new Date().toISOString()
        saveMessage({ id: `${task.id}-${runId}-${runAt}-user`, chatId: task.chat_id, sender: 'manual', senderName: 'Manual Run', content: task.prompt, timestamp: runAt, isFromMe: true, isBotMessage: false })
        saveMessage({ id: `${task.id}-${runId}-${runAt}-bot`, chatId: task.chat_id, sender: task.agent_id, senderName: task.agent_id, content: result ?? '(no output)', timestamp: new Date().toISOString(), isFromMe: false, isBotMessage: true })
        const taskName = task.name || task.prompt.slice(0, 30)
        upsertChat(task.chat_id, task.agent_id, `Task: ${taskName}`, 'task')
        return { status: 'success', result: result ?? undefined }
      } catch (err: any) {
        return { status: 'error', error: err instanceof Error ? err.message : String(err) }
      }
    },
  } as any

  const mockAgentManager = {
    getAgent: (id: string) => (id === 'agent-1' || id === 'agent-2') ? { id } : undefined,
  } as any

  app = createTasksRoutes(mockScheduler, mockAgentManager, mockAgentQueue)
})

beforeEach(() => cleanTables('scheduled_tasks', 'task_run_logs', 'messages', 'chats'))

// ===== GET /tasks =====

describe('GET /tasks', () => {
  test('empty list', async () => {
    const res = await app.request('/tasks')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test('returns all tasks', async () => {
    createTask({ id: 'g1', agentId: 'agent-1', chatId: 'c1', prompt: 'p1', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Task1' })
    createTask({ id: 'g2', agentId: 'agent-1', chatId: 'c2', prompt: 'p2', scheduleType: 'cron', scheduleValue: '0 9 * * *', nextRun: new Date().toISOString() })

    const res = await app.request('/tasks')
    const body = await res.json() as any[]
    expect(body.length).toBe(2)
  })

  test('response includes name and description fields', async () => {
    createTask({ id: 'g3', agentId: 'agent-1', chatId: 'c3', prompt: 'p3', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Named', description: 'Has description' })

    const res = await app.request('/tasks')
    const body = await res.json() as any[]
    expect(body[0].name).toBe('Named')
    expect(body[0].description).toBe('Has description')
  })
})

// ===== POST /tasks =====

describe('POST /tasks', () => {
  test('create task with name/description', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:new', prompt: 'hello',
        scheduleType: 'interval', scheduleValue: '120000',
        name: 'API Task', description: 'API Description',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.name).toBe('API Task')
    expect(body.description).toBe('API Description')
    expect(body.status).toBe('active')
    expect(body.next_run).not.toBeNull()
  })

  test('without name/description', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:no-name', prompt: 'test',
        scheduleType: 'interval', scheduleValue: '60000',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.name).toBeNull()
    expect(body.description).toBeNull()
  })

  test('non-existent agent returns 404', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'non-existent', chatId: 'c', prompt: 'p',
        scheduleType: 'interval', scheduleValue: '60000',
      }),
    })
    expect(res.status).toBe(404)
  })

  test('invalid scheduleType returns 400', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'c', prompt: 'p',
        scheduleType: 'invalid', scheduleValue: '60000',
      }),
    })
    expect(res.status).toBe(400)
  })

  test('invalid scheduleValue (interval NaN) returns 400', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'c', prompt: 'p',
        scheduleType: 'interval', scheduleValue: 'not-a-number',
      }),
    })
    expect(res.status).toBe(400)
  })

  test('once type uses scheduleValue as nextRun', async () => {
    const futureTime = new Date(Date.now() + 86_400_000).toISOString()
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:once', prompt: 'once test',
        scheduleType: 'once', scheduleValue: futureTime,
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.next_run).toBe(futureTime)
  })

  test('cron type calculates nextRun', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:cron', prompt: 'cron test',
        scheduleType: 'cron', scheduleValue: '0 9 * * *',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.next_run).not.toBeNull()
    expect(body.schedule_type).toBe('cron')
  })
})

// ===== PUT /tasks/:id =====

describe('PUT /tasks/:id', () => {
  beforeEach(() => {
    createTask({ id: 'put-1', agentId: 'agent-1', chatId: 'c', prompt: 'original', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
  })

  test('update name + description', async () => {
    const res = await app.request('/tasks/put-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', description: 'New Description' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.name).toBe('New Name')
    expect(body.description).toBe('New Description')
    expect(body.prompt).toBe('original') // Unchanged fields remain the same
  })

  test('update prompt', async () => {
    const res = await app.request('/tasks/put-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'updated prompt' }),
    })
    const body = await res.json() as any
    expect(body.prompt).toBe('updated prompt')
  })

  test('update status', async () => {
    const res = await app.request('/tasks/put-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    const body = await res.json() as any
    expect(body.status).toBe('paused')
  })

  test('updating scheduleValue recalculates nextRun', async () => {
    const before = getTask('put-1')!.next_run
    const res = await app.request('/tasks/put-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleValue: '120000' }),
    })
    const body = await res.json() as any
    expect(body.schedule_value).toBe('120000')
    // nextRun should be recalculated
    expect(body.next_run).not.toBe(before)
  })

  test('non-existent task returns 404', async () => {
    const res = await app.request('/tasks/no-such-id', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})

// ===== POST /tasks/:id/clone =====

describe('POST /tasks/:id/clone', () => {
  test('cloning a named task appends (copy) to name', async () => {
    createTask({ id: 'clone-1', agentId: 'agent-1', chatId: 'c', prompt: 'clone me', scheduleType: 'interval', scheduleValue: '120000', nextRun: new Date().toISOString(), name: 'Original', description: 'Description' })

    const res = await app.request('/tasks/clone-1/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).not.toBe('clone-1')
    expect(body.name).toBe('Original (copy)')
    expect(body.description).toBe('Description')
    expect(body.prompt).toBe('clone me')
    expect(body.schedule_type).toBe('interval')
    expect(body.schedule_value).toBe('120000')
    expect(body.status).toBe('active')
    expect(body.chat_id).not.toBe('c') // New chatId

    expect(getTasks().length).toBe(2)
  })

  test('cloning a task without name keeps name as null', async () => {
    createTask({ id: 'clone-2', agentId: 'agent-1', chatId: 'c', prompt: 'no name', scheduleType: 'cron', scheduleValue: '0 9 * * *', nextRun: new Date().toISOString() })

    const res = await app.request('/tasks/clone-2/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.name).toBeNull()
  })

  test('cloning a non-existent task returns 404', async () => {
    const res = await app.request('/tasks/no-such/clone', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  test('cloning a paused task creates an active task', async () => {
    createTask({ id: 'clone-3', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
    // Pause the original task
    const { updateTask } = await import('../src/db/index.ts')
    updateTask('clone-3', { status: 'paused' })

    const res = await app.request('/tasks/clone-3/clone', { method: 'POST' })
    const body = await res.json() as any
    expect(body.status).toBe('active')
  })
})

// ===== DELETE /tasks/:id =====

describe('DELETE /tasks/:id', () => {
  test('delete an existing task', async () => {
    createTask({ id: 'del-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'once', scheduleValue: new Date().toISOString(), nextRun: new Date().toISOString() })

    const res = await app.request('/tasks/del-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(getTask('del-1')).toBeNull()
  })

  test('deleting a non-existent task returns 404', async () => {
    const res = await app.request('/tasks/no-such', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

// ===== POST /tasks/:id/run =====

describe('POST /tasks/:id/run', () => {
  test('manual run succeeds — returns result and saves messages', async () => {
    const chatId = 'task:run-test'
    createTask({ id: 'run-1', agentId: 'agent-1', chatId, prompt: 'manual test', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Run Test' })

    const res = await app.request('/tasks/run-1/run', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('success')
    expect(body.result).toBe('agent response')

    // messages
    const msgs = getMessages(chatId, 10)
    expect(msgs.length).toBe(2)
    expect(msgs.find((m) => m.is_from_me === 1)!.content).toBe('manual test')
    expect(msgs.find((m) => m.is_from_me === 1)!.sender).toBe('manual')
    expect(msgs.find((m) => m.is_bot_message === 1)!.content).toBe('agent response')

    // chat
    const chat = getChats().find((c) => c.chat_id === chatId)!
    expect(chat.name).toBe('Task: Run Test')
    expect(chat.channel).toBe('task')
  })

  test('running a non-existent task returns 404', async () => {
    const res = await app.request('/tasks/no-such/run', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  test('run failure returns 500 + error', async () => {
    createTask({ id: 'run-fail', agentId: 'agent-1', chatId: 'task:rf', prompt: 'fail', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    // Temporarily mock failure
    const originalEnqueue = mockAgentQueue.enqueue
    mockAgentQueue.enqueue = mock(() => Promise.reject(new Error('run error')))

    const res = await app.request('/tasks/run-fail/run', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.status).toBe('error')
    expect(body.error).toBe('run error')

    // Restore
    mockAgentQueue.enqueue = originalEnqueue
  })
})

// ===== GET /tasks/:id/logs =====

describe('GET /tasks/:id/logs', () => {
  test('returns run logs for the task', async () => {
    createTask({ id: 'log-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
    saveTaskRunLog({ taskId: 'log-1', runAt: '2026-03-10T10:00:00.000Z', durationMs: 1000, status: 'success', result: 'ok' })
    saveTaskRunLog({ taskId: 'log-1', runAt: '2026-03-10T11:00:00.000Z', durationMs: 500, status: 'error', error: 'err' })

    const res = await app.request('/tasks/log-1/logs')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body.length).toBe(2)
    // DESC order
    expect(body[0].run_at).toBe('2026-03-10T11:00:00.000Z')
    expect(body[1].run_at).toBe('2026-03-10T10:00:00.000Z')
  })

  test('non-existent task returns 404', async () => {
    const res = await app.request('/tasks/no-such/logs')
    expect(res.status).toBe(404)
  })

  test('no logs returns empty array', async () => {
    createTask({ id: 'log-empty', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    const res = await app.request('/tasks/log-empty/logs')
    const body = await res.json() as any[]
    expect(body.length).toBe(0)
  })
})

// ===== Additional test scenarios =====

describe('PUT /tasks/:id — change scheduleType', () => {
  test('changing from interval to cron recalculates nextRun', async () => {
    createTask({ id: 'put-st-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    const before = getTask('put-st-1')!
    const res = await app.request('/tasks/put-st-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleType: 'cron', scheduleValue: '0 9 * * *' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    // scheduleValue has been updated
    expect(body.schedule_value).toBe('0 9 * * *')
    // nextRun has been recalculated (different from before)
    expect(body.next_run).not.toBe(before.next_run)
    expect(body.next_run).not.toBeNull()
  })
})

describe('PUT /tasks/:id — update name and description', () => {
  test('update name and description', async () => {
    createTask({ id: 'put-nd-1', agentId: 'agent-1', chatId: 'c', prompt: 'original', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Old Name', description: 'Old Description' })

    const res = await app.request('/tasks/put-nd-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', description: 'New Description' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.name).toBe('New Name')
    expect(body.description).toBe('New Description')
    // Other fields remain unchanged
    expect(body.prompt).toBe('original')
    expect(body.schedule_type).toBe('interval')
    expect(body.schedule_value).toBe('60000')
  })
})

describe('POST /tasks/:id/clone — cron type task', () => {
  test('cloning a cron task appends (copy) to name, preserves schedule type/value, status is active', async () => {
    createTask({ id: 'clone-cron-1', agentId: 'agent-1', chatId: 'c', prompt: 'cron prompt', scheduleType: 'cron', scheduleValue: '0 9 * * *', nextRun: new Date().toISOString(), name: 'Cron Task' })

    const res = await app.request('/tasks/clone-cron-1/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).not.toBe('clone-cron-1')
    expect(body.name).toBe('Cron Task (copy)')
    expect(body.schedule_type).toBe('cron')
    expect(body.schedule_value).toBe('0 9 * * *')
    expect(body.status).toBe('active')
    expect(body.prompt).toBe('cron prompt')
  })
})

describe('POST /tasks/:id/clone — once type task', () => {
  test('cloning a once type task', async () => {
    const futureTime = new Date(Date.now() + 86_400_000).toISOString()
    createTask({ id: 'clone-once-1', agentId: 'agent-1', chatId: 'c', prompt: 'once prompt', scheduleType: 'once', scheduleValue: futureTime, nextRun: futureTime, name: 'Once Task' })

    const res = await app.request('/tasks/clone-once-1/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).not.toBe('clone-once-1')
    expect(body.schedule_type).toBe('once')
    expect(body.schedule_value).toBe(futureTime)
    expect(body.prompt).toBe('once prompt')
    expect(body.name).toBe('Once Task (copy)')
    expect(body.status).toBe('active')
  })
})

describe('POST /tasks/:id/run — run twice consecutively', () => {
  test('running twice produces 4 messages', async () => {
    const chatId = 'task:run-twice'
    createTask({ id: 'run-twice-1', agentId: 'agent-1', chatId, prompt: 'repeated run', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    // First run
    const res1 = await app.request('/tasks/run-twice-1/run', { method: 'POST' })
    expect(res1.status).toBe(200)
    const body1 = await res1.json() as any
    expect(body1.status).toBe('success')

    // Second run
    const res2 = await app.request('/tasks/run-twice-1/run', { method: 'POST' })
    expect(res2.status).toBe(200)
    const body2 = await res2.json() as any
    expect(body2.status).toBe('success')

    // Each run writes 2 messages (user + bot), 4 total
    const msgs = getMessages(chatId, 10)
    expect(msgs.length).toBe(4)
    // Should have 2 user (is_from_me=1) and 2 bot (is_bot_message=1) messages
    const userMsgs = msgs.filter((m) => m.is_from_me === 1)
    const botMsgs = msgs.filter((m) => m.is_bot_message === 1)
    expect(userMsgs.length).toBe(2)
    expect(botMsgs.length).toBe(2)
  })
})

describe('GET /tasks — empty list', () => {
  test('returns empty array when no tasks exist', async () => {
    const res = await app.request('/tasks')
    expect(res.status).toBe(200)
    const body = await res.json() as any[]
    expect(body).toEqual([])
    expect(body.length).toBe(0)
  })
})

describe('GET /tasks/:id — non-existent ID', () => {
  test('GET non-existent task returns 404', async () => {
    const res = await app.request('/tasks/non-existent-id-12345')
    // No GET /tasks/:id route, Hono returns 404
    expect(res.status).toBe(404)
  })
})

describe('POST /tasks — missing required fields', () => {
  test('missing prompt field', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'c',
        scheduleType: 'interval', scheduleValue: '60000',
        // Missing prompt
      }),
    })
    // prompt NOT NULL constraint causes creation to fail, returns non-2xx
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /tasks — invalid scheduleType', () => {
  test('passing invalid as scheduleType returns 400', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'c', prompt: 'test',
        scheduleType: 'invalid', scheduleValue: '60000',
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })
})

describe('DELETE — GET returns 404 after deletion', () => {
  test('after deleting a task, the logs endpoint returns 404', async () => {
    createTask({ id: 'del-get-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    // Confirm the task exists
    const logsBefore = await app.request('/tasks/del-get-1/logs')
    expect(logsBefore.status).toBe(200)

    // Delete the task
    const delRes = await app.request('/tasks/del-get-1', { method: 'DELETE' })
    expect(delRes.status).toBe(200)

    // After deletion, accessing the logs endpoint returns 404
    const logsAfter = await app.request('/tasks/del-get-1/logs')
    expect(logsAfter.status).toBe(404)

    // Also confirm PUT returns 404
    const putRes = await app.request('/tasks/del-get-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(putRes.status).toBe(404)
  })
})

// ===== Delivery-related route tests =====

describe('POST /tasks — delivery fields', () => {
  test('create task with deliveryMode=push and deliveryTarget', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:dlv', prompt: 'delivery test',
        scheduleType: 'interval', scheduleValue: '120000',
        deliveryMode: 'push', deliveryTarget: 'tg:123456',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('push')
    expect(body.delivery_target).toBe('tg:123456')
  })

  test('deliveryMode=push without deliveryTarget returns 400', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:dlv-fail', prompt: 'missing target',
        scheduleType: 'interval', scheduleValue: '120000',
        deliveryMode: 'push',
        // Missing deliveryTarget
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('deliveryTarget')
  })

  test('without deliveryMode defaults to none', async () => {
    const res = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1', chatId: 'task:dlv-default', prompt: 'default delivery',
        scheduleType: 'interval', scheduleValue: '120000',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('none')
    expect(body.delivery_target).toBeNull()
  })
})

describe('PUT /tasks/:id — delivery fields', () => {
  test('update deliveryMode and deliveryTarget', async () => {
    createTask({ id: 'put-dlv-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    const res = await app.request('/tasks/put-dlv-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryMode: 'push', deliveryTarget: 'tg:789' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('push')
    expect(body.delivery_target).toBe('tg:789')
  })

  test('set deliveryTarget to null', async () => {
    createTask({ id: 'put-dlv-2', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), deliveryMode: 'push', deliveryTarget: 'tg:111' })

    const res = await app.request('/tasks/put-dlv-2', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryMode: 'none', deliveryTarget: null }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('none')
    expect(body.delivery_target).toBeNull()
  })
})

describe('POST /tasks/:id/clone — delivery fields', () => {
  test('cloning a task preserves delivery config', async () => {
    createTask({ id: 'clone-dlv-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Delivery Task', deliveryMode: 'push', deliveryTarget: 'tg:555' })

    const res = await app.request('/tasks/clone-dlv-1/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('push')
    expect(body.delivery_target).toBe('tg:555')
    expect(body.name).toBe('Delivery Task (copy)')
  })

  test('cloning a task without delivery config', async () => {
    createTask({ id: 'clone-dlv-2', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })

    const res = await app.request('/tasks/clone-dlv-2/clone', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.delivery_mode).toBe('none')
    expect(body.delivery_target).toBeNull()
  })
})

describe('GET /tasks/:id/logs — delivery_status field', () => {
  test('run logs include delivery_status', async () => {
    createTask({ id: 'log-dlv-1', agentId: 'agent-1', chatId: 'c', prompt: 'p', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString() })
    saveTaskRunLog({ taskId: 'log-dlv-1', runAt: '2026-03-10T10:00:00.000Z', durationMs: 1000, status: 'success', result: 'ok', deliveryStatus: 'sent' })
    saveTaskRunLog({ taskId: 'log-dlv-1', runAt: '2026-03-10T11:00:00.000Z', durationMs: 500, status: 'success', result: 'ok', deliveryStatus: 'skipped' })

    const res = await app.request('/tasks/log-dlv-1/logs')
    const body = await res.json() as any[]
    expect(body[0].delivery_status).toBe('skipped')
    expect(body[1].delivery_status).toBe('sent')
  })
})

describe('PUT /tasks/:id — empty body', () => {
  test('empty object {} does not modify the task', async () => {
    createTask({ id: 'put-empty-1', agentId: 'agent-1', chatId: 'c', prompt: 'original', scheduleType: 'interval', scheduleValue: '60000', nextRun: new Date().toISOString(), name: 'Original Name', description: 'Original Description' })

    const before = getTask('put-empty-1')!

    const res = await app.request('/tasks/put-empty-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    // All fields remain unchanged
    expect(body.prompt).toBe(before.prompt)
    expect(body.name).toBe(before.name)
    expect(body.description).toBe(before.description)
    expect(body.schedule_value).toBe(before.schedule_value)
    expect(body.schedule_type).toBe(before.schedule_type)
    expect(body.status).toBe(before.status)
    expect(body.next_run).toBe(before.next_run)
  })
})
