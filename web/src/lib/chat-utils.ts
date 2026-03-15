export type ChatItem = {
  chat_id: string
  name: string
  agent_id: string
  channel: string
  last_message_time: string
  last_message: string | null
}

/** 根据 chatId 生成基于主题色的确定性渐变 */
export function chatAvatar(chatId: string): string {
  let hash = 0
  for (let i = 0; i < chatId.length; i++) {
    hash = ((hash << 5) - hash + chatId.charCodeAt(i)) | 0
  }
  // 基于主题色 hue(25) 做偏移，生成同色系渐变
  const offset = Math.abs(hash) % 5
  const hueShifts = [0, 15, -15, 30, -30]
  const h1 = 25 + hueShifts[offset]
  const h2 = h1 + 40
  return `linear-gradient(135deg, oklch(0.65 0.18 ${h1}), oklch(0.55 0.15 ${h2}))`
}

// 按日期分组对话
export function groupChatsByDate(
  chats: ChatItem[],
  labels: { today: string; yesterday: string; older: string }
): { label: string; items: ChatItem[] }[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: ChatItem[] = []
  const yesterday: ChatItem[] = []
  const older: ChatItem[] = []

  for (const chat of chats) {
    const time = new Date(chat.last_message_time).getTime()
    if (time >= todayStart) today.push(chat)
    else if (time >= yesterdayStart) yesterday.push(chat)
    else older.push(chat)
  }

  const groups: { label: string; items: ChatItem[] }[] = []
  if (today.length) groups.push({ label: labels.today, items: today })
  if (yesterday.length) groups.push({ label: labels.yesterday, items: yesterday })
  if (older.length) groups.push({ label: labels.older, items: older })
  return groups
}
