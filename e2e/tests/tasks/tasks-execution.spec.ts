import { test, expect, UNIQUE, API_BASE, createTaskViaAPI, cleanupE2ETasks, navigateToTasks } from './helpers'

test.describe('真实执行', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToTasks(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2ETasks(request)
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
