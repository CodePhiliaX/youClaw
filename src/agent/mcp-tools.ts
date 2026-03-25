import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import type { McpServerConfig } from './schema.ts'
import { getLogger } from '../logger/index.ts'

type McpToolRuntime = {
  tools: ToolDefinition[]
  dispose: () => Promise<void>
}

type McpSession = {
  serverName: string
  client: Client
  transport: StdioClientTransport
  detachStderr?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function listAllTools(client: Client) {
  const tools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

function toAgentToolResult(params: {
  serverName: string
  toolName: string
  result: CallToolResult
}): AgentToolResult<unknown> {
  const content = Array.isArray(params.result.content)
    ? (params.result.content as AgentToolResult<unknown>['content'])
    : []

  return {
    content: content.length > 0
      ? content
      : [{
          type: 'text',
          text: params.result.structuredContent !== undefined
            ? JSON.stringify(params.result.structuredContent, null, 2)
            : JSON.stringify({
                status: params.result.isError === true ? 'error' : 'ok',
                server: params.serverName,
                tool: params.toolName,
              }, null, 2),
        }],
    details: {
      mcpServer: params.serverName,
      mcpTool: params.toolName,
      structuredContent: params.result.structuredContent,
      status: params.result.isError === true ? 'error' : 'ok',
    },
  }
}

async function disposeSession(session: McpSession): Promise<void> {
  session.detachStderr?.()
  await session.client.close().catch(() => {})
  await session.transport.close().catch(() => {})
}

function attachStderrLogging(serverName: string, transport: StdioClientTransport): (() => void) | undefined {
  const stderr = transport.stderr
  if (!stderr || typeof stderr.on !== 'function') {
    return undefined
  }

  const logger = getLogger()
  const onData = (chunk: Buffer | string) => {
    const message = String(chunk).trim()
    if (!message) return
    for (const line of message.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) {
        logger.debug({ serverName, line: trimmed }, 'MCP stderr')
      }
    }
  }

  stderr.on('data', onData)
  return () => {
    if (typeof stderr.off === 'function') {
      stderr.off('data', onData)
    } else if (typeof stderr.removeListener === 'function') {
      stderr.removeListener('data', onData)
    }
  }
}

export async function createExternalMcpToolRuntime(params: {
  servers?: Record<string, McpServerConfig>
  reservedToolNames?: Iterable<string>
}): Promise<McpToolRuntime> {
  const logger = getLogger()
  const servers = params.servers ?? {}
  if (Object.keys(servers).length === 0) {
    return { tools: [], dispose: async () => {} }
  }

  const reservedNames = new Set(
    Array.from(params.reservedToolNames ?? [], (name) => name.trim().toLowerCase()).filter(Boolean),
  )
  const sessions: McpSession[] = []
  const tools: ToolDefinition[] = []

  try {
    for (const [serverName, server] of Object.entries(servers)) {
      if (server.url) {
        logger.warn({ serverName, url: server.url }, 'Remote MCP servers are not supported yet, skipping')
        continue
      }

      if (!server.command?.trim()) {
        logger.warn({ serverName }, 'MCP server missing command, skipping')
        continue
      }

      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.workingDirectory ?? server.cwd,
        stderr: 'pipe',
      })
      const client = new Client(
        { name: 'youclaw-mcp', version: '0.0.0' },
        {},
      )
      const session: McpSession = {
        serverName,
        client,
        transport,
        detachStderr: attachStderrLogging(serverName, transport),
      }

      try {
        await client.connect(transport)
        const listedTools = await listAllTools(client)
        sessions.push(session)

        for (const tool of listedTools) {
          const normalizedName = tool.name.trim().toLowerCase()
          if (!normalizedName) continue

          if (reservedNames.has(normalizedName)) {
            logger.warn({ serverName, toolName: tool.name }, 'Skipping MCP tool due to name conflict')
            continue
          }

          reservedNames.add(normalizedName)
          tools.push({
            name: tool.name,
            label: tool.title ?? tool.name,
            description: tool.description?.trim() || `MCP tool from "${serverName}"`,
            parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as any,
            async execute(_toolCallId, input) {
              const result = await client.callTool({
                name: tool.name,
                arguments: isRecord(input) ? input : {},
              }) as CallToolResult
              return toAgentToolResult({
                serverName,
                toolName: tool.name,
                result,
              })
            },
          })
        }
      } catch (error) {
        logger.warn({
          serverName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to start MCP server')
        await disposeSession(session)
      }
    }

    return {
      tools,
      dispose: async () => {
        await Promise.allSettled(sessions.map((session) => disposeSession(session)))
      },
    }
  } catch (error) {
    await Promise.allSettled(sessions.map((session) => disposeSession(session)))
    throw error
  }
}
