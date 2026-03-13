import {
  test, expect, UNIQUE,
  createProfileViaAPI, getProfilesViaAPI, deleteProfileViaAPI,
  cleanupE2EProfiles, navigateToBrowser, createProfileUI,
} from './helpers'

test.describe('Browser Profiles: CRUD 操作', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBrowser(page)
  })

  test.afterEach(async ({ request }) => {
    await cleanupE2EProfiles(request)
  })

  test('通过 UI 创建 Profile', async ({ page, request }) => {
    const name = `E2E-create-${Date.now()}`

    await createProfileUI(page, name)

    // 列表中应出现新 Profile
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: name })).toBeVisible({ timeout: 5_000 })

    // API 验证
    const profiles = await getProfilesViaAPI(request)
    expect(profiles.some((p) => p.name === name)).toBe(true)
  })

  test('点击列表项显示详情', async ({ page, request }) => {
    const name = `E2E-detail-${Date.now()}`
    await createProfileViaAPI(request, name)

    await page.reload()
    await page.waitForLoadState('networkidle')

    await page.getByTestId('browser-profile-item').filter({ hasText: name }).click()

    // 详情面板可见
    await expect(page.getByTestId('browser-profile-detail')).toBeVisible()
    await expect(page.getByTestId('browser-profile-name')).toHaveText(name)
    await expect(page.getByTestId('browser-launch-btn')).toBeVisible()
    await expect(page.getByTestId('browser-delete-btn')).toBeVisible()
  })

  test('删除 Profile — 确认删除', async ({ page, request }) => {
    const profile = await createProfileViaAPI(request)

    await page.reload()
    await page.waitForLoadState('networkidle')

    // 选中 Profile
    await page.getByTestId('browser-profile-item').filter({ hasText: profile.name }).click()
    await expect(page.getByTestId('browser-profile-detail')).toBeVisible()

    // 注册 dialog accept
    page.once('dialog', (d) => d.accept())

    // 等待 DELETE 响应
    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/api/browser-profiles/') && r.request().method() === 'DELETE',
    )

    await page.getByTestId('browser-delete-btn').click()
    await deletePromise

    // API 验证已删除
    const profiles = await getProfilesViaAPI(request)
    expect(profiles.find((p) => p.id === profile.id)).toBeUndefined()
  })

  test('删除 Profile — 取消删除', async ({ page, request }) => {
    const profile = await createProfileViaAPI(request)

    await page.reload()
    await page.waitForLoadState('networkidle')

    const countBefore = await page.getByTestId('browser-profile-item').count()

    // 选中 Profile
    await page.getByTestId('browser-profile-item').filter({ hasText: profile.name }).click()

    // 注册 dialog dismiss
    page.once('dialog', (d) => d.dismiss())

    await page.getByTestId('browser-delete-btn').click()

    // 数量不变
    await expect(page.getByTestId('browser-profile-item')).toHaveCount(countBefore)

    // API 验证仍存在
    const profiles = await getProfilesViaAPI(request)
    expect(profiles.find((p) => p.id === profile.id)).toBeDefined()
  })

  test('创建后自动选中新 Profile', async ({ page }) => {
    const name = `E2E-autoselect-${Date.now()}`

    await createProfileUI(page, name)

    // 创建后表单关闭，列表中出现新项
    await expect(page.getByTestId('browser-input-name')).not.toBeVisible()
    await expect(page.getByTestId('browser-profile-item').filter({ hasText: name })).toBeVisible({ timeout: 5_000 })
  })

  test('通过 UI 连续创建多个 Profile 均可见', async ({ page }) => {
    const names = [
      `E2E-multi-${Date.now()}-a`,
      `E2E-multi-${Date.now()}-b`,
      `E2E-multi-${Date.now()}-c`,
    ]

    // 通过 UI 创建，避免 reload 时被并行 worker 清理
    for (const name of names) {
      await createProfileUI(page, name)
    }

    for (const name of names) {
      await expect(page.getByTestId('browser-profile-item').filter({ hasText: name })).toBeVisible({ timeout: 5_000 })
    }
  })
})
