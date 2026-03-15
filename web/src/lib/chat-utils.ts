export type ChatItem = {
  chat_id: string
  name: string
  agent_id: string
  channel: string
  last_message_time: string
  last_message: string | null
  avatar: string | null
}

/** 8 full-spectrum preset gradient colors */
export const PRESET_GRADIENTS = [
  'linear-gradient(135deg, oklch(0.65 0.18 0), oklch(0.50 0.15 40))',       // red
  'linear-gradient(135deg, oklch(0.65 0.18 30), oklch(0.50 0.15 70))',      // orange
  'linear-gradient(135deg, oklch(0.65 0.18 60), oklch(0.50 0.15 100))',     // yellow
  'linear-gradient(135deg, oklch(0.65 0.15 120), oklch(0.50 0.13 160))',    // green
  'linear-gradient(135deg, oklch(0.65 0.15 180), oklch(0.50 0.13 220))',    // cyan
  'linear-gradient(135deg, oklch(0.60 0.15 240), oklch(0.48 0.13 280))',    // blue
  'linear-gradient(135deg, oklch(0.62 0.17 270), oklch(0.48 0.15 310))',    // purple
  'linear-gradient(135deg, oklch(0.62 0.17 310), oklch(0.48 0.15 350))',    // pink
] as const

/** Resolve avatar field to CSS background value */
export function resolveAvatar(avatar: string | null): string {
  if (!avatar) return PRESET_GRADIENTS[0]
  if (avatar.startsWith('gradient:')) {
    const index = parseInt(avatar.split(':')[1], 10)
    return PRESET_GRADIENTS[index] ?? PRESET_GRADIENTS[0]
  }
  // Future extension: image type
  return PRESET_GRADIENTS[0]
}

// Group chats by date
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
