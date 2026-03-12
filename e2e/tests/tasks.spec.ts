import { test, expect } from '../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

// ===== 辅助函数 =====

const API_BASE = 'http://localhost:3000'
const UNIQUE = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** 获取第一个可用 agent */
async function getFirstAgentId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API_BASE}/api/agents`)
  const agents = await res.json()
  if (!agents.length) throw new Error('No agents available')
  return agents[0].id
}

/** 通过 API 创建任务 */
async function createTaskViaAPI(
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
async function deleteTaskViaAPI(request: APIRequestContext, taskId: string) {
  await request.delete(`${API_BASE}/api/tasks/${taskId}`)
}

/** 清理所有 E2E 前缀的任务 */
async function cleanupE2ETasks(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/tasks`)
  const tasks = await res.json()
  for (const task of tasks) {
    if (task.name?.startsWith('E2E')) {
      await deleteTaskViaAPI(request, task.id)
    }
  }
}

/** 导航到任务页并等待加载 */
async function navigateToTasks(page: Page) {
  await page.getByTestId('nav-cron').click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('task-create-btn')).toBeVisible()
}

/** 填写表单并提交，等待 API 响应 */
async function fillAndSubmitTaskForm(
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

  await page.getByTestId('task-input-schedule').fill(opts.scheduleValue)

  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
  )
  await page.getByTestId('task-submit-btn').click()
  await responsePromise
}

// ===== Level 1: 页面加载与基本 UI =====

test.describe('Level 1: 页面加载与基本 UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('核心元素可见', async ({ page }) => {
    await expect(page.getByTestId('task-create-btn')).toBeVisible()
    await expect(page.getByTestId('task-search')).toBeVisible()
    expect(page.url()).toContain('/cron')
  })

  test('列表数据与 API 一致', async ({ page, request }) => {
    await cleanupE2ETasks(request)

    // 创建 2 个已知任务
    const nameInterval = UNIQUE()
    const nameCron = UNIQUE()
    await createTaskViaAPI(request, {
      name: nameInterval,
      scheduleType: 'interval',
      scheduleValue: '3600000', // 1h
    })
    await createTaskViaAPI(request, {
      name: nameCron,
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 验证这 2 个任务在列表中可见
    const itemInterval = page.getByTestId('task-item').filter({ hasText: nameInterval })
    const itemCron = page.getByTestId('task-item').filter({ hasText: nameCron })

    await expect(itemInterval).toBeVisible()
    await expect(itemInterval).toContainText('active')
    await expect(itemInterval).toContainText('every 1h')

    await expect(itemCron).toBeVisible()
    await expect(itemCron).toContainText('active')
    await expect(itemCron).toContainText('cron: 0 9 * * *')
  })

  test('新建按钮打开表单', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    // 验证表单元素可见
    await expect(page.getByTestId('task-input-name')).toBeVisible()
    await expect(page.getByTestId('task-input-desc')).toBeVisible()
    await expect(page.getByTestId('task-select-agent')).toBeVisible()
    await expect(page.getByTestId('task-input-prompt')).toBeVisible()
    await expect(page.getByTestId('task-submit-btn')).toBeVisible()
    await expect(page.getByTestId('task-cancel-btn')).toBeVisible()
    // 标题为 "New Cron Job"
    await expect(page.getByText('New Cron Job')).toBeVisible()
  })

  test('取消按钮关闭表单', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await expect(page.getByTestId('task-input-name')).toBeVisible()
    await page.getByTestId('task-cancel-btn').click()
    await expect(page.getByTestId('task-input-name')).not.toBeVisible()
  })
})

// ===== Level 2: 单个操作 =====

