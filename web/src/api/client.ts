import { getBackendBaseUrl } from './transport'
import type { Attachment } from '../types/attachment'

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await getBackendBaseUrl()
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `API error: ${res.status}`)
  }
  return res.json() as Promise<T>
}

// Check git availability
export async function checkGit() {
  return apiFetch<{ available: boolean; path: string | null }>('/api/git-check')
}

// Environment dependency status
export interface DependencyStatus {
  name: string
  available: boolean
  path: string | null
  version: string | null
  required: boolean
}

export interface EnvCheckResult {
  platform: string
  dependencies: DependencyStatus[]
}

// Check environment dependencies
export async function checkEnv(): Promise<EnvCheckResult> {
  return apiFetch<EnvCheckResult>('/api/env-check')
}

// Install a missing tool (one-click install)
export async function installTool(tool: string): Promise<{
  ok: boolean; stdout: string; stderr: string; exitCode: number
}> {
  return apiFetch<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>(
    '/api/install-tool',
    { method: 'POST', body: JSON.stringify({ tool }) }
  )
}

// Send message to agent
export async function sendMessage(
  agentId: string,
  prompt: string,
  chatId?: string,
  browserProfileId?: string | null,
  attachments?: Attachment[],
  messageId?: string,
) {
  return apiFetch<{ chatId: string; status: string }>(`/api/agents/${agentId}/message`, {
    method: 'POST',
    body: JSON.stringify({ prompt, chatId, browserProfileId, attachments, messageId }),
  })
}

export async function uploadChatAttachment(file: File, filename?: string, mediaType?: string) {
  const base = await getBackendBaseUrl()
  const formData = new FormData()
  formData.append('file', file, filename || file.name || 'attachment')
  if (filename) {
    formData.append('filename', filename)
  }
  if (mediaType) {
    formData.append('mediaType', mediaType)
  }

  const res = await fetch(`${base}/api/attachments/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `Upload failed: ${res.status}`)
  }
  return res.json() as Promise<Attachment>
}

// Get chat list
export async function getChats() {
  return apiFetch<Array<{ chat_id: string; name: string; agent_id: string; channel: string; last_message_time: string; last_message: string | null; avatar: string | null }>>('/api/chats')
}

// Get message history
export async function getMessages(chatId: string) {
  return apiFetch<Array<{ id: string; chat_id: string; sender: string; sender_name: string; content: string; timestamp: string; is_from_me: number; is_bot_message: number; attachments: Attachment[] | null }>>(`/api/chats/${encodeURIComponent(chatId)}/messages`)
}

// Abort a running chat query
export async function abortChat(chatId: string) {
  return apiFetch<{ ok: boolean; aborted: boolean }>(`/api/chats/${encodeURIComponent(chatId)}/abort`, {
    method: 'POST',
  })
}

// Delete chat
export async function deleteChat(chatId: string) {
  return apiFetch<{ ok: boolean }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  })
}

// Update chat (avatar/title)
export async function updateChat(chatId: string, data: { name?: string; avatar?: string }) {
  return apiFetch<{ ok: boolean }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// Get agents list
export async function getAgents() {
  return apiFetch<Array<{ id: string; name: string; workspaceDir: string; status: string; hasConfig: boolean }>>('/api/agents')
}

// Get agent workspace docs list and content
export async function getAgentDocs(agentId: string) {
  return apiFetch<Record<string, string>>(`/api/agents/${agentId}/docs`)
}

// Get specific agent doc content
export async function getAgentDoc(agentId: string, filename: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/docs/${encodeURIComponent(filename)}`)
}

