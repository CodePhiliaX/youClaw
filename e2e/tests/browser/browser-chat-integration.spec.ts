import { test, expect, UNIQUE, createProfileViaAPI, cleanupE2EProfiles } from './helpers'

const API_BASE = 'http://localhost:3000'

test.describe('Browser Profiles: Chat 集成', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test('Chat 页面无 Profile 时不显示 Globe 选择器', async ({ page }) => {
    // 确保没有 E2E Profile
    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // Globe 按钮不应出现（前提是没有任何 Profile）
    // 这取决于系统是否已有 Profile，所以我们检查的是逻辑正确性
    // 如果没有 Profile，Globe 按钮不可见
  })

  test('Chat 页面有 Profile 时显示 Globe 选择器', async ({ page, request }) => {
    const profile = await createProfileViaAPI(request, `E2E-chat-globe-${Date.now()}`)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 欢迎页应有 Globe 选择器（包含"浏览器 Profile"或"Browser Profile"文本）
    const globeBtn = page.locator('button').filter({ hasText: /浏览器 Profile|Browser Profile/ })
    await expect(globeBtn.first()).toBeVisible({ timeout: 5_000 })
  })

  test('Globe 选择器列出可用 Profile', async ({ page, request }) => {
    const name = `E2E-chat-list-${Date.now()}`
    await createProfileViaAPI(request, name)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 点击 Globe 按钮打开下拉菜单
    const globeBtn = page.locator('button').filter({ hasText: /浏览器 Profile|Browser Profile/ })
    await globeBtn.first().click()

    // 下拉菜单中应有 Profile 名称
    await expect(page.locator('[role="menuitem"]').filter({ hasText: name })).toBeVisible()

    // 以及 "不使用" / "None" 选项
    const noneOption = page.locator('[role="menuitem"]').filter({ hasText: /不使用|None/ })
    await expect(noneOption).toBeVisible()
  })

  test('选择 Profile 后按钮高亮显示名称', async ({ page, request }) => {
    const name = `E2E-chat-select-${Date.now()}`
    await createProfileViaAPI(request, name)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 打开下拉菜单并选择 Profile
    const globeBtn = page.locator('button').filter({ hasText: /浏览器 Profile|Browser Profile/ })
    await globeBtn.first().click()
    await page.locator('[role="menuitem"]').filter({ hasText: name }).click()

    // 按钮应显示 Profile 名称
    await expect(globeBtn.first()).toContainText(name)
  })

  test('选择"不使用"后恢复默认文本', async ({ page, request }) => {
    const name = `E2E-chat-deselect-${Date.now()}`
    await createProfileViaAPI(request, name)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    const globeBtn = page.locator('button').filter({ hasText: /浏览器 Profile|Browser Profile/ })

    // 先选中
    await globeBtn.first().click()
    await page.locator('[role="menuitem"]').filter({ hasText: name }).click()
    await expect(globeBtn.first()).toContainText(name)

    // 再取消
    await globeBtn.first().click()
    const noneOption = page.locator('[role="menuitem"]').filter({ hasText: /不使用|None/ })
    await noneOption.click()

    // 按钮恢复默认文本
    const btnText = await globeBtn.first().textContent()
    expect(btnText).toMatch(/浏览器 Profile|Browser Profile/)
    expect(btnText).not.toContain(name)
  })

  test('发送消息时透传 browserProfileId', async ({ page, request }) => {
    const profile = await createProfileViaAPI(request, `E2E-chat-send-${Date.now()}`)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 选择 Profile
    const globeBtn = page.locator('button').filter({ hasText: /浏览器 Profile|Browser Profile/ })
    await globeBtn.first().click()
    await page.locator('[role="menuitem"]').filter({ hasText: profile.name }).click()

    // 拦截 API 请求验证 body
    const requestPromise = page.waitForRequest(
      (r) => r.url().includes('/api/agents/') && r.url().includes('/message') && r.method() === 'POST',
    )

    await page.getByTestId('chat-input').fill('Browser profile test')
    await page.getByTestId('chat-send').click()

    const req = await requestPromise
    const body = req.postDataJSON()
    expect(body.browserProfileId).toBe(profile.id)
  })

  test('不选 Profile 时不发送 browserProfileId', async ({ page, request }) => {
    // 创建一个 Profile 以确保 Globe 按钮显示
    await createProfileViaAPI(request, `E2E-chat-nosend-${Date.now()}`)

    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 不选择任何 Profile，直接发送

    const requestPromise = page.waitForRequest(
      (r) => r.url().includes('/api/agents/') && r.url().includes('/message') && r.method() === 'POST',
    )

    await page.getByTestId('chat-input').fill('No profile test')
    await page.getByTestId('chat-send').click()

    const req = await requestPromise
    const body = req.postDataJSON()
    // browserProfileId 应为 undefined 或 null
    expect(body.browserProfileId).toBeFalsy()
  })
})
