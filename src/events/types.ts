// Agent event types
export type AgentEvent =
  | { type: 'stream'; agentId: string; chatId: string; text: string }
  | { type: 'tool_use'; agentId: string; chatId: string; tool: string; input?: string }
  | { type: 'complete'; agentId: string; chatId: string; fullText: string; sessionId: string }
  | { type: 'error'; agentId: string; chatId: string; error: string }
  | { type: 'processing'; agentId: string; chatId: string; isProcessing: boolean }
  // Phase 3: Sub-agent events
  | { type: 'subagent_started'; agentId: string; chatId: string; taskId: string; description: string }
  | { type: 'subagent_progress'; agentId: string; chatId: string; taskId: string; summary?: string }
  | { type: 'subagent_completed'; agentId: string; chatId: string; taskId: string; status: string; summary: string }
  // Memory events
  | { type: 'memory_updated'; agentId: string; filePath: string }
  | { type: 'conversation_archived'; agentId: string; filename: string }

export type AgentEventType = AgentEvent['type']

export type EventFilter = {
  chatId?: string
  agentId?: string
  types?: AgentEventType[]
}

export type EventHandler = (event: AgentEvent) => void
export type Unsubscribe = () => void
