import {
  test, expect, UNIQUE, API_BASE,
  createTaskViaAPI, cleanupE2ETasks,
  navigateToTasks, fillAndSubmitTaskForm,
} from './helpers'

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
})
