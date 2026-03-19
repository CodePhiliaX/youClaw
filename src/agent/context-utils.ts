import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export interface StoredSessionEntry {
  sessionId: string
  sessionFile: string | null
}

export interface ChatHistoryMessage {
  content: string
  isBotMessage: boolean
}

function trimContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars) + '...'
}

export function resolveStoredSessionFile(sessionsDir: string, stored: StoredSessionEntry | null): string | null {
  if (!stored?.sessionId) return null

  if (stored.sessionFile && existsSync(stored.sessionFile)) {
    return stored.sessionFile
  }

  if (!existsSync(sessionsDir)) {
    return null
  }

  const candidates = readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.jsonl') && name.includes(stored.sessionId))
    .map((name) => resolve(sessionsDir, name))
    .filter((filePath) => {
      try {
        return statSync(filePath).isFile()
      } catch {
        return false
      }
    })
    .sort((a, b) => basename(b).localeCompare(basename(a)))

  return candidates[0] ?? null
}

export function buildRecoveredConversationPrompt(
  messages: ChatHistoryMessage[],
  currentPrompt: string,
  limit: number,
): string {
  if (limit <= 0) return currentPrompt

  let skippedCurrentUserMessage = false
  const priorMessages = messages.filter((message) => {
    if (!skippedCurrentUserMessage && !message.isBotMessage && message.content === currentPrompt) {
      skippedCurrentUserMessage = true
      return false
    }
    return true
  })

  const recovered = priorMessages.slice(-limit)
  if (recovered.length === 0) {
    return currentPrompt
  }

  const formatted = recovered
    .map((message) => {
      const role = message.isBotMessage ? 'Assistant' : 'User'
      return `${role}: ${trimContent(message.content.replace(/\s+/g, ' ').trim(), 1200)}`
    })
    .join('\n')

  return [
    '<recovered_conversation>',
    'Recent conversation context recovered from the local chat history because the persisted pi session was unavailable.',
    formatted,
    '</recovered_conversation>',
    '',
    currentPrompt,
  ].join('\n')
}
