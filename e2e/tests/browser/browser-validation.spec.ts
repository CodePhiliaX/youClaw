import {
  test, expect, UNIQUE,
  createProfileViaAPI, cleanupE2EProfiles,
  navigateToBrowser, createProfileUI,
} from './helpers'

test.describe('Browser Profiles: 边界情况与验证', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBrowser(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test('特殊字符名称', async ({ page, request }) => {
    const specialName = `E2E-<>&"'-${Date.now()}`
    await createProfileViaAPI(request, specialName)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 验证列表正确显示
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: specialName })).toBeVisible()

    // 验证详情正确显示
    await page.getByTestId('browser-profile-item').filter({ hasText: specialName }).click()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(specialName)
  })

  test('超长名称可创建', async ({ page, request }) => {
    const longName = 'E2E-' + 'A'.repeat(196) // 200 字符
    await createProfileViaAPI(request, longName)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 验证创建成功 — 列表可见
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: longName.slice(0, 50) })).toBeVisible()

    // 详情面板显示完整名称
    await page.getByTestId('browser-profile-item').filter({ hasText: longName.slice(0, 50) }).click()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(longName)
  })

  test('重复名称可创建', async ({ page, request }) => {
    const dupName = `E2E-dup-${Date.now()}`
    await createProfileViaAPI(request, dupName)
    await createProfileViaAPI(request, dupName)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 等待至少一个同名项可见
    const items = page.getByTestId('browser-profile-item').filter({ hasText: dupName })
    await expect(items.first()).toBeVisible({ timeout: 5_000 })

    // 验证列表中有 >= 2 个同名项
    await expect(items).toHaveCount(2, { timeout: 5_000 })
  })

  test('详情面板在多 Profile 间切换', async ({ page, request }) => {
    const nameA = `E2E-switchA-${Date.now()}`
    const nameB = `E2E-switchB-${Date.now()}`
    const profileA = await createProfileViaAPI(request, nameA)
    const profileB = await createProfileViaAPI(request, nameB)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击 A 验证详情
    await page.getByTestId('browser-profile-item').filter({ hasText: nameA }).click()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(nameA)
    await expect(page.getByText(`browser-profiles/${profileA.id}/`)).toBeVisible()

    // 点击 B 验证详情切换
    await page.getByTestId('browser-profile-item').filter({ hasText: nameB }).click()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(nameB)
    await expect(page.getByText(`browser-profiles/${profileB.id}/`)).toBeVisible()
    // A 的数据不再显示
    await expect(page.getByText(`browser-profiles/${profileA.id}/`)).not.toBeVisible()
  })

  test('选中 Profile 时点击创建切换到表单', async ({ page, request }) => {
    await createProfileViaAPI(request)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 选中 profile — detail 可见
    await page.getByTestId('browser-profile-item').first().click()
    await expect(page.getByTestId('browser-profile-detail')).toBeVisible()

    // 点创建按钮 → form 可见 + detail 不可见
    await page.getByTestId('browser-create-btn').click()
    await expect(page.getByTestId('browser-input-name')).toBeVisible()
    await expect(page.getByTestId('browser-profile-detail')).not.toBeVisible()
  })

  test('快速连续创建两个 Profile', async ({ page }) => {
    const nameA = UNIQUE()
    const nameB = UNIQUE()

    // 创建第一个（createProfileUI 内部会点 create btn）
    await createProfileUI(page, nameA)

    // 创建第二个（createProfileUI 内部会再点 create btn）
    await createProfileUI(page, nameB)

    // 验证两个都在列表中
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: nameA })).toBeVisible()
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: nameB })).toBeVisible()
  })

  test('前后空格被 trim', async ({ page }) => {
    const rawName = '  E2E-trimtest  '
    const trimmedName = 'E2E-trimtest'

    await page.getByTestId('browser-create-btn').click()
    await page.getByTestId('browser-input-name').fill(rawName)

    // 拦截 POST 请求
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/browser-profiles') && req.method() === 'POST'
    )

    await page.getByTestId('browser-submit-btn').click()

    const req = await requestPromise
    const body = req.postDataJSON()
    expect(body.name).toBe(trimmedName)
  })
})
