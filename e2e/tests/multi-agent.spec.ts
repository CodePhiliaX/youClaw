import { test, expect } from '../fixtures'

/**
 * 多 Agent 协调 E2E 测试
 *
 * 测试流程：
 * 1. 通过 API 创建测试 Agent + 配置 Sub Agent
 * 2. 在 Chat 页面选择该 Agent，发送消息触发 Sub Agent 调度
 * 3. 验证主 Agent 收到 Sub Agent 结果后返回最终回复
 * 4. 清理：删除测试 Agent
 */

const AGENT_ID = 'e2e-coordinator'
const AGENT_NAME = 'E2E Coordinator'
const API_BASE = 'http://localhost:23107'

test.describe('多 Agent 创建与协调', () => {
  test.setTimeout(180_000)

  // --- Setup: 通过 API 创建带 Sub Agent 的测试 Agent ---
  test.beforeAll(async ({ request }) => {
    // 创建 Agent
    await request.post(`${API_BASE}/api/agents`, {
      data: { id: AGENT_ID, name: AGENT_NAME, model: 'claude-sonnet-4-6' },
    })

    // 配置 Sub Agent（model 必须用 SDK 短名称: sonnet/opus/haiku）
    await request.put(`${API_BASE}/api/agents/${AGENT_ID}`, {
      data: {
        agents: {
          'math-helper': {
            description: '执行简单的数学计算和推理，返回计算结果',
            prompt: 'You are a math assistant. When asked a math question, compute the answer and return ONLY the numeric result. Be concise.',
            model: 'sonnet',
            maxTurns: 3,
          },
        },
      },
    })

    // 等待 agent 重新加载
    await new Promise(r => setTimeout(r, 2000))
  })

  // --- Teardown: 清理测试 Agent ---
  test.afterAll(async ({ request }) => {
    await request.delete(`${API_BASE}/api/agents/${AGENT_ID}`)
  })

  test('Agent 列表中出现新 Agent', async ({ page }) => {
    await page.getByTestId('nav-agents').click()
    await page.waitForLoadState('networkidle')

    // 验证测试 Agent 在列表中
    await expect(page.getByTestId('agent-item').filter({ hasText: AGENT_NAME })).toBeVisible({ timeout: 10_000 })

    // 点击进去看 Sub Agent 已配置
    await page.getByTestId('agent-item').filter({ hasText: AGENT_NAME }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('subagent-item').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('subagent-item').filter({ hasText: 'math-helper' })).toBeVisible()
  })

  test('选择 Agent 并发送消息，Sub Agent 协调后返回结果', async ({ page }) => {
    // 先确保在新聊天状态
    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 点击新建聊天
    const newChatBtn = page.getByTestId('chat-new')
    if (await newChatBtn.isVisible().catch(() => false)) {
      await newChatBtn.click()
      await page.waitForTimeout(500)
    }

    // 选择测试 Agent（有多个 agent 时才显示选择按钮）
    const agentBtn = page.getByTestId(`chat-agent-${AGENT_ID}`)
    if (await agentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agentBtn.click()
      await page.waitForTimeout(300)
    }

    // 发送一条明确要求使用 sub agent 的消息
    const prompt = '请使用你的 math-helper 子 agent 来计算 17 乘以 23 等于多少，然后把结果告诉我。'
    await page.getByTestId('chat-input').fill(prompt)
    await page.getByTestId('chat-send').click()

    // 等待用户消息出现
    await expect(page.getByTestId('message-user').first()).toBeVisible({ timeout: 10_000 })

    // 等待 assistant 最终回复（Sub Agent 执行 + 主 Agent 整合，可能需要较长时间）
    await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout: 120_000 })

    // 验证回复包含正确答案 391
    const assistantMsg = page.getByTestId('message-assistant').first()
    await expect(assistantMsg).toContainText('391', { timeout: 10_000 })
  })

  test('对话历史正确保留', async ({ page }) => {
    // 聊天列表应有该对话
    const chatItem = page.getByTestId('chat-item').first()
    await expect(chatItem).toBeVisible({ timeout: 10_000 })

    // 点击到其他页面再回来
    await page.getByTestId('nav-agents').click()
    await page.waitForTimeout(500)
    await page.getByTestId('nav-chat').click()
    await page.waitForLoadState('networkidle')

    // 点击聊天记录，验证历史消息加载
    await page.getByTestId('chat-item').first().click()
    await page.waitForTimeout(1000)

    // 应该能看到之前的用户消息和 assistant 回复
    await expect(page.getByTestId('message-user').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout: 10_000 })
  })
})
