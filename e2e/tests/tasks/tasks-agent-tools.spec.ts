import { test, expect, API_BASE, UNIQUE, cleanupE2ETasks, getFirstAgentId } from './helpers'
import { cleanupE2EChats } from '../chat/helpers'

type ScheduledTaskDTO = {
  id: string
  agent_id: string
  chat_id: string
  name: string | null
  prompt: string
  schedule_type: string
  schedule_value: string
  status: string
}

async function sendNaturalLanguageTaskRequest(
  request: import('@playwright/test').APIRequestContext,
  agentId: string,
  chatId: string,
  prompt: string,
) {
  const res = await request.post(`${API_BASE}/api/agents/${agentId}/message`, {
    data: {
      chatId,
      prompt,
    },
  })
  expect(res.status()).toBe(200)
}

async function waitForTask(
  request: import('@playwright/test').APIRequestContext,
  predicate: (task: ScheduledTaskDTO) => boolean,
  timeoutMs = 120_000,
): Promise<ScheduledTaskDTO> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API_BASE}/api/tasks`)
    expect(res.status()).toBe(200)
    const tasks = await res.json() as ScheduledTaskDTO[]
    const match = tasks.find(predicate)
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('Timed out waiting for task to appear/update')
}

async function getTasksByName(
  request: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<ScheduledTaskDTO[]> {
  const res = await request.get(`${API_BASE}/api/tasks`)
  expect(res.status()).toBe(200)
  const tasks = await res.json() as ScheduledTaskDTO[]
  return tasks.filter((task) => task.name === name)
}

async function waitForTaskStatus(
  request: import('@playwright/test').APIRequestContext,
  taskId: string,
  status: string,
  timeoutMs = 120_000,
): Promise<ScheduledTaskDTO> {
  return waitForTask(request, (task) => task.id === taskId && task.status === status, timeoutMs)
}

async function waitForTaskDeleted(
  request: import('@playwright/test').APIRequestContext,
  taskId: string,
  timeoutMs = 120_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${API_BASE}/api/tasks`)
    expect(res.status()).toBe(200)
    const tasks = await res.json() as ScheduledTaskDTO[]
    if (!tasks.some((task) => task.id === taskId)) return
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('Timed out waiting for task to be deleted')
}

test.describe('Task Tools Through Natural Language', () => {
  test.setTimeout(180_000)

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
    await cleanupE2EChats(request)
  })

  test('agent creates a named interval task from natural language', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const taskName = UNIQUE()
    const chatId = `web:e2e-task-create-${crypto.randomUUID().slice(0, 8)}`

    await sendNaturalLanguageTaskRequest(
      request,
      agentId,
      chatId,
      [
        `请帮我创建一个定时任务，任务名称必须叫“${taskName}”。`,
        '如果已存在同名任务就更新，不要重复创建。',
        '请创建 interval 类型任务，每 3 小时提醒我一次。',
        '提醒内容写成：喝水并活动一下。',
        '完成后只需要简短确认，不要省略任务创建步骤。',
      ].join(''),
    )

    const task = await waitForTask(
      request,
      (candidate) => candidate.agent_id === agentId && candidate.chat_id === chatId && candidate.name === taskName,
    )

    expect(task.schedule_type).toBe('interval')
    expect(task.schedule_value).toBe('10800000')
    expect(task.status).toBe('active')
    expect(task.prompt).toContain('喝水并活动一下')
  })

  test('agent updates an existing named task instead of creating a duplicate', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const taskName = UNIQUE()
    const chatId = `web:e2e-task-update-${crypto.randomUUID().slice(0, 8)}`
    const seededOnChat = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId,
        prompt: '旧提醒内容：喝水并活动一下。',
        scheduleType: 'interval',
        scheduleValue: '10800000',
        name: taskName,
        description: 'E2E seeded task',
      },
    })
    expect(seededOnChat.status()).toBe(201)
    const seededTask = await seededOnChat.json() as ScheduledTaskDTO

    await sendNaturalLanguageTaskRequest(
      request,
      agentId,
      chatId,
      [
        `请先查看当前定时任务，然后把名字叫“${taskName}”的任务修改掉。`,
        '不要创建新任务，只修改已有任务。',
        '把频率改成 interval 类型，每 4 小时提醒一次。',
        '把提醒内容改成：提交周报并同步进度。',
        '完成后只需要简短确认。',
      ].join(''),
    )

    const updated = await waitForTask(
      request,
      (candidate) => candidate.id === seededTask.id
        && candidate.schedule_value === '14400000'
        && candidate.prompt.includes('提交周报并同步进度'),
    )

    const tasksWithSameName = await getTasksByName(request, taskName)
    expect(tasksWithSameName.length).toBe(1)
    expect(updated.id).toBe(seededTask.id)
    expect(updated.schedule_type).toBe('interval')
    expect(updated.schedule_value).toBe('14400000')
    expect(updated.prompt).toContain('提交周报并同步进度')
  })

  test('agent pauses and resumes an existing named task', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const taskName = UNIQUE()
    const chatId = `web:e2e-task-pause-${crypto.randomUUID().slice(0, 8)}`
    const seededOnChat = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId,
        prompt: '按时提醒我喝水。',
        scheduleType: 'interval',
        scheduleValue: '10800000',
        name: taskName,
      },
    })
    expect(seededOnChat.status()).toBe(201)
    const seededTask = await seededOnChat.json() as ScheduledTaskDTO

    await sendNaturalLanguageTaskRequest(
      request,
      agentId,
      chatId,
      `请先查看当前定时任务，然后把名字叫“${taskName}”的任务暂停，不要创建新任务。`,
    )
    await waitForTaskStatus(request, seededTask.id, 'paused')

    await sendNaturalLanguageTaskRequest(
      request,
      agentId,
      chatId,
      `请先查看当前定时任务，然后把名字叫“${taskName}”的任务恢复执行，不要创建新任务。`,
    )
    await waitForTaskStatus(request, seededTask.id, 'active')
  })

  test('agent deletes an existing named task', async ({ request }) => {
    const agentId = await getFirstAgentId(request)
    const taskName = UNIQUE()
    const chatId = `web:e2e-task-delete-${crypto.randomUUID().slice(0, 8)}`
    const seededOnChat = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId,
        prompt: '删除我',
        scheduleType: 'interval',
        scheduleValue: '10800000',
        name: taskName,
      },
    })
    expect(seededOnChat.status()).toBe(201)
    const seededTask = await seededOnChat.json() as ScheduledTaskDTO

    await sendNaturalLanguageTaskRequest(
      request,
      agentId,
      chatId,
      [
        `请先查看当前定时任务，然后删除名字叫“${taskName}”的任务。`,
        '不要创建新任务，只删除这个已有任务。',
        '完成后只需要简短确认。',
      ].join(''),
    )

    await waitForTaskDeleted(request, seededTask.id)
    const tasksWithSameName = await getTasksByName(request, taskName)
    expect(tasksWithSameName.length).toBe(0)
  })
})
