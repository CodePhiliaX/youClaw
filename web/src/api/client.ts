import { getBackendBaseUrl } from './transport'
import type { Attachment } from '../types/attachment'

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await getBackendBaseUrl()
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<T>
}

// 发消息给 agent
export async function sendMessage(agentId: string, prompt: string, chatId?: string, browserProfileId?: string, attachments?: Attachment[]) {
  return apiFetch<{ chatId: string; status: string }>(`/api/agents/${agentId}/message`, {
    method: 'POST',
    body: JSON.stringify({ prompt, chatId, browserProfileId, attachments }),
  })
}

// 获取聊天列表
export async function getChats() {
  return apiFetch<Array<{ chat_id: string; name: string; agent_id: string; channel: string; last_message_time: string }>>('/api/chats')
}

// 获取消息历史
export async function getMessages(chatId: string) {
  return apiFetch<Array<{ id: string; chat_id: string; sender: string; sender_name: string; content: string; timestamp: string; is_from_me: number; is_bot_message: number; attachments: Attachment[] | null }>>(`/api/chats/${encodeURIComponent(chatId)}/messages`)
}

// 删除聊天
export async function deleteChat(chatId: string) {
  return apiFetch<{ ok: boolean }>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  })
}

// 获取 agents 列表
export async function getAgents() {
  return apiFetch<Array<{ id: string; name: string; workspaceDir: string; status: string; hasConfig: boolean }>>('/api/agents')
}

// 获取 agent 的工作空间文档列表及内容
export async function getAgentDocs(agentId: string) {
  return apiFetch<Record<string, string>>(`/api/agents/${agentId}/docs`)
}

// 获取 agent 指定文档内容
export async function getAgentDoc(agentId: string, filename: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/docs/${encodeURIComponent(filename)}`)
}

// 更新 agent 指定文档
export async function updateAgentDoc(agentId: string, filename: string, content: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/docs/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// 创建新 agent
export async function createAgent(data: { id: string; name: string; model?: string }) {
  return apiFetch<{ ok: boolean; id: string }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

// 获取单个 agent 的完整配置（含子 Agent 定义）
export async function getAgentConfig(agentId: string) {
  return apiFetch<Record<string, unknown>>(`/api/agents/${encodeURIComponent(agentId)}`)
}

// 更新 agent 配置
export async function updateAgentConfig(agentId: string, data: Record<string, unknown>) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// 删除 agent
export async function deleteAgent(agentId: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}`, {
    method: 'DELETE',
  })
}

// Memory API

// 获取 agent 的 MEMORY.md 内容
export async function getMemory(agentId: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory`)
}

// 更新 agent 的 MEMORY.md
export async function updateMemory(agentId: string, content: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/memory`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// 获取每日日志列表
export async function getMemoryLogs(agentId: string) {
  return apiFetch<string[]>(`/api/agents/${agentId}/memory/logs`)
}

// 获取某天的日志内容
export async function getMemoryLog(agentId: string, date: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/logs/${date}`)
}

// 全局 Memory
export async function getGlobalMemory() {
  return apiFetch<{ content: string }>('/api/memory/global')
}

export async function updateGlobalMemory(content: string) {
  return apiFetch<{ ok: boolean }>('/api/memory/global', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

// 对话存档
export async function getConversationArchives(agentId: string) {
  return apiFetch<Array<{ filename: string; date: string }>>(`/api/agents/${agentId}/memory/conversations`)
}

export async function getConversationArchive(agentId: string, filename: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/conversations/${encodeURIComponent(filename)}`)
}

// 快照
export async function createSnapshot(agentId: string) {
  return apiFetch<{ ok: boolean }>(`/api/agents/${agentId}/memory/snapshot`, { method: 'POST' })
}

export async function getSnapshot(agentId: string) {
  return apiFetch<{ content: string }>(`/api/agents/${agentId}/memory/snapshot`)
}

// 记忆搜索
export async function searchMemory(query: string, agentId?: string) {
  const params = new URLSearchParams({ q: query })
  if (agentId) params.set('agentId', agentId)
  return apiFetch<Array<{ agentId: string; fileType: string; filePath: string; snippet: string; rank: number }>>(`/api/memory/search?${params}`)
}

// Skills 相关类型
export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  os?: string[]
  dependencies?: string[]
  env?: string[]
  tools?: string[]
  install?: Record<string, string>
}

export interface EligibilityDetail {
  os: { passed: boolean; current: string; required?: string[] }
  dependencies: { passed: boolean; results: Array<{ name: string; found: boolean; path?: string }> }
  env: { passed: boolean; results: Array<{ name: string; found: boolean }> }
}

export interface Skill {
  name: string
  source: 'workspace' | 'builtin' | 'user'
  frontmatter: SkillFrontmatter
  content: string
  path: string
  eligible: boolean
  eligibilityErrors: string[]
  eligibilityDetail: EligibilityDetail
  enabled: boolean
  usable: boolean
}

// 获取所有可用 skills
export async function getSkills() {
  return apiFetch<Skill[]>('/api/skills')
}

// 获取 agent 启用的 skills
export async function getAgentSkills(agentId: string) {
  return apiFetch<Skill[]>(`/api/agents/${encodeURIComponent(agentId)}/skills`)
}

// 配置 skill 环境变量
export async function configureSkillEnv(key: string, value: string) {
  return apiFetch<{ ok: boolean }>('/api/skills/configure', {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  })
}

// 安装 skill 依赖
export async function installSkill(skillName: string, method: string) {
  return apiFetch<{ ok: boolean; stdout: string; stderr: string; exitCode: number }>('/api/skills/install', {
    method: 'POST',
    body: JSON.stringify({ skillName, method }),
  })
}

// 启用/停用 skill
export async function toggleSkill(name: string, enabled: boolean) {
  return apiFetch<Skill>(`/api/skills/${encodeURIComponent(name)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })
}

// ===== 技能市场 API =====

export interface RecommendedSkill {
  slug: string
  displayName: string
  summary: string
  category: string
  installed: boolean
}

export async function getRecommendedSkills() {
  return apiFetch<RecommendedSkill[]>('/api/registry/recommended')
}

export async function installRecommendedSkill(slug: string) {
  return apiFetch<{ ok: boolean; error?: string }>('/api/registry/install', {
    method: 'POST',
    body: JSON.stringify({ slug }),
  })
}

export async function uninstallRecommendedSkill(slug: string) {
  return apiFetch<{ ok: boolean; error?: string }>('/api/registry/uninstall', {
    method: 'POST',
    body: JSON.stringify({ slug }),
  })
}

// ===== 浏览器 Profile API =====

export interface BrowserProfileDTO {
  id: string
  name: string
  created_at: string
}

export async function getBrowserProfiles() {
  return apiFetch<BrowserProfileDTO[]>('/api/browser-profiles')
}

export async function createBrowserProfile(name: string) {
  return apiFetch<BrowserProfileDTO>('/api/browser-profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function deleteBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean }>(`/api/browser-profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function launchBrowserProfile(id: string) {
  return apiFetch<{ ok: boolean; profileDir: string }>(`/api/browser-profiles/${encodeURIComponent(id)}/launch`, {
    method: 'POST',
  })
}

// ===== 定时任务 API =====

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

// ===== 系统日志 API =====

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
}) {
  const qs = new URLSearchParams()
  if (params?.level) qs.set('level', params.level)
  if (params?.category) qs.set('category', params.category)
  if (params?.search) qs.set('search', params.search)
  if (params?.offset !== undefined) qs.set('offset', String(params.offset))
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
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
  created_at: string
  updated_at: string
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
