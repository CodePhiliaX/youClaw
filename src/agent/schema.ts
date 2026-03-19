import { z } from 'zod/v4'

// MCP server config schema
export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

// Sub-agent inline definition schema
export const AgentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  maxTurns: z.number().optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
})

// Sub-agent ref schema (references a top-level agent)
export const AgentRefSchema = z.object({
  ref: z.string(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  model: z.string().optional(),
  maxTurns: z.number().optional(),
})

// Union type: with ref -> reference; without ref -> inline
export const AgentEntrySchema = z.union([AgentRefSchema, AgentDefinitionSchema])

// Binding condition schema
const BindingConditionSchema = z.object({
  isGroup: z.boolean().optional(),
  trigger: z.string().optional(),
  sender: z.string().optional(),
}).optional()

// Binding config schema
export const BindingSchema = z.object({
  channel: z.string(),
  chatIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  condition: BindingConditionSchema,
  priority: z.number().default(0),
})

// Hook entry schema
export const HookEntrySchema = z.object({
  script: z.string(),
  tools: z.array(z.string()).optional(),
  priority: z.number().default(0),
})

// Hooks config schema
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

// Security policy config schema
export const SecurityConfigSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  fileAccess: z.object({
    allowedPaths: z.array(z.string()).optional(),
    deniedPaths: z.array(z.string()).optional(),
  }).optional(),
})

// Agent config schema
export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().default('minimax/MiniMax-M2.7-highspeed'),
  trigger: z.string().optional(),
  requiresTrigger: z.boolean().optional(),
  telegram: z.object({
    chatIds: z.array(z.string()).optional(),
  }).optional(),
  // Memory config (enhanced)
  memory: z.object({
    enabled: z.boolean().default(false),
    recentDays: z.number().default(3),
    maxContextChars: z.number().default(10000),
    archiveConversations: z.boolean().default(true),
    maxLogEntryLength: z.number().default(500),
  }).optional(),
  skills: z.array(z.string()).optional(),
  maxConcurrency: z.number().default(1),
  // Sub-agent config (supports ref references and inline definitions)
  agents: z.record(z.string(), AgentEntrySchema).optional(),
  // Phase 4: Agent capability enhancements
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  maxTurns: z.number().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  browserProfile: z.string().optional(),
  browserHeaded: z.boolean().default(false),
  // Bindings routing
  bindings: z.array(BindingSchema).optional(),
  // Hooks system
  hooks: HooksConfigSchema.optional(),
  // Security policy
  security: SecurityConfigSchema.optional(),
})

// Infer types from schema
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type McpServerConfig = z.infer<typeof McpServerSchema>
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentRef = z.infer<typeof AgentRefSchema>
export type AgentEntry = z.infer<typeof AgentEntrySchema>
export type Binding = z.infer<typeof BindingSchema>
export type BindingCondition = z.infer<typeof BindingConditionSchema>
export type HooksConfig = z.infer<typeof HooksConfigSchema>
export type HookEntry = z.infer<typeof HookEntrySchema>
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