// Update specific agent doc
export async function updateAgentDoc(agentId: string, filename: string, content: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/docs/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// Create new agent
export async function createAgent(data: { name: string; model?: string }) {
  return apiFetch<{ id: string; name: string }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// Get full config for a single agent (including sub-agent definitions)
export async function getAgentConfig(agentId: string) {
  return apiFetch<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`)
}

// Update agent config
export async function updateAgentConfig(agentId: string, data: Record<string, unknown>) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// Delete agent
export async function deleteAgent(agentId: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}`, {
    method: 'DELETE',
  })
}

// Memory API

// Get agent MEMORY.md content
export async function getMemory(agentId: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory`)
}

// Update agent MEMORY.md
export async function updateMemory(agentId: string, content: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/memory`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// Get daily log list
export async function getMemoryLogs(agentId: string) {
  return apiFetch<string[]>(`/api/agents/${agentId}/memory/logs`)
}

// Get log content for a specific date
export async function getMemoryLog(agentId: string, date: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/logs/${date}`)
}

// Global Memory
export async function getGlobalMemory() {
  return apiFetch<{ content: string }>('/api/memory/global')
}

export async function updateGlobalMemory(content: string) {
  return apiFetch<{ ok: boolean }>('/api/memory/global', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// Conversation archives
export async function getConversationArchives(agentId: string) {
  return apiFetch<Array<{ filename: string; date: string }>>(`/api/agents/${agentId}/memory/conversations`)
}

export async function getConversationArchive(agentId: string, filename: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/conversations/${encodeURIComponent(filename)}`)
}

// Snapshots
export async function createSnapshot(agentId: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/memory/snapshot`, { method: 'POST' })
}

export async function getSnapshot(agentId: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/snapshot`)
}

// Memory search
export async function searchMemory(query: string, agentId?: string) {
  const params = new URLSearchParams({ q: query })
  if (agentId) params.set('agentId', agentId)
  return apiFetch<Array<{ agentId: string; fileType: string; filePath: string; snippet: string; rank: number }>>(`/api/memory/search?${params}`)
}

// Skills related types
export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  os?: string[]
  dependencies?: string[]
  env?: string[]
  tools?: string[]
  tags?: string[]
  globs?: string[]
  priority?: 'critical' | 'normal' | 'low'
  install?: Record<string, string>
  requires?: string[]
  conflicts?: string[]
  setup?: string
  teardown?: string
  source?: string
}

export interface EligibilityDetail {
  os: { passed: boolean; current: string; required?: string[] }
  dependencies: { passed: boolean; results: Array<{ name: string; found: boolean; path?: string }> }
  env: { passed: boolean; results: Array<{ name: string; found: boolean }> }
}

export const RegistryMarketplaceSource = {
  ClawHub: 'clawhub',
  Tencent: 'tencent',
} as const

export type RegistryMarketplaceSource = typeof RegistryMarketplaceSource[keyof typeof RegistryMarketplaceSource]

export const SkillImportProvider = {
  RawUrl: 'raw-url',
  GitHub: 'github',
} as const

export type SkillImportProvider = typeof SkillImportProvider[keyof typeof SkillImportProvider]

interface SkillRegistryMetaBase {
  slug: string
  installedAt: string
  displayName?: string
  version?: string
}

export interface MarketplaceSkillRegistryMeta extends SkillRegistryMetaBase {
  source: RegistryMarketplaceSource
  homepageUrl?: string
}

export interface RawUrlSkillRegistryMeta extends SkillRegistryMetaBase {
  source: typeof SkillImportProvider.RawUrl
  provider: typeof SkillImportProvider.RawUrl
  sourceUrl: string
}

export interface GitHubSkillRegistryMeta extends SkillRegistryMetaBase {
  source: typeof SkillImportProvider.GitHub
  provider: typeof SkillImportProvider.GitHub
  sourceUrl: string
  homepageUrl?: string
  ref?: string
  path?: string
}

export type SkillRegistryMeta =
  | MarketplaceSkillRegistryMeta
  | RawUrlSkillRegistryMeta
  | GitHubSkillRegistryMeta

export interface Skill {
  name: string
  source: 'workspace' | 'builtin' | 'user'
  catalogGroup: 'builtin' | 'user'
  userSkillKind?: 'external' | 'custom'
  externalSource?: 'marketplace' | 'imported' | 'manual'
  sortTimestamp?: string
  frontmatter: SkillFrontmatter
  content: string
  path: string
  eligible: boolean
  eligibilityErrors: string[]
  eligibilityDetail: EligibilityDetail
  enabled: boolean
  usable: boolean
  registryMeta?: SkillRegistryMeta
}

export interface SkillAuthoringDraft {
  frontmatter: SkillFrontmatter
  content: string
  rawMarkdown: string
}

export interface SkillDraftMeta {
  schemaVersion: number
  updatedAt: string
  basedOnPublishedUpdatedAt?: string
  isValid: boolean
  lastEditorMode: 'form' | 'source'
}

export interface SkillValidationMessage {
  field?: string
  message: string
}

export interface SkillValidationResult {
  normalizedName: string
  errors: SkillValidationMessage[]
  warnings: SkillValidationMessage[]
  generatedMarkdown: string
  draft: SkillAuthoringDraft | null
}

