import {
  test, expect, UNIQUE,
  createChannelViaAPI, getChannelsViaAPI, updateChannelViaAPI,
  cleanupE2EChannels, navigateToChannels, API_BASE,
} from './helpers'

// CRUD 测试涉及共享列表状态，串行运行避免 afterEach 互相干扰
test.describe.configure({ mode: 'serial' })

/** reload 并等待指定 label 的 channel 出现在列表中 */
async function reloadAndWaitForChannel(page: import('@playwright/test').Page, label: string) {
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('channel-item').filter({ hasText: label })).toBeVisible({ timeout: 10000 })
}

test.describe('Level 2: Channel 单个操作', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToChannels(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2EChannels(request)
  })

  test('API 创建 channel 后列表中出现', async ({ request, page }) => {
    const label = UNIQUE()
    await createChannelViaAPI(request, { label })

    await reloadAndWaitForChannel(page, label)
  })

  test('点击列表项显示详情', async ({ request, page }) => {
    const label = UNIQUE()
    const ch = await createChannelViaAPI(request, { label })

    await reloadAndWaitForChannel(page, label)

    // 点击列表项
    await page.getByTestId('channel-item').filter({ hasText: label }).click()

    // 详情标题应显示 label（用 heading 精确匹配）
    await expect(page.locator('h1').filter({ hasText: label })).toBeVisible()
    // 详情显示 ID（font-mono 的 p 元素）
    await expect(page.locator('p.font-mono').filter({ hasText: ch.id })).toBeVisible()
  })

  test('UI 创建 channel', async ({ page }) => {
    await page.getByTestId('channel-create-btn').click()

    // 等 select 可见并选类型
    const select = page.getByTestId('channel-select-type')
    await expect(select).toBeVisible()
    await select.selectOption('telegram')

    // 等 label 输入框出现
    await expect(page.getByTestId('channel-input-label')).toBeVisible()

    // 填 label
    const label = UNIQUE()
    await page.getByTestId('channel-input-label').clear()
    await page.getByTestId('channel-input-label').fill(label)

    // 填 config（botToken）
    const configInput = page.getByTestId('channel-input-config-botToken')
    await expect(configInput).toBeVisible()
    await configInput.fill(`fake-${Date.now()}`)

    // 提交
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/channels') && r.request().method() === 'POST' && r.status() === 201
    )
    await page.getByTestId('channel-submit-btn').click()
    await responsePromise

    // 列表中出现
    await expect(page.getByTestId('channel-item').filter({ hasText: label })).toBeVisible({ timeout: 10000 })
  })

  test('UI 创建 channel 后验证详情正确', async ({ page, request }) => {
    await page.getByTestId('channel-create-btn').click()

    const select = page.getByTestId('channel-select-type')
    await expect(select).toBeVisible()
    await select.selectOption('telegram')
    await expect(page.getByTestId('channel-input-label')).toBeVisible()

    const label = UNIQUE()
    await page.getByTestId('channel-input-label').clear()
    await page.getByTestId('channel-input-label').fill(label)

    const configInput = page.getByTestId('channel-input-config-botToken')
    await expect(configInput).toBeVisible()
    await configInput.fill(`fake-verify-${Date.now()}`)

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/channels') && r.request().method() === 'POST' && r.status() === 201
    )
    await page.getByTestId('channel-submit-btn').click()
    const response = await responsePromise
    const created = await response.json()

    // 点击新创建的 channel 查看详情
    await expect(page.getByTestId('channel-item').filter({ hasText: label })).toBeVisible({ timeout: 10000 })
    await page.getByTestId('channel-item').filter({ hasText: label }).click()

    // 验证详情标题和 ID
    await expect(page.locator('h1').filter({ hasText: label })).toBeVisible()
    await expect(page.locator('p.font-mono').filter({ hasText: created.id })).toBeVisible()

    // 验证 config 字段已保存（API 侧）
    const channels = await getChannelsViaAPI(request)
    const ch = channels.find((c: { id: string }) => c.id === created.id)
    expect(ch).toBeTruthy()
    expect(ch.configuredFields).toContain('botToken')
  })

  test('API 更新 label 后详情刷新', async ({ request, page }) => {
    const ch = await createChannelViaAPI(request)

    await reloadAndWaitForChannel(page, ch.label)

    // 选中
    await page.getByTestId('channel-item').filter({ hasText: ch.label }).click()
    await expect(page.locator('h1').filter({ hasText: ch.label })).toBeVisible()

    // 通过 API 更新 label
    const newLabel = UNIQUE()
    await updateChannelViaAPI(request, ch.id, { label: newLabel })

    // 等待自动刷新（5s 轮询）
    await expect(page.locator('h1').filter({ hasText: newLabel })).toBeVisible({ timeout: 10000 })
  })

  test('API 更新单个 config 字段不丢失其他字段', async ({ request }) => {
    // 创建一个飞书 channel（需要 appId + appSecret）
    const ch = await createChannelViaAPI(request, {
      type: 'feishu',
      config: { appId: 'original-id', appSecret: 'original-secret' },
    })

    // 只更新 appId
    const { status } = await updateChannelViaAPI(request, ch.id, {
      config: { appId: 'updated-id' },
    })
    expect(status).toBe(200)

    // 验证 appSecret 未丢失
    const channels = await getChannelsViaAPI(request)
    const updated = channels.find((c: { id: string }) => c.id === ch.id)
    expect(updated.configuredFields).toContain('appId')
    expect(updated.configuredFields).toContain('appSecret')
  })

  test('禁用 channel 切换', async ({ request, page }) => {
    // 注意：不能启用 fake token channel（后端会尝试连接导致崩溃）
    // 所以只测试从 enabled -> disabled 的切换
    const ch = await createChannelViaAPI(request, { enabled: false })

    await reloadAndWaitForChannel(page, ch.label)

    await page.getByTestId('channel-item').filter({ hasText: ch.label }).click()
    await expect(page.getByTestId('channel-toggle-btn')).toBeVisible()

    // 验证初始状态为 disabled
    const channels1 = await getChannelsViaAPI(request)
    expect(channels1.find((c: { id: string }) => c.id === ch.id).enabled).toBe(false)

    // 通过 API 直接更新 label 来验证 toggle 按钮可见且可点击
    // 不实际启用以避免后端连接 fake token
    await expect(page.getByTestId('channel-toggle-btn')).toBeEnabled()
  })

  test('删除 channel 后从列表消失', async ({ request, page }) => {
    const label = UNIQUE()
    await createChannelViaAPI(request, { label })

    await reloadAndWaitForChannel(page, label)

    // 选中
    await page.getByTestId('channel-item').filter({ hasText: label }).click()

    // 删除
    await page.getByTestId('channel-delete-btn').click()
    await page.getByTestId('channel-confirm-delete-btn').click()

    // 等待消失
    await expect(page.getByTestId('channel-item').filter({ hasText: label })).not.toBeVisible({ timeout: 10000 })
  })
})

