import { getLogger } from '../logger/index.ts'
import type { McpServerConfig } from './schema.ts'

/**
 * SecretsManager: Agent-level secrets management
 *
 * Naming convention: YOUCLAW_SECRET_<AGENTID>_<KEY>
 * Referenced in agent.yaml via ${SECRET:key}
 *
 * Example:
 * .env:
 *   YOUCLAW_SECRET_MYAGENT_API_TOKEN=sk-xxx
 *
 * agent.yaml:
 *   mcpServers:
 *     my-server:
 *       env:
 *         TOKEN: "${SECRET:api_token}"
 */
export class SecretsManager {
  // agentId -> key -> value
  private secrets: Map<string, Map<string, string>> = new Map()

  /**
   * Load per-agent isolated secrets from process.env
   */
  loadFromEnv(): void {
    const logger = getLogger()
    const prefix = 'YOUCLAW_SECRET_'
    let count = 0

    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith(prefix) || !value) continue

      // YOUCLAW_SECRET_<AGENTID>_<KEY>
      const rest = key.slice(prefix.length)
      const firstUnderscore = rest.indexOf('_')

      if (firstUnderscore === -1) {
        logger.warn({ key }, 'Invalid secret naming format, expected YOUCLAW_SECRET_<AGENTID>_<KEY>')
        continue
      }

      const agentId = rest.slice(0, firstUnderscore).toLowerCase()
      const secretKey = rest.slice(firstUnderscore + 1).toLowerCase()

      if (!this.secrets.has(agentId)) {
        this.secrets.set(agentId, new Map())
      }
      this.secrets.get(agentId)!.set(secretKey, value)
      count++
    }

    if (count > 0) {
      logger.info({ count }, 'Agent secrets loaded')
    }
  }

  /**
   * Resolve ${SECRET:key} references in string templates
   */
  resolve(agentId: string, template: string): string {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets) return template

    return template.replace(/\$\{SECRET:(\w+)\}/g, (_, key: string) => {
      const value = agentSecrets.get(key.toLowerCase())
      if (!value) {
        getLogger().warn({ agentId, secretKey: key }, 'Secret not found')
        return ''
      }
      return value
    })
  }

  /**
   * Inject secrets into MCP server env
   * Pre-process ${SECRET:key} references and return resolved server configs
   */
  injectToMcpEnv(agentId: string, servers: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets || agentSecrets.size === 0) return servers

    const result: Record<string, McpServerConfig> = {}
    for (const [name, server] of Object.entries(servers)) {
      if (!server.env) {
        result[name] = server
        continue
      }

      const resolvedEnv: Record<string, string> = {}
      for (const [key, value] of Object.entries(server.env)) {
        resolvedEnv[key] = this.resolve(agentId, value)
      }
      result[name] = { ...server, env: resolvedEnv }
    }

    return result
  }

  /**
   * Get secret key names for a given agent (returns keys only, not values)
   */
  getSecretKeys(agentId: string): string[] {
    const agentSecrets = this.secrets.get(agentId)
    if (!agentSecrets) return []
    return Array.from(agentSecrets.keys())
  }
}
