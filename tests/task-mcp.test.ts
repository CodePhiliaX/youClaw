import { describe, test, expect, mock } from 'bun:test'
import './setup.ts'
import { createTaskMcpServer } from '../src/agent/task-mcp.ts'
import { TaskServiceError } from '../src/task/index.ts'

function getToolHandler(server: any, name: string) {
  return server.instance._registeredTools[name].handler as (args: Record<string, unknown>) => Promise<any>
}

describe('task-mcp tools', () => {
  test('list_tasks calls service with optional filters', async () => {
    const listTasksForAgent = mock(async () => [{ id: 't1', name: 'Daily summary' }])
    const applyTaskAction = mock(async () => ({ ok: true }))

    const server = createTaskMcpServer(
      { agentId: 'agent-a', chatId: 'chat-1' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'list_tasks')
    const result = await handler({ chat_id: 'chat-9', name: 'Daily summary', status: 'active' })

    expect(listTasksForAgent).toHaveBeenCalledTimes(1)
    expect(listTasksForAgent).toHaveBeenCalledWith('agent-a', {
      chatId: 'chat-9',
      name: 'Daily summary',
      status: 'active',
      limit: undefined,
    })

    const text = result.content[0]?.text as string
    const parsed = JSON.parse(text) as { tasks: Array<{ id: string; name: string }> }
    expect(parsed.tasks[0]?.id).toBe('t1')
  })

  test('update_task forwards normalized payload to service', async () => {
    const listTasksForAgent = mock(async () => [])
    const applyTaskAction = mock(async () => ({ taskId: 'task-1', action: 'update' }))

    const server = createTaskMcpServer(
      { agentId: 'agent-b', chatId: 'chat-2' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'update_task')
    const result = await handler({
      action: 'update',
      name: 'Daily summary',
      prompt: 'new prompt',
      description: 'updated description',
      schedule_type: 'cron',
      schedule_value: '0 10 * * *',
      delivery_mode: 'none',
    })

    expect(applyTaskAction).toHaveBeenCalledTimes(1)
    expect(applyTaskAction).toHaveBeenCalledWith({
      agentId: 'agent-b',
      chatId: 'chat-2',
      action: 'update',
      name: 'Daily summary',
      prompt: 'new prompt',
      description: 'updated description',
      scheduleType: 'cron',
      scheduleValue: '0 10 * * *',
      timezone: undefined,
      deliveryMode: 'none',
      deliveryTarget: undefined,
    })

    const text = result.content[0]?.text as string
    const parsed = JSON.parse(text) as { action: string }
    expect(parsed.action).toBe('update')
  })

  test('update_task validates create payload before service call', async () => {
    const listTasksForAgent = mock(async () => [])
    const applyTaskAction = mock(async () => ({ ok: true }))
    const server = createTaskMcpServer(
      { agentId: 'agent-c', chatId: 'chat-3' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'update_task')
    const result = await handler({
      action: 'create',
      name: 'Daily summary',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
    })

    expect(applyTaskAction).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('create action requires prompt')
  })

  test('update_task validates update payload before service call', async () => {
    const listTasksForAgent = mock(async () => [])
    const applyTaskAction = mock(async () => ({ ok: true }))
    const server = createTaskMcpServer(
      { agentId: 'agent-c', chatId: 'chat-3' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'update_task')
    const result = await handler({
      action: 'update',
      name: 'Daily summary',
    })

    expect(applyTaskAction).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('update action requires at least one mutable field')
  })

  test('update_task forwards pause/resume/delete actions with current chat fallback', async () => {
    const listTasksForAgent = mock(async () => [])
    const applyTaskAction = mock(async ({ action }) => ({ action }))

    const server = createTaskMcpServer(
      { agentId: 'agent-d', chatId: 'chat-current' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'update_task')

    await handler({ action: 'pause', name: 'Daily summary' })
    await handler({ action: 'resume', name: 'Daily summary' })
    await handler({ action: 'delete', name: 'Daily summary' })

    expect(applyTaskAction.mock.calls[0]?.[0]).toEqual({
      agentId: 'agent-d',
      chatId: 'chat-current',
      action: 'pause',
      name: 'Daily summary',
      prompt: undefined,
      description: undefined,
      scheduleType: undefined,
      scheduleValue: undefined,
      timezone: undefined,
      deliveryMode: undefined,
      deliveryTarget: undefined,
    })
    expect(applyTaskAction.mock.calls[1]?.[0].action).toBe('resume')
    expect(applyTaskAction.mock.calls[2]?.[0].action).toBe('delete')
  })

  test('returns tool error when service throws TaskServiceError', async () => {
    const listTasksForAgent = mock(async () => {
      throw new TaskServiceError('boom', 409)
    })
    const applyTaskAction = mock(async () => ({ ok: true }))

    const server = createTaskMcpServer(
      { agentId: 'agent-z', chatId: 'chat-z' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'list_tasks')
    const result = await handler({})

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('boom')
  })

  test('update_task returns tool error when service throws TaskServiceError', async () => {
    const listTasksForAgent = mock(async () => [])
    const applyTaskAction = mock(async () => {
      throw new TaskServiceError('Task not found', 404)
    })

    const server = createTaskMcpServer(
      { agentId: 'agent-z', chatId: 'chat-z' },
      { service: { listTasksForAgent, applyTaskAction } },
    ) as any

    const handler = getToolHandler(server, 'update_task')
    const result = await handler({
      action: 'delete',
      name: 'Missing task',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Task not found')
  })
})
