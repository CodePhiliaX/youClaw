import { z } from 'zod/v4'

// MCP 服务器配置 schema
export const McpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

// 子 Agent 定义 schema
export const AgentDefinitionSchema = z.object({
  description: z.string(),
  prompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  maxTurns: z.number().optional(),
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
  memory: z.object({
    enabled: z.boolean().default(false),
  }).optional(),
  skills: z.array(z.string()).optional(),
  maxConcurrency: z.number().default(1),
  // Phase 3: 多 Agent 协作
  agents: z.record(z.string(), AgentDefinitionSchema).optional(),
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
