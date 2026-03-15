import { getLogger } from '../logger/index.ts'
import type { McpServerConfig } from './schema.ts'

/**
 * Resolve environment variable references in MCP server config (${VAR} -> process.env.VAR)
 * Also supports ${SECRET:key} format (pre-processed by SecretsManager)
 */
export function resolveMcpServers(
  servers: Record<string, McpServerConfig>,
  extraEnv?: Record<string, string>,
): Record<string, McpServerConfig> {
  const logger = getLogger()
  const resolved: Record<string, McpServerConfig> = {}

  for (const [name, server] of Object.entries(servers)) {
    if (!server.env) {
      resolved[name] = server
      continue
    }

    const resolvedEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(server.env)) {
      const resolvedValue = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
        // Look up in extraEnv first (injected by SecretsManager)
        if (extraEnv && varName in extraEnv) {
          return extraEnv[varName]!
        }
        const envVal = process.env[varName]
        if (!envVal) {
          logger.warn({ mcpServer: name, envVar: varName }, 'Required env var for MCP server is undefined, skipping')
        }
        return envVal ?? ''
      })
      // Skip empty resolved env vars to prevent MCP process crashes from empty strings
      if (resolvedValue) {
        resolvedEnv[key] = resolvedValue
      }
    }
    resolved[name] = { ...server, env: resolvedEnv }
  }

  return resolved
}
