import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getPaths } from '../config/index.ts'
import { getLogger } from '../logger/index.ts'
import { AgentConfigSchema } from './schema.ts'
import { resolveMcpServers } from './mcp-utils.ts'
import type { PromptBuilder } from './prompt-builder.ts'
import type { AgentEntry, AgentRef, AgentDefinition } from './schema.ts'

// SDK-expected sub-agent definition format
interface SDKAgentDefinition {
  description: string
  prompt?: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  mcpServers?: Record<string, unknown>
}

/**
 * AgentCompiler: compiles ref references in agent.yaml into flat SDK AgentDefinitions
 *
 * Supports two sub-agent definition methods:
 * 1. Inline definition (original): directly specify description + prompt + tools
 * 2. Ref reference (new): reference a top-level agent's full config via the ref field
 */
export class AgentCompiler {
  constructor(private promptBuilder: PromptBuilder) {}

  /**
   * Resolve all entries in the agents field, compile to SDK AgentDefinition
   */
  resolve(
    agents: Record<string, AgentEntry>,
    parentAgentId: string,
  ): Record<string, SDKAgentDefinition> {
    const result: Record<string, SDKAgentDefinition> = {}
    const resolving = new Set<string>([parentAgentId])

    for (const [name, entry] of Object.entries(agents)) {
      if (this.isRefEntry(entry)) {
        result[name] = this.compileRef(entry as AgentRef, resolving)
      } else {
        // Inline definition, pass through directly
        result[name] = entry as SDKAgentDefinition
      }
    }

    return result
  }

  /**
   * Check whether an entry is a ref reference
   */
  private isRefEntry(entry: AgentEntry): entry is AgentRef {
    return 'ref' in entry && typeof (entry as AgentRef).ref === 'string'
  }

  /**
   * Compile a single ref reference into an SDK AgentDefinition
   */
  private compileRef(ref: AgentRef, resolving: Set<string>): SDKAgentDefinition {
    const logger = getLogger()
    const targetId = ref.ref

    // Circular reference detection
    if (resolving.has(targetId)) {
      const chain = [...resolving, targetId].join(' → ')
      throw new Error(`Circular reference detected: ${chain}`)
    }
    resolving.add(targetId)

    try {
      // Load target agent.yaml
      const paths = getPaths()
      const agentDir = resolve(paths.agents, targetId)
      const configPath = resolve(agentDir, 'agent.yaml')

      if (!existsSync(configPath)) {
        throw new Error(`Referenced agent "${targetId}" does not exist: ${configPath}`)
      }

      const rawYaml = readFileSync(configPath, 'utf-8')
      const parsed = parseYaml(rawYaml) as Record<string, unknown>

      const result = AgentConfigSchema.safeParse({
        ...parsed,
        id: parsed.id ?? targetId,
        name: parsed.name ?? targetId,
      })

      if (!result.success) {
        throw new Error(`Referenced agent "${targetId}" config validation failed: ${JSON.stringify(result.error.issues)}`)
      }

      const targetConfig = result.data

      // Build prompt using PromptBuilder
      const systemPrompt = this.promptBuilder.build(agentDir, {
        ...targetConfig,
        workspaceDir: agentDir,
      })

      // Build SDK AgentDefinition
      const definition: SDKAgentDefinition = {
        description: ref.description ?? targetConfig.name,
      }

      // Compile prompt: target agent full system prompt + ref appended prompt
      let finalPrompt = systemPrompt
      if (ref.prompt) {
        finalPrompt += '\n\n' + ref.prompt
      }
      if (finalPrompt) {
        definition.prompt = finalPrompt
      }

      // Tool config: ref overrides > target config
      if (ref.tools) {
        definition.tools = ref.tools
      } else if (targetConfig.allowedTools) {
        definition.tools = targetConfig.allowedTools
      }

      if (ref.disallowedTools) {
        definition.disallowedTools = ref.disallowedTools
      } else if (targetConfig.disallowedTools) {
        definition.disallowedTools = targetConfig.disallowedTools
      }

      // model: ref overrides > target config
      if (ref.model) {
        definition.model = ref.model
      } else if (targetConfig.model) {
        definition.model = targetConfig.model
      }

      // maxTurns: ref overrides > target config
      if (ref.maxTurns) {
        definition.maxTurns = ref.maxTurns
      } else if (targetConfig.maxTurns) {
        definition.maxTurns = targetConfig.maxTurns
      }

      // MCP servers
      if (targetConfig.mcpServers) {
        definition.mcpServers = resolveMcpServers(targetConfig.mcpServers)
      }

      // Recursively resolve target agent sub-agents
      if (targetConfig.agents) {
        const nestedAgents = this.resolve(targetConfig.agents, targetId)
        // SDK does not support nested agents definitions, log only
        if (Object.keys(nestedAgents).length > 0) {
          logger.debug({ targetId, nestedCount: Object.keys(nestedAgents).length }, 'Referenced agent contains sub-agents (nested ignored)')
        }
      }

      logger.info({ targetId, hasPrompt: !!definition.prompt, hasTools: !!definition.tools }, 'Ref reference compiled')
      return definition
    } finally {
      resolving.delete(targetId)
    }
  }
}
