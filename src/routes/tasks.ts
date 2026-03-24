import { Hono } from 'hono'
import { z } from 'zod'
import type { AgentManager } from '../agent/manager.ts'
import type { AgentQueue } from '../agent/queue.ts'
import type { Scheduler } from '../scheduler/scheduler.ts'
import {
  TaskServiceError,
  cloneScheduledTaskById,
  createScheduledTask,
  deleteScheduledTaskById,
  getScheduledTask,
  getScheduledTaskRunLogs,
  listScheduledTasks,
  updateScheduledTaskById,
} from '../task/index.ts'

// ===== Zod input validation =====

const createTaskSchema = z.object({
  agentId: z.string().min(1),
  chatId: z.string().min(1),
  prompt: z.string().min(1),
  scheduleType: z.enum(['cron', 'interval', 'once']),
  scheduleValue: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().optional(),
  deliveryMode: z.enum(['push', 'none']).default('none').optional(),
  deliveryTarget: z.string().optional(),
}).refine((data) => {
  // push mode requires deliveryTarget
  if (data.deliveryMode === 'push' && !data.deliveryTarget) return false
  return true
}, {
  message: 'deliveryTarget is required when deliveryMode is "push"',
})

const updateTaskSchema = z.object({
  prompt: z.string().min(1).optional(),
  scheduleType: z.enum(['cron', 'interval', 'once']).optional(),
  scheduleValue: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string().nullable().optional(),
  deliveryMode: z.enum(['push', 'none']).optional(),
  deliveryTarget: z.string().nullable().optional(),
})

export function createTasksRoutes(scheduler: Scheduler, agentManager: AgentManager, agentQueue: AgentQueue) {
  const app = new Hono()
  void agentQueue

  function taskErrorResponse(err: unknown): Response {
    if (err instanceof TaskServiceError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw err
  }

  // GET /api/tasks — list tasks
  app.get('/tasks', (c) => {
    const tasks = listScheduledTasks()
    return c.json(tasks)
  })

  // POST /api/tasks — create a task
  app.post('/tasks', async (c) => {
    const body = await c.req.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    const data = parsed.data

    // Verify agent exists
    const agent = agentManager.getAgent(data.agentId)
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    try {
      const task = createScheduledTask({
        agentId: data.agentId,
        chatId: data.chatId,
        prompt: data.prompt,
        scheduleType: data.scheduleType,
        scheduleValue: data.scheduleValue,
        name: data.name,
        description: data.description,
        timezone: data.timezone,
        deliveryMode: data.deliveryMode,
        deliveryTarget: data.deliveryTarget,
      })
      return c.json(task, 201)
    } catch (err) {
      return taskErrorResponse(err)
    }
  })

  // PUT /api/tasks/:id — update a task
  app.put('/tasks/:id', async (c) => {
    const id = c.req.param('id')
    const existing = getScheduledTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    const body = await c.req.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)
    }

    try {
      const updated = updateScheduledTaskById(id, parsed.data)
      return c.json(updated)
    } catch (err) {
      return taskErrorResponse(err)
    }
  })

  // POST /api/tasks/:id/clone — clone a task
  app.post('/tasks/:id/clone', async (c) => {
    const id = c.req.param('id')
    const existing = getScheduledTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    try {
      const task = cloneScheduledTaskById(id)
      return c.json(task, 201)
    } catch (err) {
      return taskErrorResponse(err)
    }
  })

  // DELETE /api/tasks/:id — delete a task
  app.delete('/tasks/:id', (c) => {
    const id = c.req.param('id')
    const existing = getScheduledTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    try {
      deleteScheduledTaskById(id)
      return c.json({ ok: true })
    } catch (err) {
      return taskErrorResponse(err)
    }
  })

  // POST /api/tasks/:id/run — manually trigger immediate execution
  app.post('/tasks/:id/run', async (c) => {
    const id = c.req.param('id')
    const task = getScheduledTask(id)
    if (!task) {
      return c.json({ error: 'Task not found' }, 404)
    }

    const result = await scheduler.runManually(task)
    if (result.status === 'error') {
      return c.json(result, 500)
    }
    return c.json(result)
  })

  // GET /api/tasks/:id/logs — run history
  app.get('/tasks/:id/logs', (c) => {
    const id = c.req.param('id')
    const existing = getScheduledTask(id)
    if (!existing) {
      return c.json({ error: 'Task not found' }, 404)
    }

    const logs = getScheduledTaskRunLogs(id)
    return c.json(logs)
  })

  return app
}