export interface ManagedSkill {
  name: string
  rootDir: string
  entryFile: string
  path: string
  source: 'workspace' | 'builtin' | 'user'
  catalogGroup: 'builtin' | 'user'
  userSkillKind?: 'external' | 'custom'
  externalSource?: 'marketplace' | 'imported' | 'manual'
  sortTimestamp?: string
  editable: boolean
  managed: boolean
  origin: 'user' | 'imported' | 'marketplace' | 'manual' | 'duplicated' | 'builtin'
  createdAt?: string
  updatedAt?: string
  hasPublished: boolean
  hasDraft: boolean
  draftUpdatedAt?: string
  description?: string
  boundAgentIds: string[]
}

export interface ManagedSkillDetail {
  skill: ManagedSkill
  publishedDraft: SkillAuthoringDraft | null
  draft: SkillAuthoringDraft | null
  draftMeta: SkillDraftMeta | null
  bindingStates: Array<{ id: string; name: string; state: 'bound' | 'bound_via_wildcard' | 'unbound' }>
}

// Get all available skills
export async function getSkills() {
  return apiFetch<Skill[]>('/api/skills')
}

// Get skills enabled for an agent
export async function getAgentSkills(agentId: string) {
  return apiFetch<Skill[]>(`/api/agents/${encodeURIComponent(agentId)}/skills`)
}

// Configure skill environment variable
export async function configureSkillEnv(key: string, value: string) {
  return apiFetch<{ ok: boolean }>('/api/skills/configure', {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  })
}

// Install skill dependencies
export async function installSkill(skillName: string, method: string) {
  return apiFetch<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>('/api/skills/install', {
    method: 'POST',
    body: JSON.stringify({ skillName, method }),
  })
}

