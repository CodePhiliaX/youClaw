import type { AgentManager } from '../agent/index.ts'
import { BrowserManager, createBrowserRoutes } from '../browser/index.ts'

export function createBrowserProfilesRoutes(agentManager?: AgentManager, browserManager?: BrowserManager) {
  return createBrowserRoutes(browserManager ?? new BrowserManager(agentManager), agentManager)
}
