import { test, expect } from '../../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

export { test, expect }

// ===== 常量 =====

export const API_BASE = 'http://localhost:62601'
export const UNIQUE = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ===== API 辅助函数 =====

/** 获取第一个可用 agent */
export async function getFirstAgentId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API_BASE}/api/agents`)
  const agents = await res.json()
  if (!agents.length) throw new Error('No agents available')
  return agents[0].id
}

/** 通过 API 创建任务 */
export async function createTaskViaAPI(
  request: APIRequestContext,
  overrides: {
    name?: string
    description?: string
    prompt?: string
    scheduleType?: string
    scheduleValue?: string
    agentId?: string
    status?: string
  } = {}
) {
  const agentId = overrides.agentId ?? (await getFirstAgentId(request))
  const body = {
    agentId,
    chatId: `task:${crypto.randomUUID().slice(0, 8)}`,
    prompt: overrides.prompt ?? `E2E test prompt ${UNIQUE()}`,
    scheduleType: overrides.scheduleType ?? 'interval',
    scheduleValue: overrides.scheduleValue ?? '3600000', // 60m
    name: overrides.name ?? UNIQUE(),
    description: overrides.description ?? 'E2E test task',
  }
  const res = await request.post(`${API_BASE}/api/tasks`, { data: body })
  expect(res.status()).toBe(201)
  const task = await res.json()

  // 如果需要设置特殊状态（如 completed）
  if (overrides.status && overrides.status !== 'active') {
    await request.put(`${API_BASE}/api/tasks/${task.id}`, {
      data: { status: overrides.status },
    })
  }

  return task
}

/** 通过 API 删除单个任务 */
export async function deleteTaskViaAPI(request: APIRequestContext, taskId: string) {
  await request.delete(`${API_BASE}/api/tasks/${taskId}`)
}

/** 清理所有 E2E 前缀的任务 */
export async function cleanupE2ETasks(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/tasks`)
  const tasks = await res.json()
  for (const task of tasks) {
    if (task.name?.startsWith('E2E')) {
      await deleteTaskViaAPI(request, task.id)
    }
  }
}

// ===== UI 辅助函数 =====

/** 导航到任务页并等待加载 */
export async function navigateToTasks(page: Page) {
  await page.getByTestId('nav-cron').click()
  await page.waitForURL(/\/cron$/)
  await expect(page.getByTestId('task-create-btn')).toBeVisible()
}

/** 刷新任务页并等待关键元素恢复 */
export async function reloadTasksPage(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/cron$/)
  await expect(page.getByTestId('task-create-btn')).toBeVisible()
}

/** 通过弹层日历 + 小时/分钟选择器设置 once 时间 */
export async function setOnceDateTime(page: Page, datetimeLocal: string) {
  const [datePart, timePart] = datetimeLocal.split('T')
  const [hour, minute] = timePart.split(':')

  await page.getByTestId('task-once-preset-custom').click()

  const targetDay = page.getByTestId(`task-once-day-${datePart}`).first()
  for (let i = 0; i < 12; i++) {
    if (await targetDay.isVisible().catch(() => false)) break
    await page.getByTestId('calendar-next-month').click()
  }

  await targetDay.click()
  await page.getByTestId(`task-once-hour-option-${hour}`).click()
  await page.getByTestId(`task-once-minute-option-${minute}`).click()

  await page.keyboard.press('Escape')
}

/** 填写表单并提交，等待 API 响应 */
export async function fillAndSubmitTaskForm(
  page: Page,
  opts: {
    name: string
    description?: string
    prompt: string
    scheduleType?: 'interval' | 'cron' | 'once'
    scheduleValue: string
  }
) {
  await page.getByTestId('task-input-name').fill(opts.name)
  if (opts.description) {
    await page.getByTestId('task-input-desc').fill(opts.description)
  }
  await page.getByTestId('task-input-prompt').fill(opts.prompt)

  // 切换调度类型（默认 interval）
  if (opts.scheduleType && opts.scheduleType !== 'interval') {
    await page.getByTestId(`task-schedule-type-${opts.scheduleType}`).click()
  }

  if (opts.scheduleType === 'once') {
    await setOnceDateTime(page, opts.scheduleValue)
  } else if (opts.scheduleType === 'cron') {
    await page.getByTestId('task-cron-mode-custom').click()
    await page.getByTestId('task-input-schedule').fill(opts.scheduleValue)
  } else {
    await page.getByTestId('task-input-schedule').fill(opts.scheduleValue)
  }

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
  )
  await page.getByTestId('task-submit-btn').click()
  await responsePromise
}