// Delete skill (user/builtin only, not workspace)
export async function deleteSkill(name: string) {
  return apiFetch<{ ok: boolean }>(`/api/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

// Get agents that reference a specific skill
export async function getSkillAgents(skillName: string) {
  return apiFetch<{ agents: Array<{ id: string; name: string }> }>(
    `/api/skills/${encodeURIComponent(skillName)}/agents`
  )
}

// Enable/disable skill
export async function toggleSkill(name: string, enabled: boolean) {
  return apiFetch<Skill>(`/api/skills/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}

export async function getMySkills() {
  return apiFetch<ManagedSkill[]>('/api/skills/mine')
}

export async function createSkill(data: { name: string; description: string; locale?: 'en' | 'zh' }) {
  return apiFetch<ManagedSkillDetail>('/api/skills', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function getEditableSkill(name: string) {
  return apiFetch<ManagedSkillDetail>(`/api/skills/${encodeURIComponent(name)}/draft`)
}

export async function getSkillDraft(name: string) {
  return apiFetch<ManagedSkillDetail>(`/api/skills/${encodeURIComponent(name)}/draft`)
}

export async function saveSkillDraft(name: string, data: {
  mode: 'form' | 'source'
  draft?: Partial<SkillAuthoringDraft>
  rawMarkdown?: string
}) {
  return apiFetch<ManagedSkillDetail & { validation: SkillValidationResult }>(
    `/api/skills/${encodeURIComponent(name)}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
  )
}

export async function validateSkillDraft(name: string, data: {
  mode: 'form' | 'source'
  draft?: Partial<SkillAuthoringDraft>
  rawMarkdown?: string
}) {
  return apiFetch<SkillValidationResult>(`/api/skills/${encodeURIComponent(name)}/validate`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function publishSkill(name: string, data?: { bindingAgentIds?: string[] }) {
  return apiFetch<ManagedSkillDetail>(`/api/skills/${encodeURIComponent(name)}/publish`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function discardSkillDraft(name: string) {
  return apiFetch<ManagedSkillDetail>(`/api/skills/${encodeURIComponent(name)}/draft`, {
    method: 'DELETE',
  })
}

export async function duplicateSkill(name: string, nextName?: string) {
  return apiFetch<ManagedSkillDetail>(`/api/skills/${encodeURIComponent(name)}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(nextName ? { name: nextName } : {}),
  })
}

export async function deleteManagedSkill(name: string) {
  return apiFetch<{ ok: true; affectedAgents: Array<{ id: string; name: string }> }>(
    `/api/skills/${encodeURIComponent(name)}/manage`,
    { method: 'DELETE' },
  )
}

export async function getSkillBindingStates(name: string) {
  return apiFetch<Array<{ id: string; name: string; state: 'bound' | 'bound_via_wildcard' | 'unbound' }>>(
    `/api/skills/${encodeURIComponent(name)}/agents`,
  )
}

export async function bindSkillToAgent(name: string, agentId: string) {
  return apiFetch<{ ok: true; state: 'bound' | 'bound_via_wildcard' }>(
    `/api/skills/${encodeURIComponent(name)}/bind`,
    {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    },
  )
}

export async function unbindSkillFromAgent(name: string, agentId: string) {
  return apiFetch<{ ok: true }>(`/api/skills/${encodeURIComponent(name)}/unbind`, {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  })
}

export interface ImportProviderInfoDTO {
  id: 'raw-url' | 'github'
  label: string
  description: string
  capabilities: {
    probe: boolean
    singleFile: boolean
    directoryTree: boolean
    auth: 'none' | 'optional' | 'required'
  }
}

export interface ImportProbeResponse {
  provider: 'raw-url' | 'github'
  ok: boolean
  suggestedName?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export async function getImportProviders() {
  return apiFetch<ImportProviderInfoDTO[]>('/api/skills/import/providers')
}

export async function probeRawUrlImport(data: { url: string; targetDir?: string }) {
  return apiFetch<ImportProbeResponse>(
    '/api/skills/import/raw-url/probe',
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
}

export async function importFromRawUrl(data: { url: string; targetDir?: string }) {
  return apiFetch<{ ok: boolean }>('/api/skills/import/raw-url', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function probeGitHubSkillImport(data: { repoUrl: string; path?: string; ref?: string; targetDir?: string }) {
  return apiFetch<ImportProbeResponse>(
    '/api/skills/import/github/probe',
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
}

export async function importFromGitHub(data: { repoUrl: string; path?: string; ref?: string; targetDir?: string }) {
  return apiFetch<{ ok: boolean }>('/api/skills/import/github', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// ===== Skill Marketplace API =====

export type MarketplaceSort =
  | 'updated'
  | 'downloads'
  | 'stars'
  | 'installsCurrent'
  | 'installsAllTime'
  | 'trending'

export type MarketplaceCategory =
  | 'agent'
  | 'memory'
  | 'documents'
  | 'media'
  | 'productivity'
  | 'security'
  | 'integrations'
  | 'data'
  | 'coding'
  | 'other'
  | 'search'
  | 'browser'

export type RegistrySourceId = 'clawhub' | 'tencent' | 'fallback'
export type RegistrySelectableSource = Exclude<RegistrySourceId, 'fallback'>

export interface RegistrySourceInfo {
  id: RegistrySelectableSource
  label: string
  description: string
  capabilities: {
    search: boolean
    list: boolean
    detail: boolean
    download: boolean
    update: boolean
    auth: 'none' | 'optional' | 'required'
    cursorPagination: boolean
    sorts: MarketplaceSort[]
  }
}

export interface MarketplaceSkill {
  slug: string
  displayName: string
  summary: string
  installed: boolean
  installedSkillName?: string
  score?: number
  installSource?: string
  installedVersion?: string
  latestVersion?: string | null
  hasUpdate: boolean
  createdAt?: number | null
  updatedAt?: number | null
  downloads?: number | null
  stars?: number | null
  installsCurrent?: number | null
  installsAllTime?: number | null
  tags: string[]
  category?: MarketplaceCategory
  source: RegistrySourceId
  detailUrl?: string | null
  metadata?: {
    os: string[]
    systems: string[]
  }
  homepageUrl?: string | null
}

export interface MarketplaceSkillDetail extends MarketplaceSkill {
  ownerHandle?: string | null
  ownerDisplayName?: string | null
  ownerImage?: string | null
  moderation?: {
    isSuspicious: boolean
    isMalwareBlocked: boolean
    verdict: string
    summary?: string | null
  } | null
}

export interface MarketplacePage {
  items: MarketplaceSkill[]
  nextCursor: string | null
  source: RegistrySourceId
  query: string
  sort: MarketplaceSort
}

export async function getMarketplaceSkills(params: {
  source?: RegistrySelectableSource
  query?: string
  cursor?: string | null
  limit?: number
  sort?: MarketplaceSort
} = {}) {
  const search = new URLSearchParams()
  if (params.source) search.set('source', params.source)
  if (params.query) search.set('q', params.query)
  if (params.cursor) search.set('cursor', params.cursor)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort) search.set('sort', params.sort)
  const suffix = search.toString() ? `?${search}` : ''
  return apiFetch<MarketplacePage>(`/api/registry/marketplace${suffix}`)
}

export async function getRecommendedSkills() {
  return apiFetch<MarketplaceSkill[]>('/api/registry/recommended')
}

export async function getRegistrySources() {
  return apiFetch<RegistrySourceInfo[]>('/api/registry/sources')
}

export async function getMarketplaceSkill(slug: string, source?: RegistrySelectableSource) {
  const suffix = source ? `?source=${encodeURIComponent(source)}` : ''
  return apiFetch<MarketplaceSkillDetail>(`/api/registry/marketplace/${encodeURIComponent(slug)}${suffix}`)
}

export async function searchRegistrySkills(query: string, source?: RegistrySelectableSource) {
  const search = new URLSearchParams({ q: query })
  if (source) search.set('source', source)
  return apiFetch<MarketplaceSkill[]>(`/api/registry/search?${search.toString()}`)
}

export async function installRecommendedSkill(slug: string, source?: RegistrySelectableSource) {
  return apiFetch<{ ok: boolean; error?: string }>('/api/registry/install', {
    method: 'POST',
    body: JSON.stringify({ slug, source }),
  })
}

export async function updateMarketplaceSkill(slug: string, source?: RegistrySelectableSource) {
  return apiFetch<{ ok: boolean; error?: string }>('/api/registry/update', {
    method: 'POST',
    body: JSON.stringify({ slug, source }),
  })
}

export async function uninstallRecommendedSkill(slug: string, source?: RegistrySelectableSource) {
  return apiFetch<{ ok: boolean; error?: string }>('/api/registry/uninstall', {
    method: 'POST',
    body: JSON.stringify({ slug, source }),
  })
}

// ===== Browser Profile API =====

export interface BrowserProfileDTO {
  id: string
  name: string
  driver: 'managed' | 'remote-cdp' | 'extension-relay'
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
  runtime: {
    status: 'starting' | 'running' | 'stopped' | 'error'
    pid: number | null
    wsEndpoint: string | null
    lastError: string | null
    lastStartedAt: string | null
    heartbeatAt: string | null
  } | null
}

export async function getBrowserProfiles() {
  return apiFetch<BrowserProfileDTO[]>('/api/browser/profiles')
}

export async function createBrowserProfile(input: { name: string; driver?: 'managed' | 'remote-cdp' | 'extension-relay'; cdpUrl?: string | null }) {
  return apiFetch<BrowserProfileDTO>('/api/browser/profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/browser/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function updateBrowserProfile(id: string, patch: Partial<Pick<BrowserProfileDTO, 'name' | 'driver' | 'cdpUrl' | 'headless' | 'noSandbox' | 'attachOnly'>>) {
  return apiFetch<BrowserProfileDTO>(`/api/browser/profiles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function startBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean; runtime: BrowserProfileDTO['runtime'] }>(`/api/browser/profiles/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  })
}

export async function stopBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean; runtime: BrowserProfileDTO['runtime'] }>(`/api/browser/profiles/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
  })
}

export async function restartBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean; runtime: BrowserProfileDTO['runtime'] }>(`/api/browser/profiles/${encodeURIComponent(id)}/restart`, {
    method: 'POST',
  })
}

export async function getBrowserProfileStatus(id: string) {
  return apiFetch<NonNullable<BrowserProfileDTO['runtime']>>(`/api/browser/profiles/${encodeURIComponent(id)}/status`)
}

export async function getBrowserProfileTabs(id: string) {
  return apiFetch<{ tabs: Array<{ id: string; title?: string; url?: string; type?: string }> }>(`/api/browser/profiles/${encodeURIComponent(id)}/tabs`)
}

// ===== Scheduled Tasks API =====

export interface ScheduledTaskDTO {
  id: string
  agent_id: string
  chat_id: string
  prompt: string
  schedule_type: string
  schedule_value: string
  next_run: string | null
  last_run: string | null
  status: string
  created_at: string
  name: string | null
  description: string | null
  running_since: string | null
  consecutive_failures: number
  timezone: string | null
  last_result: string | null
}

export interface TaskRunLogDTO {
  id: number
  task_id: string
  run_at: string
  duration_ms: number
  status: string
  result: string | null
  error: string | null
}

export async function getTaskList() {
  return apiFetch<ScheduledTaskDTO[]>('/api/tasks')
}

export async function createScheduledTask(data: {
  agentId: string
  chatId: string
  prompt: string
  scheduleType: string
  scheduleValue: string
  name?: string
  description?: string
  timezone?: string
}) {
  return apiFetch<ScheduledTaskDTO>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateScheduledTask(id: string, data: Partial<{ prompt: string; scheduleValue: string; scheduleType: string; status: string; name: string; description: string; timezone: string | null }>) {
  return apiFetch<ScheduledTaskDTO>(`/api/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteScheduledTask(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/tasks/${id}`, {
    method: 'DELETE',
  })
}

export async function cloneScheduledTask(id: string) {
  return apiFetch<ScheduledTaskDTO>(`/api/tasks/${id}/clone`, {
    method: 'POST',
  })
}

export async function runScheduledTask(id: string) {
  return apiFetch<{ status: string; result?: string; error?: string }>(`/api/tasks/${id}/run`, {
    method: 'POST',
  })
}

export async function getScheduledTaskLogs(id: string) {
  return apiFetch<TaskRunLogDTO[]>(`/api/tasks/${id}/logs`)
}

// ===== Auth API =====

export interface AuthUser {
  id: string
  name: string
  avatar: string
  email?: string
}

export async function getCloudStatus() {
  return apiFetch<{ enabled: boolean }>('/api/auth/cloud-status')
}

export async function getAuthLoginUrl(platform?: string) {
  const params = platform ? `?platform=${platform}` : ''
  return apiFetch<{ loginUrl: string }>(`/api/auth/login${params}`)
}

export async function getAuthUser() {
  return apiFetch<AuthUser>('/api/auth/user')
}

export async function authLogout() {
  return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export async function getAuthStatus() {
  return apiFetch<{ loggedIn: boolean }>('/api/auth/status')
}

export async function getPayUrl(platform?: string) {
  const params = platform ? `?platform=${platform}` : ''
  return apiFetch<{ payUrl: string }>(`/api/auth/pay-url${params}`)
}

export async function saveAuthToken(token: string) {
  return apiFetch<{ ok: boolean }>('/api/auth/save-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function uploadFile(file: File): Promise<string> {
  const base = await getBackendBaseUrl()
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${base}/api/auth/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `Upload failed: ${res.status}`)
  }
  const data = await res.json() as { url: string }
  return data.url
}

export async function updateProfile(params: { displayName?: string; avatar?: string }) {
  return apiFetch<AuthUser>('/api/auth/update-profile', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function redeemInvitationCode(code: string) {
  return apiFetch<{ ok: boolean }>('/api/invitation/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

// Referral API

export interface ReferralCode {
  id: number
  code: string
  credits: number
  maxUses: number | null
  usedCount: number
  expiredAt: string | null
  enabled: boolean
  type: string
  userId: number
  createdAt: number
  updatedAt: number
}

export interface ReferralStats {
  invitedCount: number
  totalCredits: number
  code: string
  maxCredits: number
}

export async function getReferralCode() {
  return apiFetch<ReferralCode>('/api/invitation/referral_code')
}

export async function getReferralStats() {
  return apiFetch<ReferralStats>('/api/invitation/referral_stats')
}

// ===== Credit API =====

export interface CreditBalance {
  balance: number
}

export interface CreditTransaction {
  id: number
  userId: number
  amount: number
  balanceAfter: number
  type: string
  description: string
  modelName: string | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  createdAt: number
}

export async function getCreditBalance() {
  return apiFetch<CreditBalance>('/api/credit/balance')
}

export async function getCreditTransactions(limit = 50) {
  return apiFetch<CreditTransaction[]>(`/api/credit/transactions?limit=${limit}`)
}

// ===== Port Config API (Web mode) =====

export async function getPortConfig() {
  return apiFetch<{ port: string | null }>('/api/settings/port')
}

export async function setPortConfig(port: string | null) {
  return apiFetch<{ ok: boolean }>('/api/settings/port', {
    method: 'PUT',
    body: JSON.stringify({ port }),
  })
}

// ===== Settings API =====

export interface CustomModelDTO {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'gemini' | 'custom'
  apiKey: string
  baseUrl: string
  modelId: string
}

export interface SettingsDTO {
  activeModel: {
    provider: 'builtin' | 'custom' | 'cloud'
    id?: string
  }
  customModels: CustomModelDTO[]
  defaultRegistrySource?: RegistrySelectableSource
  registrySources: {
    clawhub: {
      enabled: boolean
      apiBaseUrl: string
      downloadUrl: string
      token: string
    }
    tencent: {
      enabled: boolean
      indexUrl: string
      searchUrl: string
      downloadUrl: string
    }
  }
  builtinModelId?: string | null
}

export async function getSettings() {
  return apiFetch<SettingsDTO>('/api/settings')
}

export async function updateSettings(data: Partial<SettingsDTO>) {
  return apiFetch<SettingsDTO>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// ===== System Logs API =====

export interface LogEntry {
  level: number
  time: number
  msg: string
  category?: string
  agentId?: string
  chatId?: string
  tool?: string
  input?: string
  durationMs?: number
  [key: string]: unknown
}

export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  hasMore: boolean
}

export async function getLogDates() {
  return apiFetch<string[]>('/api/logs')
}

export async function getLogEntries(date: string, params?: {
  level?: string
  category?: string
  search?: string
  offset?: number
  limit?: number
  order?: 'asc' | 'desc'
}) {
  const qs = new URLSearchParams()
  if (params?.level) qs.set('level', params.level)
  if (params?.category) qs.set('category', params.category)
  if (params?.search) qs.set('search', params.search)
  if (params?.offset !== undefined) qs.set('offset', String(params.offset))
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  if (params?.order) qs.set('order', params.order)
  const q = qs.toString()
  return apiFetch<LogQueryResult>(`/api/logs/${date}${q ? `?${q}` : ''}`)
}

// ===== Channels API =====

export interface ConfigFieldInfo {
  key: string
  label: string
  placeholder: string
  secret: boolean
}

export interface ChannelTypeInfo {
  type: string
  label: string
  description: string
  chatIdPrefix: string
  configFields: ConfigFieldInfo[]
  docsUrl: string
  hidden?: boolean
}

export interface ChannelInstance {
  id: string
  type: string
  label: string
  chatIdPrefix: string
  docsUrl: string
  connected: boolean
  enabled: boolean
  config: Record<string, string>
  configuredFields: string[]
  error?: string
  supportsQrLogin?: boolean
  loggedIn?: boolean
  accountLabel?: string
  created_at: string
  updated_at: string
}

export interface ChannelAuthStatus {
  supportsQrLogin: boolean
  loggedIn: boolean
  connected: boolean
  accountId?: string
  accountLabel?: string
}

export async function getChannels() {
  return apiFetch<ChannelInstance[]>('/api/channels')
}

export async function getChannelTypes() {
  return apiFetch<ChannelTypeInfo[]>('/api/channels/types')
}

export async function createChannel(data: {
  id?: string
  type: string
  label: string
  config: Record<string, string>
  enabled?: boolean
}) {
  return apiFetch<ChannelInstance>('/api/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateChannel(id: string, data: {
  label?: string
  config?: Record<string, string>
  enabled?: boolean
}) {
  return apiFetch<ChannelInstance>(`/api/channels/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteChannel(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function connectChannel(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/channels/${encodeURIComponent(id)}/connect`, {
    method: 'POST',
  })
}

export async function disconnectChannel(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/channels/${encodeURIComponent(id)}/disconnect`, {
    method: 'POST',
  })
}

export async function getChannelAuthStatus(id: string) {
  return apiFetch<ChannelAuthStatus>(`/api/channels/${encodeURIComponent(id)}/auth-status`)
}

export async function startChannelQrLogin(id: string, data?: {
  force?: boolean
  timeoutMs?: number
  verbose?: boolean
}) {
  return apiFetch<{ qrDataUrl?: string; message: string }>(`/api/channels/${encodeURIComponent(id)}/login/start`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function waitChannelQrLogin(id: string, data?: { timeoutMs?: number }) {
  return apiFetch<{ connected: boolean; message: string; accountId?: string }>(`/api/channels/${encodeURIComponent(id)}/login/wait`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function logoutChannel(id: string) {
  return apiFetch<{ cleared: boolean; message?: string }>(`/api/channels/${encodeURIComponent(id)}/logout`, {
    method: 'POST',
  })
}
