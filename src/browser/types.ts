export type BrowserDriver = 'managed' | 'remote-cdp' | 'extension-relay'

export type BrowserRuntimeStatus = 'starting' | 'running' | 'stopped' | 'error'

export const DEFAULT_BROWSER_PROFILE_ID = 'openclaw'
export const DEFAULT_BROWSER_PROFILE_NAME = 'OpenClaw'
export const DEFAULT_CDP_PORT_START = 18800
export const DEFAULT_CDP_PORT_END = 18899

export interface BrowserProfileRecord {
  id: string
  name: string
  driver: BrowserDriver
  is_default: number
  executable_path: string | null
  user_data_dir: string | null
  cdp_port: number | null
  cdp_url: string | null
  headless: number
  no_sandbox: number
  attach_only: number
  launch_args_json: string | null
  created_at: string
  updated_at: string | null
}

export interface BrowserProfileRuntimeRecord {
  profile_id: string
  status: BrowserRuntimeStatus
  pid: number | null
  ws_endpoint: string | null
  last_error: string | null
  last_started_at: string | null
  heartbeat_at: string | null
}

export interface ChatBrowserStateRecord {
  chat_id: string
  agent_id: string
  profile_id: string
  active_target_id: string | null
  active_page_url: string | null
  active_page_title: string | null
  updated_at: string
}

export interface BrowserProfileRuntime {
  status: BrowserRuntimeStatus
  pid: number | null
  wsEndpoint: string | null
  lastError: string | null
  lastStartedAt: string | null
  heartbeatAt: string | null
}

export interface BrowserProfile {
  id: string
  name: string
  driver: BrowserDriver
  isDefault: boolean
  executablePath: string | null
  userDataDir: string | null
  cdpPort: number | null
  cdpUrl: string | null
  headless: boolean
  noSandbox: boolean
  attachOnly: boolean
  launchArgs: string[]
  createdAt: string
  updatedAt: string | null
  runtime: BrowserProfileRuntime | null
}

export interface ChatBrowserState {
  chatId: string
  agentId: string
  profileId: string
  activeTargetId: string | null
  activePageUrl: string | null
  activePageTitle: string | null
  updatedAt: string
}

export interface CreateBrowserProfileInput {
  id?: string
  name: string
  driver?: BrowserDriver
  executablePath?: string | null
  userDataDir?: string | null
  cdpPort?: number | null
  cdpUrl?: string | null
  headless?: boolean
  noSandbox?: boolean
  attachOnly?: boolean
  launchArgs?: string[]
  isDefault?: boolean
}

export interface UpdateBrowserProfileInput {
  name?: string
  driver?: BrowserDriver
  executablePath?: string | null
  userDataDir?: string | null
  cdpPort?: number | null
  cdpUrl?: string | null
  headless?: boolean
  noSandbox?: boolean
  attachOnly?: boolean
  launchArgs?: string[]
  isDefault?: boolean
}

export interface BrowserProfileRuntimePatch {
  status?: BrowserRuntimeStatus
  pid?: number | null
  wsEndpoint?: string | null
  lastError?: string | null
  lastStartedAt?: string | null
  heartbeatAt?: string | null
}

export interface ChatBrowserStatePatch {
  agentId?: string
  profileId?: string
  activeTargetId?: string | null
  activePageUrl?: string | null
  activePageTitle?: string | null
}
