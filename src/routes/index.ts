import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { health } from './health.ts'
import { createAgentsRoutes } from './agents.ts'
import { createMessagesRoutes } from './messages.ts'
import { createStreamRoutes } from './stream.ts'
import { createSkillsRoutes } from './skills.ts'
import { createMemoryRoutes } from './memory.ts'
import { createTasksRoutes } from './tasks.ts'
import { createSystemRoutes } from './system.ts'
import { createBrowserProfilesRoutes } from './browser-profiles.ts'
import { createLogsRoutes } from './logs.ts'
import { createChannelsRoutes } from './channels.ts'
import { createRegistryRoutes } from './registry.ts'
import { createWebhooksRoutes } from './webhooks.ts'
import type { AgentManager, AgentQueue } from '../agent/index.ts'
import type { EventBus } from '../events/index.ts'
import type { MessageRouter, ChannelManager } from '../channel/index.ts'
import type { SkillsLoader } from '../skills/index.ts'
import type { RegistryManager } from '../skills/index.ts'
import type { MemoryManager } from '../memory/index.ts'
import type { MemoryIndexer } from '../memory/index.ts'
import type { Scheduler } from '../scheduler/index.ts'

interface AppDeps {
  agentManager: AgentManager
  agentQueue: AgentQueue
  eventBus: EventBus
  router: MessageRouter
  channelManager: ChannelManager
  skillsLoader: SkillsLoader
  registryManager: RegistryManager
  memoryManager: MemoryManager
  memoryIndexer: MemoryIndexer | null
  scheduler: Scheduler
}

export function createApp(deps: AppDeps) {
  const { agentManager, agentQueue, eventBus, router, channelManager, skillsLoader, registryManager, memoryManager, memoryIndexer, scheduler } = deps
  const app = new Hono()

  // CORS — 允许 Vite dev server + Tauri WebView
  app.use('/*', cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'tauri://localhost',        // macOS Tauri WebView
      'http://tauri.localhost',   // Windows Tauri WebView
      'https://tauri.localhost',  // Linux Tauri WebView
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type'],
  }))

  // 挂载路由
  app.route('/api', health)
  app.route('/api', createAgentsRoutes(agentManager))
  app.route('/api', createMessagesRoutes(agentManager, agentQueue, router))
  app.route('/api', createStreamRoutes(eventBus))
  app.route('/api', createSkillsRoutes(skillsLoader, agentManager))
  app.route('/api', createMemoryRoutes(memoryManager, agentManager, memoryIndexer))
  app.route('/api', createTasksRoutes(scheduler, agentManager, agentQueue))
  app.route('/api', createSystemRoutes(agentManager, eventBus, router))
  app.route('/api', createChannelsRoutes(channelManager))
  app.route('/api', createBrowserProfilesRoutes())
  app.route('/api', createRegistryRoutes(registryManager))
  app.route('/api', createLogsRoutes())
  app.route('/api', createWebhooksRoutes(channelManager))

  return app
}
