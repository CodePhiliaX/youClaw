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

// Binding 条件 schema
const BindingConditionSchema = z.object({
  isGroup: z.boolean().optional(),
  trigger: z.string().optional(),
  sender: z.string().optional(),
}).optional()

// Binding schema
export const BindingSchema = z.object({
  channel: z.string(),
  chatIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  condition: BindingConditionSchema,
  priority: z.number().default(0),
})

// Hook 入口 schema
export const HookEntrySchema = z.object({
  script: z.string(),
  tools: z.array(z.string()).optional(),
  priority: z.number().default(0),
})

// Hooks 配置 schema
export const HooksConfigSchema = z.object({
  pre_process: z.array(HookEntrySchema).optional(),
  post_process: z.array(HookEntrySchema).optional(),
  pre_tool_use: z.array(HookEntrySchema).optional(),
  post_tool_use: z.array(HookEntrySchema).optional(),
  pre_compact: z.array(HookEntrySchema).optional(),
  on_error: z.array(HookEntrySchema).optional(),
  on_session_start: z.array(HookEntrySchema).optional(),
  on_session_end: z.array(HookEntrySchema).optional(),
})

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
  // Memory 配置（增强版）
  memory: z.object({
    enabled: z.boolean().default(false),
    recentDays: z.number().default(3),
    maxContextChars: z.number().default(10000),
    archiveConversations: z.boolean().default(false),
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
  // Bindings 路由
  bindings: z.array(BindingSchema).optional(),
  // Hooks 系统
  hooks: HooksConfigSchema.optional(),
})

// 从 schema 推导类型
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type McpServerConfig = z.infer<typeof McpServerSchema>
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentRef = z.infer<typeof AgentRefSchema>
export type AgentEntry = z.infer<typeof AgentEntrySchema>
export type Binding = z.infer<typeof BindingSchema>
export type BindingCondition = z.infer<typeof BindingConditionSchema>
export type HooksConfig = z.infer<typeof HooksConfigSchema>
export type HookEntry = z.infer<typeof HookEntrySchema>
