import { test, expect } from '../fixtures'

test.describe('聊天流程', () => {
  test.setTimeout(120_000)

  test('发送消息并收到回复', async ({ page }) => {
    // 确认在聊天页面
    await expect(page.getByTestId('chat-input')).toBeVisible()

    // 输入消息
    await page.getByTestId('chat-input').fill('请用一句话回答：1+1等于几？')
    await page.getByTestId('chat-send').click()

    // 等待用户消息出现
    await expect(page.getByTestId('message-user')).toBeVisible({ timeout: 10_000 })

    // 等待 assistant 消息出现（真实 API，需要较长等待）
    await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout: 90_000 })

    // 验证 assistant 消息非空
    const assistantMsg = page.getByTestId('message-assistant').first()
    await expect(assistantMsg).not.toBeEmpty()
  })

  test('聊天列表出现新会话', async ({ page }) => {
    // 发送一条消息创建新对话
    await page.getByTestId('chat-input').fill('测试消息')
    await page.getByTestId('chat-send').click()

    // 等待 assistant 回复
    await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout: 90_000 })

    // 验证右侧聊天列表有会话项
    await expect(page.getByTestId('chat-item').first()).toBeVisible({ timeout: 10_000 })
  })

  test('新建聊天', async ({ page }) => {
    // 如果有新建聊天按钮，点击它
    const newChatBtn = page.getByTestId('chat-new')
    if (await newChatBtn.isVisible()) {
      await newChatBtn.click()
      // 应该回到欢迎页
      await expect(page.getByTestId('chat-input')).toBeVisible()
    }
  })
})