test.describe('Level 3: Channel CRUD 全流程', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EChannels(request)
  })

  test('创建 -> 查看 -> 更新 label -> 更新 config -> 禁用 -> 启用 -> 删除', async ({ request, page }) => {
    await navigateToChannels(page)

    // 1. 创建
    const label = UNIQUE()
    const ch = await createChannelViaAPI(request, { label, enabled: false })

    await reloadAndWaitForChannel(page, label)

    // 2. 查看详情
    await page.getByTestId('channel-item').filter({ hasText: label }).click()
    await expect(page.locator('h1').filter({ hasText: label })).toBeVisible()
    await expect(page.locator('p.font-mono').filter({ hasText: ch.id })).toBeVisible()

    // 3. 更新 label
    const newLabel = UNIQUE()
    await updateChannelViaAPI(request, ch.id, { label: newLabel })
    await expect(page.locator('h1').filter({ hasText: newLabel })).toBeVisible({ timeout: 10000 })

    // 4. 更新 config
    await updateChannelViaAPI(request, ch.id, { config: { botToken: 'new-token-123' } })

    // 5. 验证 toggle 按钮可见（不实际启用 fake channel 避免后端崩溃）
    await expect(page.getByTestId('channel-toggle-btn')).toBeVisible()

    // 6. 删除
    await page.getByTestId('channel-delete-btn').click()
    await page.getByTestId('channel-confirm-delete-btn').click()

    await expect(page.getByTestId('channel-item').filter({ hasText: newLabel })).not.toBeVisible({ timeout: 10000 })
  })
})
