import {
  test, expect, UNIQUE, API_BASE,
  createTaskViaAPI, cleanupE2ETasks,
  navigateToTasks, fillAndSubmitTaskForm, reloadTasksPage,
} from './helpers'

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
    await expect(page.getByTestId('task-form-error')).toContainText('所有字段均为必填')

    // 确认没有发出 POST 请求
    expect(postSent).toBe(false)
  })

  test('只填 prompt 不填调度值', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('some prompt')
    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('所有字段均为必填')
  })

  test('interval 为 0 或负数', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('test prompt')
    await page.getByTestId('task-input-schedule').fill('0')
    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('间隔必须为正数')
  })

  test('无效 cron 表达式', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-input-prompt').fill('test prompt')
    await page.getByTestId('task-schedule-type-cron').click()
    await page.getByTestId('task-cron-mode-custom').click()
    await page.getByTestId('task-input-schedule').fill('invalid-cron')

    await page.getByTestId('task-submit-btn').click()

    // 后端返回 400，前端显示错误
    await expect(page.getByTestId('task-form-error')).toBeVisible({ timeout: 10_000 })
  })

  test('编辑后取消不保存', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await reloadTasksPage(page)

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

    await reloadTasksPage(page)

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

  test('编辑成同 chat 下已存在的任务名时显示冲突错误', async ({ page, request }) => {
    const agentRes = await request.get(`${API_BASE}/api/agents`)
    const agents = await agentRes.json()
    const agentId = agents[0]?.id
    expect(agentId).toBeTruthy()

    const sharedChatId = `task:${crypto.randomUUID().slice(0, 8)}`
    const nameA = UNIQUE()
    const nameB = UNIQUE()

    const createA = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: sharedChatId,
        prompt: 'task A',
        scheduleType: 'interval',
        scheduleValue: '3600000',
        name: nameA,
      },
    })
    expect(createA.status()).toBe(201)

    const createB = await request.post(`${API_BASE}/api/tasks`, {
      data: {
        agentId,
        chatId: sharedChatId,
        prompt: 'task B',
        scheduleType: 'interval',
        scheduleValue: '3600000',
        name: nameB,
      },
    })
    expect(createB.status()).toBe(201)

    await reloadTasksPage(page)
    await page.getByTestId('task-item').filter({ hasText: nameA }).click()
    await page.getByTestId('task-edit-btn').click()
    await page.getByTestId('task-input-name').fill(nameB)
    await page.getByTestId('task-submit-btn').click()

    await expect(page.getByTestId('task-form-error')).toBeVisible()
    await expect(page.getByTestId('task-form-error')).toContainText('Task already exists')
  })
})
