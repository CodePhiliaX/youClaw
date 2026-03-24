import {
  test, expect, UNIQUE, API_BASE,
  createTaskViaAPI, cleanupE2ETasks,
  navigateToTasks, fillAndSubmitTaskForm, reloadTasksPage, setOnceDateTime,
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

    // 验证进入可视化 Cron 构造器
    await expect(page.getByText('Cron 表达式')).toBeVisible()
    await expect(page.getByTestId('task-cron-mode-daily')).toBeVisible()
    await expect(page.getByText('标准 cron 格式')).toBeVisible()
    await expect(page.getByTestId('task-cron-preview')).toHaveText('0 9 * * *')

    await page.getByTestId('task-cron-mode-weekly').click()
    await expect(page.getByTestId('task-cron-preview')).toHaveText('0 9 * * 1')

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
    )

    await page.getByTestId('task-input-name').fill(taskName)
    await page.getByTestId('task-input-prompt').fill('Cron test prompt')
    await page.getByTestId('task-submit-btn').click()

    const response = await responsePromise
    const body = response.request().postDataJSON()
    expect(body.scheduleType).toBe('cron')
    expect(body.scheduleValue).toBe('0 9 * * 1')

    // 验证列表中出现
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await expect(page.getByText('cron: 0 9 * * 1').first()).toBeVisible()
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

  test('一次性快捷选项可直接设定时间', async ({ page }) => {
    const taskName = UNIQUE()
    await page.getByTestId('task-create-btn').click()
    await page.getByTestId('task-schedule-type-once').click()

    await page.getByTestId('task-input-name').fill(taskName)
    await page.getByTestId('task-input-prompt').fill('preset once test')
    await page.getByTestId('task-once-preset-30m').click()

    const scheduleInput = page.getByTestId('task-input-schedule')
    await expect(scheduleInput).not.toHaveValue('')

    const before = Date.now()
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/tasks') && r.request().method() === 'POST' && r.status() === 201
    )
    await page.getByTestId('task-submit-btn').click()

    const response = await responsePromise
    const body = response.request().postDataJSON()
    const scheduleAt = new Date(body.scheduleValue).getTime()
    expect(scheduleAt).toBeGreaterThanOrEqual(before + 29 * 60_000)
    expect(scheduleAt).toBeLessThanOrEqual(before + 31 * 60_000)
  })

  test('切换调度类型时切到 Cron 默认展示可视化 preset', async ({ page }) => {
    await page.getByTestId('task-create-btn').click()

    // 默认 interval，填入值
    await page.getByTestId('task-input-schedule').fill('60')
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('60')

    // 切到 cron → 展示默认 preset 预览
    await page.getByTestId('task-schedule-type-cron').click()
    await expect(page.getByTestId('task-cron-preview')).toHaveText('0 9 * * *')

    // 切到 custom 时会带入当前生成值，便于继续编辑
    await page.getByTestId('task-cron-mode-custom').click()
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('0 9 * * *')

    // 切到 once → 值清空
    await page.getByTestId('task-schedule-type-once').click()
    await expect(page.getByTestId('task-input-schedule')).toHaveValue('')
  })

  test('克隆任务', async ({ page, request }) => {
    const taskName = UNIQUE()
    await createTaskViaAPI(request, { name: taskName })

    await reloadTasksPage(page)

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

    await reloadTasksPage(page)

    await page.getByTestId('task-item').filter({ hasText: taskName }).click()

    // 无 pause 按钮
    await expect(page.getByTestId('task-pause-btn')).not.toBeVisible()
    // edit/delete/run 仍在
    await expect(page.getByTestId('task-edit-btn')).toBeVisible()
    await expect(page.getByTestId('task-delete-btn')).toBeVisible()
    await expect(page.getByTestId('task-run-btn')).toBeVisible()
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
      await setOnceDateTime(page, datetimeLocal)
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

      await reloadTasksPage(page)
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

  test('once 编辑回显新的日期时间选择器值', async ({ page, request }) => {
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

    await reloadTasksPage(page)
    await page.getByTestId('task-item').filter({ hasText: taskName }).click()
    await page.getByTestId('task-edit-btn').click()

    // 精确比对：应与 isoToDatetimeLocal(isoValue) 一致
    const scheduleInput = page.getByTestId('task-input-schedule')
    const d = new Date(isoValue)
    const pad = (n: number) => n.toString().padStart(2, '0')
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    await expect(scheduleInput).toHaveValue(expected)

    await page.getByTestId('task-once-preset-custom').click()
    await scheduleInput.click()
    await expect(page.getByTestId('task-once-hour')).toHaveAttribute('data-value', pad(d.getHours()))
    await expect(page.getByTestId('task-once-minute')).toHaveAttribute('data-value', pad(d.getMinutes()))
  })
})
