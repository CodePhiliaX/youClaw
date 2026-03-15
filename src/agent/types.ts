import type { AgentRuntime } from './runtime.ts'
import type { AgentConfig as SchemaAgentConfig } from './schema.ts'

// Extend schema config with runtime fields
export interface AgentConfig extends SchemaAgentConfig {
  workspaceDir: string
}

export interface AgentState {
  sessionId: string | null
  isProcessing: boolean
  lastProcessedAt: string | null
  totalProcessed: number
  lastError: string | null
  queueDepth: number
}

export interface ProcessParams {
  chatId: string
  prompt: string
  agentId: string
  requestedSkills?: string[]
  browserProfileId?: string
  attachments?: Array<{ filename: string; mediaType: string; data: string; size: number }>
}

export interface AgentInstance {
  config: AgentConfig
  workspaceDir: string
  runtime: AgentRuntime
  state: AgentState
}

// Backward-compatible alias
export type ManagedAgent = AgentInstance
