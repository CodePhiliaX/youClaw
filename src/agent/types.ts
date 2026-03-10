import type { AgentRuntime } from './runtime.ts'
import type { AgentConfig as SchemaAgentConfig } from './schema.ts'

// 扩展 schema 配置，添加运行时字段
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
}

export interface AgentInstance {
  config: AgentConfig
  workspaceDir: string
  runtime: AgentRuntime
  state: AgentState
}

// 向后兼容别名
export type ManagedAgent = AgentInstance