test.describe('Level 2: 单个操作', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('UI 创建 interval 任务', async ({ page }) => {
    const taskName = UNIQUE()
    await page.getByTestId('task-create-btn').click()

    await fillAndSubmitTaskForm(page, {
      name: taskName,
      prompt: 'E2E test prompt',
      scheduleValue: '60',
    })

    // 验证列表中出现
    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })

  test('查看详情', async ({ page, request }) => {
    const taskName = UNIQUE()
    const task = await createTaskViaAPI(request, {
      name: taskName,
      description: 'E2E detail test',
      prompt: 'E2E detail prompt',
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击任务
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 验证详情内容（用 heading 避免和列表重复匹配）
    await expect(page.getByRole('heading', { name: taskName })).toBeVisible()
    await expect(page.getByText('E2E detail test')).toBeVisible()
    await expect(page.getByText('E2E detail prompt')).toBeVisible()
    await expect(page.getByText('active').first()).toBeVisible()
    await expect(page.getByText('every 1h').first()).toBeVisible()

    // 操作按钮都在
    await expect(page.getByTestId('task-edit-btn')).toBeVisible()
    await expect(page.getByTestId('task-delete-btn')).toBeVisible()
    await expect(page.getByTestId('task-pause-btn')).toBeVisible()
    await expect(page.getByTestId('task-run-btn')).toBeVisible()

    // 暂无运行记录
    await expect(page.getByText('No runs yet')).toBeVisible()
  })

  test('UI 编辑任务', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, {
      name: taskName,
      prompt: 'original prompt',
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击任务 → 编辑
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await page.getByTestId('task-edit-btn').click()

    // 验证表单预填
    await expect(page.getByTestId('task-input-name')).toHaveValue(taskName)
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('60') // 3600000ms → 60 分钟
    // Agent select 被 disabled
    await expect(page.getByTestId('task-select-agent')).toBeDisabled()

    // 修改名称和 prompt
    const newName = UNIQUE()
    await page.getByTestId('task-input-name').fill(newName)
    await page.getByTestId('task-input-prompt').fill('updated prompt')

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'PUT'
    )
    await page.getByTestId('task-submit-btn').click()
    await responsePromise

    // 详情应更新
    await expect(page.getByRole('heading', { name: newName })).toBeVisible()
    await expect(page.getByText('updated prompt')).toBeVisible()
  })

  test('UI 删除任务', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 提前注册 dialog accept
    page.on('dialog', (d) => d.accept())

    const deleteResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'DELETE'
    )
    await page.getByTestId('task-delete-btn').click()
    await deleteResponsePromise

    // 验证从列表消失
    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).not.toBeVisible()
  })

  test('取消删除', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 注册 dialog dismiss
    page.on('dialog', (d) => d.dismiss())

    await page.getByTestId('task-delete-btn').click()

    // 任务仍在列表
    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })
})

// ===== Level 3: 串行 CRUD 全流程 =====

test.describe('Level 3: 串行 CRUD 全流程', () => {
  test.describe.configure({ mode: 'serial' })

  let taskName: string
  const updatedSuffix = '-updated'

  test.beforeAll(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test.afterAll(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('创建 interval 120m 任务', async ({ page }) => {
    await navigateToTasks(page)

    taskName = UNIQUE()
    await page.getByTestId('task-create-btn').click()

    await fillAndSubmitTaskForm(page, {
      name: taskName,
      description: 'Serial CRUD test',
      prompt: 'Serial test prompt',
      scheduleValue: '120',
    })

    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })

  test('查看详情', async ({ page }) => {
    await navigateToTasks(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    await expect(page.getByRole('heading', { name: taskName })).toBeVisible()
    await expect(page.getByText('Serial CRUD test')).toBeVisible()
    await expect(page.getByText('Serial test prompt')).toBeVisible()
    await expect(page.getByText('every 2h').first()).toBeVisible()
  })

  test('编辑任务', async ({ page }) => {
    await navigateToTasks(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await page.getByTestId('task-edit-btn').click()

    const newName = taskName + updatedSuffix
    await page.getByTestId('task-input-name').fill(newName)
    await page.getByTestId('task-input-prompt').fill('Updated serial prompt')

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'PUT'
    )
    await page.getByTestId('task-submit-btn').click()
    await responsePromise

    taskName = newName
    await expect(page.getByRole('heading', { name: newName })).toBeVisible()
    await expect(page.getByText('Updated serial prompt')).toBeVisible()
  })

  test('暂停任务', async ({ page }) => {
    await navigateToTasks(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'PUT'
    )
    await page.getByTestId('task-pause-btn').click()
    await responsePromise

    // 刷新详情 — 重新点击
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('paused').first()).toBeVisible()
  })

  test('恢复任务', async ({ page }) => {
    await navigateToTasks(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'PUT'
    )
    await page.getByTestId('task-pause-btn').click()
    await responsePromise

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('active').first()).toBeVisible()
  })

  test('删除任务', async ({ page }) => {
    await navigateToTasks(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    page.on('dialog', (d) => d.accept())

    const deleteResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks/') && r.request().method() === 'DELETE'
    )
    await page.getByTestId('task-delete-btn').click()
    await deleteResponsePromise

    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).not.toBeVisible()
  })
})

