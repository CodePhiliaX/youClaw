import { complete, type AssistantMessage, type Context } from '@mariozechner/pi-ai'
import { getLogger } from '../logger/index.ts'
import { resolvePiModel } from '../agent/model-resolver.ts'
import { getAuthToken } from '../routes/auth.ts'
import { resolveRuntimeModelConfigByAgentId } from '../agent/runtime-model.ts'

export type DailyMemoryItem = {
  text: string
}

export type CuratedMemorySection = 'Profile' | 'Schedule' | 'Preferences' | 'Relationships' | 'Projects' | 'Notes'

export type CuratedMemoryUpdate = {
  section: CuratedMemorySection
  key: string
  value: string
}

export interface MemoryExtractionResult {
  dailyMemories: DailyMemoryItem[]
  curatedUpdates: CuratedMemoryUpdate[]
}

export interface MemoryExtractionRunner {
  extractTurnMemory(params: {
    agentId: string
    chatId: string
    currentMemory: string
    currentDailyMemory: string
    userMessage: string
    assistantReply: string
  }): Promise<MemoryExtractionResult>
}

const MEMORY_EXTRACTION_SYSTEM_PROMPT = [
  'Extract durable memory for an AI assistant.',
  'Return JSON only.',
  'You should produce two outputs:',
  '1. dailyMemories: short factual notes suitable for memory/YYYY-MM-DD.md',
  '2. curatedUpdates: stable facts suitable for MEMORY.md',
  'Good candidates: identity, occupation, timezone, recurring schedule, stable preferences, important relationships, durable project context.',
  'Bad candidates: greetings, temporary tasks, one-off requests, jokes, speculation, assistant capabilities, framework names, workspace paths.',
  'Schema: {"dailyMemories":[{"text":"The user is a programmer."}],"curatedUpdates":[{"section":"Profile","key":"occupation","value":"程序员"}]}',
  'Allowed curated sections: Profile, Schedule, Preferences, Relationships, Projects, Notes.',
  'Use concise English snake_case keys for curated updates.',
].join(' ')

function trimForPrompt(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars)
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function parseJsonPayload(raw: string): MemoryExtractionResult {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  const jsonText = start >= 0 && end >= start ? candidate.slice(start, end + 1) : candidate
  const parsed = JSON.parse(jsonText) as {
    dailyMemories?: Array<Record<string, unknown>>
    curatedUpdates?: Array<Record<string, unknown>>
  }

  const dailyMemories = Array.isArray(parsed.dailyMemories)
    ? parsed.dailyMemories.flatMap((item) => {
        const text = typeof item.text === 'string' ? item.text.trim() : ''
        return text ? [{ text }] : []
      })
    : []

  const curatedUpdates = Array.isArray(parsed.curatedUpdates)
    ? parsed.curatedUpdates.flatMap((item) => {
        const section = typeof item.section === 'string' ? item.section.trim() as CuratedMemorySection : null
        const key = typeof item.key === 'string' ? item.key.trim() : ''
        const value = typeof item.value === 'string' ? item.value.trim() : ''
        if (!section || !key || !value) return []
        return [{ section, key, value }]
      })
    : []

  return {
    dailyMemories,
    curatedUpdates,
  }
}

export class MemoryExtractor implements MemoryExtractionRunner {
  async extractTurnMemory(params: {
    agentId: string
    chatId: string
    currentMemory: string
    currentDailyMemory: string
    userMessage: string
    assistantReply: string
  }): Promise<MemoryExtractionResult> {
    const logger = getLogger()
    const resolvedModel = resolveRuntimeModelConfigByAgentId(params.agentId)
    const modelConfig = resolvedModel.config
    if (!modelConfig) {
      logger.warn({ agentId: params.agentId }, 'Skipping memory extraction: no active model config')
      return { dailyMemories: [], curatedUpdates: [] }
    }

    const model = resolvePiModel(modelConfig)
    if (modelConfig.provider === 'builtin') {
      const authToken = getAuthToken()
      if (authToken) {
        model.headers = { ...model.headers, rdxtoken: authToken }
      }
    }

    const context: Context = {
      systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          'Current MEMORY.md:',
          trimForPrompt(params.currentMemory || '(empty)', 6000),
          '',
          'Today daily memory note:',
          trimForPrompt(params.currentDailyMemory || '(empty)', 4000),
          '',
          'Latest user message:',
          trimForPrompt(params.userMessage, 2000),
          '',
          'Assistant reply for context:',
          trimForPrompt(params.assistantReply, 2000),
          '',
          'Extract durable memory.',
        ].join('\n'),
        timestamp: Date.now(),
      }],
    }

    try {
      const response = await complete(model, context, {
        apiKey: modelConfig.apiKey,
        headers: model.headers,
        temperature: 0,
        maxTokens: 700,
      })
      const text = extractText(response)
      return parseJsonPayload(text)
    } catch (error) {
      logger.error({
        agentId: params.agentId,
        chatId: params.chatId,
        error: error instanceof Error ? error.message : String(error),
      }, 'Memory extraction failed')
      return { dailyMemories: [], curatedUpdates: [] }
    }
  }
}
