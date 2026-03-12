import {
  test, expect, UNIQUE,
  createTaskViaAPI, cleanupE2ETasks,
  navigateToTasks, fillAndSubmitTaskForm,
} from './helpers'

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
