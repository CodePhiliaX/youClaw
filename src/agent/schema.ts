import { z } from 'zod/v4'

// MCP 服务器配置 schema
export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

// 子 Agent 内联定义 schema
export const AgentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  maxTurns: z.number().optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
})

// 子 Agent ref 引用 schema（引用顶层 agent）
export const AgentRefSchema = z.object({
  ref: z.string(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  maxTurns: z.number().optional(),
})

// 联合类型：有 ref → 引用；无 ref → 内联
export const AgentEntrySchema = z.union([AgentRefSchema, AgentDefinitionSchema])

// Agent 配置 schema
export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().default('claude-sonnet-4-6'),
  trigger: z.string().optional(),
  requiresTrigger: z.boolean().optional(),
  telegram: z.object({
    chatIds: z.array(z.string()).optional(),
  }).optional(),
  memory: z.object({
    enabled: z.boolean().default(false),
  }).optional(),
  skills: z.array(z.string()).optional(),
  maxConcurrency: z.number().default(1),
  // 子 Agent 配置（支持 ref 引用和内联定义）
  agents: z.record(z.string(), AgentEntrySchema).optional(),
  // Phase 4: Agent 能力增强
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  maxTurns: z.number().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
})

// 从 schema 推导类型
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type McpServerConfig = z.infer<typeof McpServerSchema>
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentRef = z.infer<typeof AgentRefSchema>
export type AgentEntry = z.infer<typeof AgentEntrySchema>