// ===== Level 4: 高级功能 =====

test.describe('Level 4: 高级功能', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('创建 Cron 类型', async ({ page }) => {
    const taskName = UNIQUE()
    await page.getByTestId('task-create-btn').click()

    // 切换到 cron
    await page.getByTestId('task-schedule-type-cron').click()

    // 验证 label 变为 "Cron Expression"
    await expect(page.getByText('Cron Expression')).toBeVisible()

    // 帮助文本可见
    await expect(page.getByText('Standard cron')).toBeVisible()

    await fillAndSubmitTaskForm(page, {
      name: taskName,
      prompt: 'Cron test prompt',
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
    })

    // 验证列表中出现
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('cron: 0 9 * * *').first()).toBeVisible()
  })

  test('创建 Once 类型', async ({ page }) => {
    const taskName = UNIQUE()
    await page.getByTestId('task-create-btn').click()

    // 切换到 once
    await page.getByTestId('task-schedule-type-once').click()

    // 填明天的时间
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(10, 0)
    const datetimeValue = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T10:00`

    await fillAndSubmitTaskForm(page, {
      name: taskName,
      prompt: 'Once test prompt',
      scheduleType: 'once',
      scheduleValue: datetimeValue,
    })

    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })

  test('切换调度类型清空值', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()

    // 默认 interval，填入值
    await page.getByTestId('task-input-schedule').fill('60')
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('60')

    // 切到 cron → 值清空
    await page.getByTestId('task-schedule-type-cron').click()
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('')

    // 切到 once → 值清空
    await page.getByTestId('task-schedule-type-once').click()
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('')
  })

  test('搜索按名称过滤', async ({ page, request }) => {
    const nameA = `E2E-Alpha-${Date.now()}`
    const nameB = `E2E-Beta-${Date.now()}`
    await createTaskViaAPI(request, { name: nameA })
    await createTaskViaAPI(request, { name: nameB })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 搜 Alpha
    await page.getByTestId('task-search').fill('Alpha')
    await expect(page.getByTestId('task-item').filter({ hasText: nameA })).toBeVisible()
    await expect(page.getByTestId('task-item').filter({ hasText: nameB })).not.toBeVisible()

    // 清空搜索
    await page.getByTestId('task-search').fill('')
    await expect(page.getByTestId('task-item').filter({ hasText: nameA })).toBeVisible()
    await expect(page.getByTestId('task-item').filter({ hasText: nameB })).toBeVisible()
  })

  test('搜索按 prompt 过滤', async ({ page, request }) => {
    const keyword = `unicorn${Date.now()}`
    const taskName = UNIQUE()
    await createTaskViaAPI(request, {
      name: taskName,
      prompt: `E2E find this ${keyword} please`,
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-search').fill(keyword)
    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })

  // 此测试同时覆盖空状态 UI 分支（filteredTasks.length === 0）
  test('搜索无匹配显示空', async ({ page }) => {
    await page.getByTestId('task-search').fill(`nonexistent-${Date.now()}`)
    await expect(page.getByTestId('task-item')).not.toBeVisible()
    await expect(page.getByText('No cron jobs yet')).toBeVisible()
  })

  test('克隆任务', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击任务查看详情
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 点击克隆
    const cloneResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/clone') && r.status() === 201
    )
    await page.getByTestId('task-clone-btn').click()
    await cloneResponsePromise

    // 列表中出现 "(copy)" 后缀任务
    await expect(page.getByTestId('task-item').filter({ hasText: `${taskName} (copy)` })).toBeVisible()
  })

  test('completed 状态无暂停按钮', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName, status: 'completed' })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 无 pause 按钮
    await expect(page.getByTestId('task-pause-btn')).not.toBeVisible()
    // edit/delete/run 仍在
    await expect(page.getByTestId('task-edit-btn')).toBeVisible()
    await expect(page.getByTestId('task-delete-btn')).toBeVisible()
    await expect(page.getByTestId('task-run-btn')).toBeVisible()
  })

  test('搜索按 schedule 文本过滤', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, {
      name: taskName,
      scheduleType: 'cron',
      scheduleValue: '30 22 * * 5', // 独特的 cron 表达式
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-search').fill('30 22')
    await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
  })

  test.describe('请求体断言', () => {
    test('interval 创建发送正确毫秒值', async ({ page }) => {
      const taskName = UNIQUE()
      await page.getByTestId('task-create-btn').click()

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
      )

      await page.getByTestId('task-input-name').fill(taskName)
      await page.getByTestId('task-input-prompt').fill('interval body test')
      await page.getByTestId('task-input-schedule').fill('45') // 45 分钟
      await page.getByTestId('task-submit-btn').click()

      const response = await responsePromise
      const body = response.request().postDataJSON()
      expect(body.scheduleValue).toBe('2700000') // 45 * 60000
      expect(body.scheduleType).toBe('interval')

      // 确认任务创建成功并出现在列表中
      await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
    })

    test('once 创建发送正确 ISO 时间', async ({ page }) => {
      const taskName = UNIQUE()
      await page.getByTestId('task-create-btn').click()
      await page.getByTestId('task-schedule-type-once').click()

      // 构造明天 14:30 的 datetime-local 值
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const datetimeLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T14:30`

      // 用相同输入值计算预期 ISO（和前端 Tasks.tsx:517 逻辑一致）
      const expectedISO = new Date(datetimeLocal).toISOString()

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
      )

      await page.getByTestId('task-input-name').fill(taskName)
      await page.getByTestId('task-input-prompt').fill('once body test')
      await page.getByTestId('task-input-schedule').fill(datetimeLocal)
      await page.getByTestId('task-submit-btn').click()

      const response = await responsePromise
      const body = response.request().postDataJSON()
      expect(body.scheduleValue).toBe(expectedISO) // 精确 ISO 比对
      expect(body.scheduleType).toBe('once')

      await expect(page.getByTestId('task-item').filter({ hasText: taskName })).toBeVisible()
    })

    test('编辑发送正确 PUT body', async ({ page, request }) => {
      const taskName = UNIQUE()
      await createTaskViaAPI(request, {
        name: taskName,
        scheduleValue: '7200000', // 120 分钟
      })

      await page.reload()
      await page.waitForLoadState('networkidle')
      await page.getByTestId('task-item').filter({ hasText: taskName }).click()
      await page.getByTestId('task-edit-btn').click()

      // 验证回显为 120 分钟
      await expect(page.getByTestId('task-input-schedule')).toHaveValue('120')

      // 改为 30 分钟
      await page.getByTestId('task-input-schedule').fill('30')

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes('/api/tasks/') && r.request().method() === 'PUT' && r.status() === 200
      )
      await page.getByTestId('task-submit-btn').click()

      const response = await responsePromise
      const body = response.request().postDataJSON()
      expect(body.scheduleValue).toBe('1800000') // 30 * 60000

      // 确认 UI 回到详情视图且显示更新后的调度
      await expect(page.getByRole('heading', { name: taskName })).toBeVisible()
      await page.getByTestId('task-item').filter({ hasText: taskName }).click()
      await expect(page.getByText('every 30m').first()).toBeVisible()
    })
  })

  test('once 编辑回显 datetime-local 格式', async ({ page, request }) => {
    const taskName = UNIQUE()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const datetimeLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T09:00`
    const isoValue = new Date(datetimeLocal).toISOString()

    await createTaskViaAPI(request, {
      name: taskName,
      scheduleType: 'once',
      scheduleValue: isoValue,
    })

    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await page.getByTestId('task-edit-btn').click()

    // 精确比对：应与 isoToDatetimeLocal(isoValue) 一致
    const scheduleInput = page.getByTestId('task-input-schedule')
    const d = new Date(isoValue)
    const pad = (n: number) => n.toString().padStart(2, '0')
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    await expect(scheduleInput).toHaveValue(expected)
  })

  test('真实手动执行 + 运行日志', async ({ page, request }) => {
    // 检查是否有 ANTHROPIC_API_KEY
    const healthRes = await request.get(`${API_BASE}/api/health`)
    if (!healthRes.ok()) {
      test.skip(true, 'Server not healthy, skip real execution test')
    }

    const taskName = UNIQUE()
    await createTaskViaAPI(request, {
      name: taskName,
      prompt: '请回复"OK"',
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击任务
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('No runs yet')).toBeVisible()

    // 点击"立即运行"
    const runResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/run') && r.request().method() === 'POST',
      { timeout: 120_000 }
    )
    await page.getByTestId('task-run-btn').click()
    const runResponse = await runResponsePromise
    const runResult = await runResponse.json()
    expect(runResult.status).toBe('success')

    // reload 获取最新数据后重新点击
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 验证 "No runs yet" 消失
    await expect(page.getByText('No runs yet')).not.toBeVisible()

    // 验证至少出现 1 个 task-log-item
    await expect(page.getByTestId('task-log-item').first()).toBeVisible()
  })
})

// ===== Level 5: 边界情况与错误处理 =====

test.describe('Level 5: 边界情况与错误处理', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
  })

  test('空表单提交显示错误', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()

    // 监听是否有 POST 请求发出
    let postSent = false
    await page.route('**/api/tasks', (route) => {
      if (route.request().method() === 'POST') postSent = true
      route.continue()
    })

    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('All fields are required')

    // 确认没有发出 POST 请求
    expect(postSent).toBe(false)
  })

  test('只填 prompt 不填调度值', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('some prompt')
    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('All fields are required')
  })

  test('interval 为 0 或负数', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('test prompt')
    await page.getByTestId('task-input-schedule').fill('0')
    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('Interval must be a positive number')
  })

  test('无效 cron 表达式', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('test prompt')
    await page.getByTestId('task-schedule-type-cron').click()
    await page.getByTestId('task-input-schedule').fill('invalid-cron')

    await page.getByTestId('task-submit-btn').click()

    // 后端返回 400，前端显示错误
    await expect(page.getByTestId('task-form-error')).toBeVisible({ timeout: 10_000 })
  })

  test('编辑后取消不保存', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await page.getByTestId('task-edit-btn').click()

    // 修改名称
    await page.getByTestId('task-input-name').fill('Changed Name')

    // 点取消
    await page.getByTestId('task-cancel-btn').click()

    // 详情仍显示原始名称
    await expect(page.getByRole('heading', { name: taskName })).toBeVisible()
    await expect(page.getByText('Changed Name')).not.toBeVisible()
  })

  test('选中切换详情正确更新', async ({ page, request }) => {
    const nameA = UNIQUE()
    const nameB = UNIQUE()
    await createTaskViaAPI(request, { name: nameA, prompt: 'prompt-A-unique' })
    await createTaskViaAPI(request, { name: nameB, prompt: 'prompt-B-unique' })

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击 A
    await page.getByTestId('task-item').filter({ hasText: nameA }).click()
    await expect(page.getByText('prompt-A-unique')).toBeVisible()

    // 点击 B
    await page.getByTestId('task-item').filter({ hasText: nameB }).click()
    await expect(page.getByText('prompt-B-unique')).toBeVisible()
    await expect(page.getByText('prompt-A-unique')).not.toBeVisible()
  })

  test('快速连续创建两任务不冲突', async ({ page }) => {
    const nameA = UNIQUE()
    const nameB = UNIQUE()

    // 创建第一个
    await page.getByTestId('task-create-btn').click()
    await fillAndSubmitTaskForm(page, {
      name: nameA,
      prompt: 'first task',
      scheduleValue: '60',
    })

    // 创建第二个
    await page.getByTestId('task-create-btn').click()
    await fillAndSubmitTaskForm(page, {
      name: nameB,
      prompt: 'second task',
      scheduleValue: '90',
    })

    // 两个都在列表中
    await expect(page.getByTestId('task-item').filter({ hasText: nameA })).toBeVisible()
    await expect(page.getByTestId('task-item').filter({ hasText: nameB })).toBeVisible()
  })
})
