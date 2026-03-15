import { test, expect } from '../../fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

export { test, expect }

// ===== 常量 =====

export const API_BASE = 'http://localhost:23107'
export const UNIQUE = () => `E2E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ===== API 辅助函数 =====

/** 获取第一个可用 agent ID */
export async function getFirstAgentId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API_BASE}/api/agents`)
  const agents = await res.json()
  if (!agents.length) throw new Error('No agents available')
  return agents[0].id
}

/** 通过 API 发送消息，返回 { chatId }。会等待消息实际写入 DB */
export async function sendMessageViaAPI(
  request: APIRequestContext,
  overrides: {
    agentId?: string
    chatId?: string
    prompt?: string
  } = {}
) {
  const agentId = overrides.agentId ?? (await getFirstAgentId(request))
  const chatId = overrides.chatId ?? `web:e2e-${crypto.randomUUID().slice(0, 8)}`
  const prompt = overrides.prompt ?? `E2E test message ${UNIQUE()}`
  const body = { prompt, chatId }
  const res = await request.post(`${API_BASE}/api/agents/${agentId}/message`, { data: body })
  expect(res.status()).toBe(200)
  const result = await res.json()

  // 等待消息写入 DB（POST 是非阻塞的）
  for (let i = 0; i < 20; i++) {
    const msgs = await getMessagesViaAPI(request, result.chatId)
    if (msgs.some((m) => m.content === prompt)) break
    await new Promise((r) => setTimeout(r, 200))
  }

  return { chatId: result.chatId as string }
}

/** 获取所有对话列表 */
export async function getChatsViaAPI(request: APIRequestContext) {
  const res = await request.get(`${API_BASE}/api/chats`)
  return (await res.json()) as Array<{
    chat_id: string
    name: string
    agent_id: string
    channel: string
    last_message_time: string
  }>
}

/** 获取某个对话的消息列表 */
export async function getMessagesViaAPI(request: APIRequestContext, chatId: string) {
  const res = await request.get(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/messages`)
  return (await res.json()) as Array<{
    id: string
    chat_id: string
    sender: string
    content: string
    timestamp: string
  }>
}

/** 删除单个对话 */
export async function deleteChatViaAPI(request: APIRequestContext, chatId: string) {
  await request.delete(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}`)
}

/** 清理所有 E2E 前缀的对话（容错：忽略连接错误） */
export async function cleanupE2EChats(request: APIRequestContext) {
  try {
    const chats = await getChatsViaAPI(request)
    for (const chat of chats) {
      if (chat.chat_id.includes('e2e-')) {
        await deleteChatViaAPI(request, chat.chat_id).catch(() => {})
      }
    }
  } catch {
    // 服务不可用时跳过清理
  }
}

// ===== UI 辅助函数 =====

/** 导航到聊天页并等待加载 */
export async function navigateToChat(page: Page) {
  await page.getByTestId('nav-chat').click()
  await page.waitForLoadState('networkidle')
}

/** 确保在欢迎页状态 */
export async function ensureNewChat(page: Page) {
  // 如果不在欢迎页，点击新建
  const welcome = page.getByTestId('chat-welcome')
  if (!(await welcome.isVisible().catch(() => false))) {
    await page.getByTestId('chat-new').click()
  }
  await expect(welcome).toBeVisible()
}

/** 在输入框输入文本并点击发送 */
export async function sendMessageUI(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

/** 等待 assistant 回复出现 */
export async function waitForAssistantReply(page: Page, timeout = 90_000) {
  await expect(page.getByTestId('message-assistant').first()).toBeVisible({ timeout })
}

// ===== 数据隔离 =====

/** 记录当前对话快照，返回 cleanup 函数（删除新增的对话） */
export async function snapshotChats(request: APIRequestContext) {
  const before = await getChatsViaAPI(request)
  const beforeIds = new Set(before.map((c) => c.chat_id))

  return async function cleanup() {
    const after = await getChatsViaAPI(request)
    for (const chat of after) {
      if (!beforeIds.has(chat.chat_id)) {
        await deleteChatViaAPI(request, chat.chat_id)
      }
    }
  }
}
