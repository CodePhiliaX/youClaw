import { test, expect, UNIQUE, createTaskViaAPI, cleanupE2ETasks, navigateToTasks } from './helpers'

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
