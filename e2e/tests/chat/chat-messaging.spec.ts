import {
  test, expect,
  navigateToChat, ensureNewChat,
  sendMessageUI, waitForAssistantReply,
  snapshotChats, UNIQUE,
} from './helpers'

test.describe('Level 3: 消息发送与流式显示', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  let cleanup: (() => Promise<void>) | undefined

  test.beforeEach(async ({ page, request }) => {
    // 检查服务健康
    let healthy = false
    try {
      const res = await request.get('http://localhost:23107/api/health')
      healthy = res.status() === 200
    } catch {
      healthy = false
    }
    test.skip(!healthy, 'API server not healthy or not reachable')

    cleanup = await snapshotChats(request)
    await navigateToChat(page)
    await ensureNewChat(page)
  })

  test.afterEach(async () => {
    if (cleanup) await cleanup()
  })

  test('发送消息并收到流式回复', async ({ page }) => {
    await sendMessageUI(page, '请用一句话回答：1+1等于几？')

    // 验证用户消息出现
    await expect(page.getByTestId('message-user')).toBeVisible({ timeout: 10_000 })

    // 等待 assistant 回复
    await waitForAssistantReply(page)

    // 验证 assistant 消息非空
    const assistantMsg = page.getByTestId('message-assistant').first()
    await expect(assistantMsg).not.toBeEmpty()
  })

  test('Enter 键发送消息', async ({ page }) => {
    await page.getByTestId('chat-input').fill('Enter 发送测试')
    await page.getByTestId('chat-input').press('Enter')

    await expect(page.getByTestId('message-user')).toBeVisible({ timeout: 10_000 })
  })

  test('Shift+Enter 换行不发送', async ({ page }) => {
    const input = page.getByTestId('chat-input')
    await input.fill('第一行')
    await input.press('Shift+Enter')
    await input.pressSequentially('第二行')

    // 不应出现用户消息
    await expect(page.getByTestId('message-user')).not.toBeVisible({ timeout: 2_000 })

    // 输入框值包含两行
    const value = await input.inputValue()
    expect(value).toContain('第一行')
    expect(value).toContain('第二行')
  })

  test('发送后输入框清空', async ({ page }) => {
    await sendMessageUI(page, '清空测试')
    await expect(page.getByTestId('message-user')).toBeVisible({ timeout: 10_000 })

    const value = await page.getByTestId('chat-input').inputValue()
    expect(value).toBe('')
  })

  test('处理中发送按钮状态变化', async ({ page }) => {
    await sendMessageUI(page, '按钮状态测试')

    // 发送后，按钮应该 disabled（正在处理时输入为空）
    await expect(page.getByTestId('chat-send')).toBeDisabled()
  })

  test('聊天列表出现新会话', async ({ page }) => {
    await sendMessageUI(page, '新会话测试')

    // 验证用户消息出现
    await expect(page.getByTestId('message-user')).toBeVisible({ timeout: 10_000 })

    // 验证聊天列表出现新项（发送消息后即创建，不需要等 assistant 回复）
    await expect(page.getByTestId('chat-item').first()).toBeVisible({ timeout: 10_000 })
  })

  test('连续发送多条消息顺序正确', async ({ page, request }) => {
    // 需要等两次 AI 回复，设更长 timeout
    test.setTimeout(240_000)
    const marker1 = `MSG-1-${UNIQUE()}`
    const marker2 = `MSG-2-${UNIQUE()}`

    // 发送第一条
    await sendMessageUI(page, marker1)
    await waitForAssistantReply(page)

    // 发送第二条
    await sendMessageUI(page, marker2)
    await expect(page.getByTestId('message-user').nth(1)).toBeVisible({ timeout: 10_000 })
    // 等待第二条 assistant 回复（nth(1) 是第二个）
    await expect(page.getByTestId('message-assistant').nth(1)).toBeVisible({ timeout: 90_000 })

    // 验证用户消息数量
    const userMsgCount = await page.getByTestId('message-user').count()
    expect(userMsgCount).toBeGreaterThanOrEqual(2)

    // 验证 assistant 消息数量
    const assistantMsgCount = await page.getByTestId('message-assistant').count()
    expect(assistantMsgCount).toBeGreaterThanOrEqual(2)

    // 验证消息交替顺序：获取所有消息元素
    const allMessages = page.locator('[data-testid="message-user"], [data-testid="message-assistant"]')
    const count = await allMessages.count()
    const testids: string[] = []
    for (let i = 0; i < count; i++) {
      const tid = await allMessages.nth(i).getAttribute('data-testid')
      if (tid) testids.push(tid)
    }

    // 找到 marker1 和 marker2 在消息中的位置
    const allTexts = await allMessages.allTextContents()
    const idx1 = allTexts.findIndex((t) => t.includes(marker1))
    const idx2 = allTexts.findIndex((t) => t.includes(marker2))
    expect(idx1).toBeGreaterThanOrEqual(0)
    expect(idx2).toBeGreaterThan(idx1)

    // 验证 user → assistant 交替
    expect(testids[idx1]).toBe('message-user')
    if (idx1 + 1 < testids.length) {
      expect(testids[idx1 + 1]).toBe('message-assistant')
    }
    expect(testids[idx2]).toBe('message-user')
  })

  test('消息历史在重新加载后保留且顺序正确', async ({ page }) => {
    test.setTimeout(240_000)
    const markerFirst = `FIRST-${UNIQUE()}`
    const markerSecond = `SECOND-${UNIQUE()}`

    // 发送两条消息
    await sendMessageUI(page, markerFirst)
    await waitForAssistantReply(page)

    await sendMessageUI(page, markerSecond)
    await expect(page.getByTestId('message-user').nth(1)).toBeVisible({ timeout: 10_000 })
    // 等待第二条 assistant 回复
    await expect(page.getByTestId('message-assistant').nth(1)).toBeVisible({ timeout: 90_000 })

    // 刷新页面
    await page.reload()
    await page.waitForLoadState('networkidle')

    // 点击对话项加载
    await page.getByTestId('chat-item').first().click()

    // 等待消息加载
    await expect(page.getByTestId('message-user').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout: 10_000 })

    // 验证加载后顺序
    const allMessages = page.locator('[data-testid="message-user"], [data-testid="message-assistant"]')
    const allTexts = await allMessages.allTextContents()
    const idxFirst = allTexts.findIndex((t) => t.includes(markerFirst))
    const idxSecond = allTexts.findIndex((t) => t.includes(markerSecond))
    expect(idxFirst).toBeGreaterThanOrEqual(0)
    expect(idxSecond).toBeGreaterThan(idxFirst)

    // 验证 user/assistant 交替
    const testids: string[] = []
    const count = await allMessages.count()
    for (let i = 0; i < count; i++) {
      const tid = await allMessages.nth(i).getAttribute('data-testid')
      if (tid) testids.push(tid)
    }
    // 整体应为 user → assistant → user → assistant
    expect(testids[idxFirst]).toBe('message-user')
    expect(testids[idxFirst + 1]).toBe('message-assistant')
    expect(testids[idxSecond]).toBe('message-user')
    expect(testids[idxSecond + 1]).toBe('message-assistant')
  })
})
