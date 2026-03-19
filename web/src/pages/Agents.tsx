import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getAgents, getAgentDocs, updateAgentDoc, createAgent, deleteAgent, getAgentConfig, updateAgentConfig, getBrowserProfiles, getSkills, getMarketplaceSkills, getRecommendedSkills, getMarketplaceSkill, installRecommendedSkill } from '../api/client'
import type { BrowserProfileDTO, Skill, MarketplaceSkill, MarketplaceSkillDetail } from '../api/client'
import { useNavigate } from 'react-router-dom'
import {
  Bot, FolderOpen, MessageSquare, Plus, Trash2,
  FileText, Save, Pencil, X, ChevronRight,
  Activity, Clock, AlertCircle, Layers, Globe, Puzzle,
  Store, Loader2,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '../i18n'
import { useChatContext } from '../hooks/chatCtx'
import { SidePanel } from '@/components/layout/SidePanel'
import { MarketplaceCard } from '@/components/MarketplaceCard'
import { MarketplaceDisclaimer } from '@/components/MarketplaceDisclaimer'
import { MarketplaceInstallDialog } from '@/components/MarketplaceInstallDialog'
import { useDragRegion } from "@/hooks/useDragRegion"
import {
  AgentMarketplaceSkillState,
  createAgentSkillBindingsModel,
  getAgentMarketplaceSkillState,
  resolveMarketplaceLocalSkillName,
} from '../lib/agent-skill-state'

type AgentState = {
  sessionId: string | null
  isProcessing: boolean
  lastProcessedAt: string | null
  totalProcessed: number
  lastError: string | null
  queueDepth: number
}

type Agent = {
  id: string
  name: string
  model?: string
  workspaceDir: string
  status?: string
  hasConfig?: boolean
  state?: AgentState | null
}

type SubAgentDef = {
  description: string
  prompt?: string
  promptFile?: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  skills?: string[]
  maxTurns?: number
}

type SubAgentsMap = Record<string, SubAgentDef>

// Document file list and icon descriptions
const DOC_FILES = [
  { name: 'SOUL.md', label: 'Soul', desc: 'Personality & Style' },
  { name: 'AGENT.md', label: 'Agent', desc: 'Capabilities & Rules' },
  { name: 'USER.md', label: 'User', desc: 'User Info & Preferences' },
  { name: 'TOOLS.md', label: 'Tools', desc: 'Tool Notes & APIs' },
] as const

type ViewMode = 'detail' | 'create'

export function Agents() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { refreshAgents: refreshChatAgents } = useChatContext()
  const drag = useDragRegion()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)

  // Document-related state
  const [docs, setDocs] = useState<Record<string, string>>({})
  const [editingDoc, setEditingDoc] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Create Agent form
  const [newName, setNewName] = useState('')
  const [newModel, setNewModel] = useState('default')
  const [isCreating, setIsCreating] = useState(false)

  // Expanded document
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)

  // Sub-agent related state
  const [subAgents, setSubAgents] = useState<SubAgentsMap>({})

  // Browser profile related state
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfileDTO[]>([])
  const [agentBrowserProfile, setAgentBrowserProfile] = useState<string | undefined>(undefined)

  // Skills related state
  const [allSkills, setAllSkills] = useState<Skill[]>([])
  const [agentSkills, setAgentSkills] = useState<string[] | undefined>(undefined)

  const loadAgents = useCallback(() => {
    getAgents().then((list) => setAgents(list as Agent[])).catch(() => {})
  }, [])

  useEffect(() => {
    loadAgents()
    getBrowserProfiles().then(setBrowserProfiles).catch(() => {})
    getSkills().then(setAllSkills).catch(() => {})

    // Refresh skills list when skills are changed from other pages
    const handleSkillsChanged = () => {
      getSkills().then(setAllSkills).catch(() => {})
    }
    window.addEventListener('skills-changed', handleSkillsChanged)
    return () => window.removeEventListener('skills-changed', handleSkillsChanged)
  }, [loadAgents])

  // Load documents for the selected agent
  useEffect(() => {
    if (selected) {
      getAgentDocs(selected)
        .then(setDocs)
        .catch(() => setDocs({}))
      setEditingDoc(null)
      setExpandedDoc(null)
    }
  }, [selected])

  // Load agent config (sub-agents, browserProfile, skills)
  const loadConfig = useCallback(() => {
    if (!selected) return
    getAgentConfig(selected)
      .then((config) => {
        setSubAgents((config.agents as SubAgentsMap) ?? {})
        setAgentBrowserProfile(config.browserProfile as string | undefined)
        setAgentSkills(config.skills as string[] | undefined)
      })
      .catch(() => {
        setSubAgents({})
        setAgentBrowserProfile(undefined)
        setAgentSkills(undefined)
      })
    // Also refresh available skills list
    getSkills().then(setAllSkills).catch(() => {})
  }, [selected])

  useEffect(() => {
    if (selected) loadConfig()
  }, [selected, loadConfig])

  // Save sub-agent config
  const handleSaveSubAgents = async (updatedAgents: SubAgentsMap) => {
    if (!selected) return
    await updateAgentConfig(selected, { agents: updatedAgents })
    setSubAgents(updatedAgents)
  }

  // Save browserProfile config
  const handleSaveBrowserProfile = async (profileId: string | undefined) => {
    if (!selected) return
    setAgentBrowserProfile(profileId)
    await updateAgentConfig(selected, { browserProfile: profileId ?? null })
  }

  // Rename Agent
  const handleRename = async (newName: string) => {
    if (!selected) return
    await updateAgentConfig(selected, { name: newName })
    loadAgents()
  }

  const selectedAgent = agents.find((a) => a.id === selected)

  // Save document
  const handleSaveDoc = async () => {
    if (!selected || !editingDoc) return
    setIsSaving(true)
    try {
      await updateAgentDoc(selected, editingDoc, editContent)
      setDocs((prev) => ({ ...prev, [editingDoc]: editContent }))
      setEditingDoc(null)
    } catch {
      // silently ignore
    } finally {
      setIsSaving(false)
    }
  }

  // Create Agent
  const handleCreate = async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    try {
      const result = await createAgent({ name: newName.trim(), model: newModel })
      loadAgents()
      refreshChatAgents()
      setSelected(result.id)
      setViewMode('detail')
      setNewName('')
      setNewModel('default')
    } catch {
      // silently ignore
    } finally {
      setIsCreating(false)
    }
  }

  // Delete Agent
  const handleDelete = async (agentId: string) => {
    if (agentId === 'default') return
    try {
      await deleteAgent(agentId)
      loadAgents()
      refreshChatAgents()
      if (selected === agentId) {
        setSelected(null)
      }
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="flex h-full">
      {/* Left side: Agent list */}
      <SidePanel>
        <div className="h-12 shrink-0 px-3 border-b border-border flex items-center justify-between" {...drag}>
          <h2 className="font-semibold text-sm">{t.agents.title}</h2>
          <button
            data-testid="agent-create-btn"
            onClick={() => {
              setViewMode('create')
              setSelected(null)
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={t.agents.createAgent}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              data-testid="agent-item"
              onClick={() => {
                setSelected(agent.id)
                setViewMode('detail')
              }}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md text-left transition-colors group',
                selected === agent.id && viewMode === 'detail'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                  agent.state?.isProcessing ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400',
                )}
              >
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{agent.name}</div>
                <div className="text-xs text-muted-foreground truncate">{agent.id}</div>
              </div>
              {agent.state && agent.state.queueDepth > 0 && (
                <span className="text-xs bg-primary/20 text-primary rounded-full px-1.5 py-0.5">
                  {agent.state.queueDepth}
                </span>
              )}
            </button>
          ))}
        </div>
      </SidePanel>

      {/* Right side */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'create' ? (
          <CreateAgentForm
            t={t}
            newName={newName}
            setNewName={setNewName}
            newModel={newModel}
            setNewModel={setNewModel}
            isCreating={isCreating}
            onCreate={handleCreate}
            onCancel={() => {
              setViewMode('detail')
              if (agents.length > 0 && !selected) {
                setSelected(agents[0]!.id)
              }
            }}
          />
        ) : selectedAgent ? (
          <AgentDetail
            t={t}
            agent={selectedAgent}
            docs={docs}
            editingDoc={editingDoc}
            editContent={editContent}
            isSaving={isSaving}
            expandedDoc={expandedDoc}
            onExpandDoc={(name) => setExpandedDoc(expandedDoc === name ? null : name)}
            onEditDoc={(name) => {
              setEditingDoc(name)
              setEditContent(docs[name] ?? '')
            }}
            onCancelEdit={() => setEditingDoc(null)}
            onSaveDoc={handleSaveDoc}
            setEditContent={setEditContent}
            onStartChat={() => navigate('/')}
            onDelete={() => setDeleteAgentId(selectedAgent.id)}
            subAgents={subAgents}
            onSaveSubAgents={handleSaveSubAgents}
            browserProfiles={browserProfiles}
            agentBrowserProfile={agentBrowserProfile}
            onSaveBrowserProfile={handleSaveBrowserProfile}
            onRename={handleRename}
            allSkills={allSkills}
            agentSkills={agentSkills}
            onSkillsUpdate={loadConfig}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Bot className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.agents.selectAgent}</p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteAgentId} onOpenChange={(open) => !open && setDeleteAgentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.agents.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>{''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteAgentId) handleDelete(deleteAgentId); setDeleteAgentId(null) }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// === Create Agent Form ===
function CreateAgentForm({
  t,
  newName,
  setNewName,
  newModel,
  setNewModel,
  isCreating,
  onCreate,
  onCancel,
}: {
  t: ReturnType<typeof useI18n>['t']
  newName: string
  setNewName: (v: string) => void
  newModel: string
  setNewModel: (v: string) => void
  isCreating: boolean
  onCreate: () => void
  onCancel: () => void
}) {
  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-lg font-semibold mb-6">{t.agents.createTitle}</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">{t.agents.agentName}</label>
          <input
            data-testid="agent-input-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.agents.agentNamePlaceholder}
            className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">{t.agents.model}</label>
          <input
            data-testid="agent-input-model"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            data-testid="agent-submit-btn"
            onClick={onCreate}
            disabled={isCreating || !newName.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {isCreating ? t.agents.creating : t.common.create}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md text-muted-foreground hover:bg-accent transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

// === Agent Detail View ===
function AgentDetail({
  t,
  agent,
  docs,
  editingDoc,
  editContent,
  isSaving,
  expandedDoc,
  onExpandDoc,
  onEditDoc,
  onCancelEdit,
  onSaveDoc,
  setEditContent,
  onStartChat,
  onDelete,
  subAgents,
  onSaveSubAgents,
  browserProfiles,
  agentBrowserProfile,
  onSaveBrowserProfile,
  onRename,
  allSkills,
  agentSkills,
  onSkillsUpdate,
}: {
  t: ReturnType<typeof useI18n>['t']
  agent: Agent
  docs: Record<string, string>
  editingDoc: string | null
  editContent: string
  isSaving: boolean
  expandedDoc: string | null
  onExpandDoc: (name: string) => void
  onEditDoc: (name: string) => void
  onCancelEdit: () => void
  onSaveDoc: () => void
  setEditContent: (v: string) => void
  onStartChat: () => void
  onDelete: () => void
  subAgents: SubAgentsMap
  onSaveSubAgents: (agents: SubAgentsMap) => Promise<void>
  browserProfiles: BrowserProfileDTO[]
  agentBrowserProfile: string | undefined
  onSaveBrowserProfile: (profileId: string | undefined) => Promise<void>
  onRename: (newName: string) => Promise<void>
  allSkills: Skill[]
  agentSkills: string[] | undefined
  onSkillsUpdate: () => void
}) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(agent.name)
  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {isEditingName ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const trimmed = nameValue.trim()
                    if (trimmed && trimmed !== agent.name) {
                      await onRename(trimmed)
                    }
                    setIsEditingName(false)
                  }}
                >
                  <input
                    autoFocus
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onBlur={() => { setIsEditingName(false); setNameValue(agent.name) }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setIsEditingName(false); setNameValue(agent.name) } }}
                    className="text-xl font-semibold bg-muted border border-border rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </form>
              ) : (
                <>
                  <h1 className="text-xl font-semibold">{agent.name}</h1>
                  <button
                    onClick={() => { setNameValue(agent.name); setIsEditingName(true) }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={t.common.edit}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{agent.id} · {agent.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onStartChat}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            {t.agents.startChat}
          </button>
          {agent.id !== 'default' && (
            <button
              data-testid="agent-delete-btn"
              onClick={onDelete}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Status cards */}
      {agent.state && (
        <div className="grid grid-cols-4 gap-3">
          <StatusCard
            icon={<Activity className="h-4 w-4" />}
            label={t.agents.status}
            value={agent.state.isProcessing ? 'Processing' : 'Idle'}
            color={agent.state.isProcessing ? 'yellow' : 'green'}
          />
          <StatusCard
            icon={<Layers className="h-4 w-4" />}
            label={t.agents.totalProcessed}
            value={String(agent.state.totalProcessed)}
          />
          <StatusCard
            icon={<Clock className="h-4 w-4" />}
            label={t.agents.lastProcessed}
            value={agent.state.lastProcessedAt ? new Date(agent.state.lastProcessedAt).toLocaleString() : t.agents.never}
          />
          <StatusCard
            icon={<AlertCircle className="h-4 w-4" />}
            label={t.agents.queueDepth}
            value={String(agent.state.queueDepth)}
          />
        </div>
      )}

      {/* Basic info */}
      <div className="grid gap-3">
        <InfoRow label={t.agents.workspace} value={
          <span className="flex items-center gap-1 text-xs font-mono">
            <FolderOpen className="h-3 w-3" />
            {agent.workspaceDir}
          </span>
        } />
        {agent.state?.lastError && (
          <InfoRow label={t.agents.lastError} value={
            <span className="text-destructive text-xs">{agent.state.lastError}</span>
          } />
        )}
      </div>

      {/* Browser Profile binding */}
      {browserProfiles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4" />
            {t.agents.browserProfile}
          </h2>
          <div className="flex items-center gap-3">
            <Select
              value={agentBrowserProfile ?? '__none__'}
              onValueChange={(v) => onSaveBrowserProfile(v === '__none__' ? undefined : v)}
            >
              <SelectTrigger data-testid="agent-browser-profile-select" className="w-[240px]">
                <SelectValue placeholder={t.agents.browserProfileNone} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.agents.browserProfileNone}</SelectItem>
                {browserProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.id})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{t.agents.browserProfileHint}</span>
          </div>
        </div>
      )}

      {/* Skills section */}
      <AgentSkillsSection
        agentId={agent.id}
        agentSkills={agentSkills}
        allSkills={allSkills}
        onUpdate={onSkillsUpdate}
      />

      {/* Sub-agents section */}
      <SubAgentsSection t={t} subAgents={subAgents} onSave={onSaveSubAgents} />

      {/* Documents section */}
      <div>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {t.agents.docs}
        </h2>
        <div className="space-y-2">
          {DOC_FILES.map((doc) => (
            <DocSection
              key={doc.name}
              t={t}
              docName={doc.name}
              docLabel={doc.label}
              docDesc={doc.desc}
              content={docs[doc.name] ?? ''}
              isExpanded={expandedDoc === doc.name}
              isEditing={editingDoc === doc.name}
              editContent={editContent}
              isSaving={isSaving}
              onToggle={() => onExpandDoc(doc.name)}
              onEdit={() => onEditDoc(doc.name)}
              onCancel={onCancelEdit}
              onSave={onSaveDoc}
              setEditContent={setEditContent}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// === Collapsible Document Editor ===
function DocSection({
  t,
  docName,
  docLabel,
  docDesc,
  content,
  isExpanded,
  isEditing,
  editContent,
  isSaving,
  onToggle,
  onEdit,
  onCancel,
  onSave,
  setEditContent,
}: {
  t: ReturnType<typeof useI18n>['t']
  docName: string
  docLabel: string
  docDesc: string
  content: string
  isExpanded: boolean
  isEditing: boolean
  editContent: string
  isSaving: boolean
  onToggle: () => void
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  setEditContent: (v: string) => void
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Title bar */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent/30 transition-colors"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', isExpanded && 'rotate-90')} />
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium">{docLabel}</span>
        <span className="text-xs text-muted-foreground">({docName})</span>
        <span className="text-xs text-muted-foreground ml-auto">{docDesc}</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
          {/* Toolbar */}
          <div className="flex items-center justify-end px-3 py-1.5 bg-muted/30 border-b border-border/50">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                >
                  <X className="h-3 w-3" />
                  {t.common.cancel}
                </button>
                <button
                  data-testid="doc-save-btn"
                  onClick={onSave}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Save className="h-3 w-3" />
                  {isSaving ? t.agents.saving : t.common.save}
                </button>
              </div>
            ) : (
              <button
                data-testid="doc-edit-btn"
                onClick={onEdit}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
              >
                <Pencil className="h-3 w-3" />
                {t.agents.editDoc}
              </button>
            )}
          </div>

          {/* Edit/Preview area */}
          <div className="p-3">
            {isEditing ? (
              <textarea
                data-testid="doc-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[200px] bg-transparent text-sm font-mono resize-y focus:outline-none text-foreground placeholder:text-muted-foreground"
                placeholder={t.agents.noContent}
              />
            ) : (
              <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80 min-h-[60px]">
                {content.trim() || (
                  <span className="text-muted-foreground italic">{t.agents.noContent}</span>
                )}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// === Clean edit draft, remove empty optional fields ===
function cleanDraft(draft: SubAgentDef): SubAgentDef {
  const result: SubAgentDef = { description: draft.description }
  if (draft.prompt?.trim()) result.prompt = draft.prompt.trim()
  if (draft.promptFile?.trim()) result.promptFile = draft.promptFile.trim()
  if (draft.tools && draft.tools.length > 0) result.tools = draft.tools
  if (draft.disallowedTools && draft.disallowedTools.length > 0) result.disallowedTools = draft.disallowedTools
  if (draft.model && draft.model !== 'inherit') result.model = draft.model
  if (draft.skills && draft.skills.length > 0) result.skills = draft.skills
  if (draft.maxTurns && draft.maxTurns > 0) result.maxTurns = draft.maxTurns
  return result
}

// === Agent Skills Section ===
function AgentSkillsSection({
  agentId,
  agentSkills,
  allSkills,
  onUpdate,
}: {
  agentId: string
  agentSkills: string[] | undefined
  allSkills: Skill[]
  onUpdate: () => void
}) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')

  // Marketplace dialog state
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [marketplaceQuery, setMarketplaceQuery] = useState('')
  const [marketplaceResults, setMarketplaceResults] = useState<MarketplaceSkill[]>([])
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)
  const [loadingConfirmSlug, setLoadingConfirmSlug] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [marketplaceAppendError, setMarketplaceAppendError] = useState<string | null>(null)
  const [confirmDetail, setConfirmDetail] = useState<MarketplaceSkillDetail | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const marketplaceScrollRef = useRef<HTMLDivElement | null>(null)
  const marketplaceLoadMoreRef = useRef<HTMLDivElement | null>(null)
  const marketplacePendingCursorRef = useRef<string | null>(null)
  const bindingsModel = useMemo(
    () => createAgentSkillBindingsModel(allSkills, agentSkills),
    [allSkills, agentSkills],
  )
  const {
    isWildcard,
    installedSkillNames,
    normalizedAgentSkillNames,
    boundSkillNames,
  } = bindingsModel

  const filteredSkills = allSkills.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.frontmatter.description.toLowerCase().includes(search.toLowerCase())
  )

  const allSelected = filteredSkills.length > 0 && filteredSkills.every((skill) => boundSkillNames.has(skill.name))
  const someSelected = filteredSkills.some((skill) => boundSkillNames.has(skill.name))

  const handleToggleSkill = async (skillName: string, checked: boolean) => {
    const current = isWildcard ? installedSkillNames : normalizedAgentSkillNames
    const next = checked
      ? [...current, skillName]
      : current.filter((name) => name !== skillName)
    await updateAgentConfig(agentId, { skills: next })
    onUpdate()
  }

  const handleToggleAll = async (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      await updateAgentConfig(agentId, { skills: ['*'] })
    } else {
      await updateAgentConfig(agentId, { skills: [] })
    }
    onUpdate()
  }

  const [expanded, setExpanded] = useState(false)
  const selectedCount = isWildcard ? installedSkillNames.length : boundSkillNames.size

  // Load recommended skills initially, search marketplace on query change
  useEffect(() => {
    if (!marketplaceOpen) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)

    if (!marketplaceQuery.trim()) {
      setMarketplaceLoading(true)
      setMarketplaceError(null)
      setMarketplaceAppendError(null)
      marketplacePendingCursorRef.current = null
      getRecommendedSkills()
        .then((skills) => {
          setMarketplaceResults(skills)
          setNextCursor(null)
        })
        .catch(() => {
          setMarketplaceResults([])
          setMarketplaceError(t.agents.marketplaceError)
        })
        .finally(() => setMarketplaceLoading(false))
      return
    }

    searchTimerRef.current = setTimeout(() => {
      setMarketplaceLoading(true)
      setMarketplaceError(null)
      setMarketplaceAppendError(null)
      marketplacePendingCursorRef.current = null
      getMarketplaceSkills({ query: marketplaceQuery })
        .then((page) => {
          setMarketplaceResults(page.items)
          setNextCursor(page.nextCursor)
        })
        .catch(() => {
          setMarketplaceResults([])
          setMarketplaceError(t.agents.marketplaceError)
        })
        .finally(() => setMarketplaceLoading(false))
    }, 300)

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [marketplaceOpen, marketplaceQuery, t.agents.marketplaceError])

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || marketplaceLoading || marketplacePendingCursorRef.current === nextCursor) return
    marketplacePendingCursorRef.current = nextCursor
    setMarketplaceAppendError(null)
    setMarketplaceLoading(true)
    getMarketplaceSkills({ query: marketplaceQuery, cursor: nextCursor })
      .then((page) => {
        setMarketplaceResults((prev) => [...prev, ...page.items])
        setNextCursor(page.nextCursor)
        marketplacePendingCursorRef.current = null
      })
      .catch(() => {
        marketplacePendingCursorRef.current = null
        setMarketplaceAppendError(t.agents.marketplaceError)
      })
      .finally(() => setMarketplaceLoading(false))
  }, [marketplaceLoading, marketplaceQuery, nextCursor, t.agents.marketplaceError])

  const handleOpenMarketplace = () => {
    setMarketplaceQuery('')
    setMarketplaceOpen(true)
  }

  const handleCloseMarketplace = () => {
    setMarketplaceOpen(false)
    setMarketplaceQuery('')
    setMarketplaceResults([])
    setNextCursor(null)
    setMarketplaceError(null)
    setMarketplaceAppendError(null)
    marketplacePendingCursorRef.current = null
  }

  const installAndBindSkill = async (slug: string) => {
    setInstallingSlug(slug)
    try {
      const beforeNames = new Set(installedSkillNames)
      await installRecommendedSkill(slug)
      const freshSkills = await getSkills()

      const newSkill = freshSkills.find((skill) => skill.registryMeta?.slug === slug)
        ?? freshSkills.find((skill) => !beforeNames.has(skill.name))

      if (newSkill && !isWildcard) {
        const current = normalizedAgentSkillNames
        if (!current.includes(newSkill.name)) {
          await updateAgentConfig(agentId, { skills: [...current, newSkill.name] })
        }
      }
      onUpdate()
      handleCloseMarketplace()
    } catch {
      // Error is silently handled; the user can retry
    } finally {
      setInstallingSlug(null)
    }
  }

  const handleConfirmInstallAndBind = async (skill: MarketplaceSkill) => {
    setLoadingConfirmSlug(skill.slug)
    try {
      const detail = await getMarketplaceSkill(skill.slug)
      setConfirmDetail(detail)
    } catch {
      setConfirmDetail({
        ...skill,
        ownerHandle: null,
        ownerDisplayName: null,
        ownerImage: null,
        moderation: null,
      })
    } finally {
      setLoadingConfirmSlug(null)
    }
  }

  const handleBindSkill = async (skillName: string) => {
    await handleToggleSkill(skillName, true)
    handleCloseMarketplace()
  }

  const visibleMarketplaceResults = useMemo(
    () => marketplaceResults.filter((skill) => getAgentMarketplaceSkillState(skill, bindingsModel) !== AgentMarketplaceSkillState.HiddenBound),
    [marketplaceResults, bindingsModel],
  )

  useEffect(() => {
    const container = marketplaceScrollRef.current
    const sentinel = marketplaceLoadMoreRef.current
    if (!container || !sentinel || !marketplaceOpen || !nextCursor || marketplaceLoading || marketplaceAppendError) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore()
        }
      },
      {
        root: container,
        threshold: 0,
        rootMargin: '0px 0px 240px 0px',
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [handleLoadMore, marketplaceAppendError, marketplaceLoading, marketplaceOpen, nextCursor])

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(!expanded)
          }
        }}
        className="flex items-center gap-2 w-full text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', expanded && 'rotate-90')} />
        <Puzzle className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">{t.agents.skills}</h3>
        <button
          onClick={(e) => { e.stopPropagation(); handleOpenMarketplace() }}
          className="flex items-center gap-1 text-xs text-primary hover:underline ml-2"
        >
          <Store className="h-3 w-3" />
          {t.agents.browseClawHub}
        </button>
        <span className="text-xs text-muted-foreground ml-auto">{selectedCount}/{allSkills.length}</span>
      </div>

      {expanded && (
        <div className="space-y-2 pl-5">
          <div className="flex items-center gap-2">
            <Input
              placeholder={t.agents.skillsSearch}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <div
              className="flex items-center gap-2 shrink-0 cursor-pointer"
              role="button"
              onClick={() => handleToggleAll(!(isWildcard || allSelected))}
            >
              <Checkbox
                checked={isWildcard || allSelected}
                {...(!isWildcard && someSelected && !allSelected ? { 'data-state': 'indeterminate' } : {})}
                tabIndex={-1}
                className="pointer-events-none"
              />
              <span className="text-xs text-muted-foreground">{t.agents.skillsSelectAll}</span>
            </div>
          </div>

          {filteredSkills.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">{t.agents.noSkillsAvailable}</p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {filteredSkills.map(skill => (
                <div
                  key={skill.name}
                  role="button"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer"
                  onClick={() => { if (!isWildcard) handleToggleSkill(skill.name, !boundSkillNames.has(skill.name)) }}
                >
                  <Checkbox
                    checked={boundSkillNames.has(skill.name)}
                    disabled={isWildcard}
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">{skill.name}</span>
                    {skill.frontmatter.description && (
                      <span className="text-xs text-muted-foreground ml-2">{skill.frontmatter.description}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Marketplace Dialog */}
      <Dialog open={marketplaceOpen} onOpenChange={(open) => { if (!open) handleCloseMarketplace() }}>
        <DialogContent className="sm:max-w-3xl max-h-[70vh] overflow-hidden flex flex-col p-8">
          <div className="flex items-center gap-2 mb-2">
            <Store className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">{t.agents.browseClawHub}</h2>
          </div>

          <Input
            placeholder={t.agents.searchMarketplace}
            value={marketplaceQuery}
            onChange={(e) => setMarketplaceQuery(e.target.value)}
            className="h-9 text-sm"
            autoFocus
          />

          <div ref={marketplaceScrollRef} className="mt-4 space-y-1 flex-1 overflow-y-auto pr-1">
            <MarketplaceDisclaimer compact className="mb-3" />

            {/* Error */}
            {marketplaceError && !marketplaceLoading && (
              <p className="text-xs text-red-400 py-2">{marketplaceError}</p>
            )}

            {/* Loading */}
            {marketplaceLoading && marketplaceResults.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Results */}
            {visibleMarketplaceResults.map((skill) => {
              const marketplaceState = getAgentMarketplaceSkillState(skill, bindingsModel)
              const bindingName = resolveMarketplaceLocalSkillName(skill, bindingsModel)
              return (
                <MarketplaceCard
                  key={skill.slug}
                  skill={skill}
                  onChanged={onUpdate}
                  hideInstalledBadge={marketplaceState === AgentMarketplaceSkillState.Bind}
                  statusBadges={
                    marketplaceState === AgentMarketplaceSkillState.Bind ? (
                      <Badge variant="secondary">
                        {t.agents.skillInstalledUnbound}
                      </Badge>
                    ) : undefined
                  }
                  extraActions={
                    installingSlug === skill.slug ? (
                      <Button size="sm" variant="secondary" className="h-7 text-xs" disabled>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        {t.agents.installingSkill}
                      </Button>
                    ) : marketplaceState === AgentMarketplaceSkillState.Bind ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => { if (bindingName) void handleBindSkill(bindingName) }}
                        disabled={!bindingName}
                      >
                        {t.agents.bindSkill}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => handleConfirmInstallAndBind(skill)}
                        disabled={loadingConfirmSlug === skill.slug}
                      >
                        {loadingConfirmSlug === skill.slug ? (
                          <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t.common.loading}</>
                        ) : (
                          t.agents.installAndBind
                        )}
                      </Button>
                    )
                  }
                />
              )
            })}

            {/* Empty */}
            {!marketplaceLoading && !marketplaceError && visibleMarketplaceResults.length === 0 && !nextCursor && (
              <p className="text-xs text-muted-foreground py-6 text-center">{t.agents.noSkillsAvailable}</p>
            )}

            {nextCursor && (
              <div className="space-y-3 pt-1">
                <div ref={marketplaceLoadMoreRef} className="h-1" aria-hidden="true" />
                {marketplaceLoading && marketplaceResults.length > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t.common.loading}</span>
                  </div>
                )}
                {marketplaceAppendError && (
                  <div className="flex flex-col items-center gap-2 py-2 text-sm text-muted-foreground">
                    <p>{marketplaceAppendError}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setMarketplaceAppendError(null)
                        handleLoadMore()
                      }}
                    >
                      {t.common.retry}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <MarketplaceInstallDialog
            open={!!confirmDetail}
            detail={confirmDetail}
            confirmLabel={t.agents.installAndBind}
            onOpenChange={(open) => {
              if (!open) setConfirmDetail(null)
            }}
            onConfirm={() => {
              const slug = confirmDetail?.slug
              setConfirmDetail(null)
              if (slug) {
                void installAndBindSkill(slug)
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// === Sub-Agent Management Section ===
function SubAgentsSection({
  t,
  subAgents,
  onSave,
}: {
  t: ReturnType<typeof useI18n>['t']
  subAgents: SubAgentsMap
  onSave: (agents: SubAgentsMap) => Promise<void>
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null) // null=no editing, '__new__'=adding new
  const [editDraft, setEditDraft] = useState<SubAgentDef>({ description: '' })
  const [newId, setNewId] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [deleteSubId, setDeleteSubId] = useState<string | null>(null)

  const entries = Object.entries(subAgents)

  const handleEdit = (id: string) => {
    setEditingId(id)
    setEditDraft({ ...subAgents[id]! })
    setExpandedId(id)
  }

  const handleAdd = () => {
    setEditingId('__new__')
    setNewId('')
    setEditDraft({ description: '' })
    setExpandedId('__new__')
  }

  const handleCancel = () => {
    setEditingId(null)
    if (expandedId === '__new__') setExpandedId(null)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      let updated: SubAgentsMap
      if (editingId === '__new__') {
        if (!newId.trim()) return
        updated = { ...subAgents, [newId.trim()]: cleanDraft(editDraft) }
      } else if (editingId) {
        updated = { ...subAgents, [editingId]: cleanDraft(editDraft) }
      } else {
        return
      }
      await onSave(updated)
      setEditingId(null)
      if (editingId === '__new__') setExpandedId(newId.trim())
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteSub = async (id: string) => {
    const updated = Object.fromEntries(entries.filter(([k]) => k !== id))
    setIsSaving(true)
    try {
      await onSave(updated)
      if (expandedId === id) setExpandedId(null)
      if (editingId === id) setEditingId(null)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4" />
          {t.agents.subAgents}
        </h2>
        <button
          data-testid="subagent-add-btn"
          onClick={handleAdd}
          disabled={editingId === '__new__'}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.agents.addSubAgent}
        </button>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && editingId !== '__new__' && (
          <p className="text-sm text-muted-foreground italic py-2">{t.agents.noSubAgents}</p>
        )}

        {entries.map(([id, def]) => {
          const isExpanded = expandedId === id
          const isEditing = editingId === id
          return (
            <div key={id} data-testid="subagent-item" className="border border-border rounded-md overflow-hidden">
              {/* Title bar */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : id)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent/30 transition-colors"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', isExpanded && 'rotate-90')} />
                <span className="font-medium">{id}</span>
                <span className="text-xs text-muted-foreground truncate flex-1">{def.description}</span>
                {def.model && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{def.model}</span>
                )}
                {def.tools && def.tools.length > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0">{def.tools.length} tools</span>
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border">
                  {/* Toolbar */}
                  <div className="flex items-center justify-end px-3 py-1.5 bg-muted/30 border-b border-border/50 gap-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={handleCancel}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                        >
                          <X className="h-3 w-3" />
                          {t.common.cancel}
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={isSaving || !editDraft.description.trim()}
                          className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Save className="h-3 w-3" />
                          {isSaving ? t.agents.saving : t.common.save}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEdit(id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                          {t.common.edit}
                        </button>
                        <button
                          data-testid="subagent-delete-btn"
                          onClick={() => setDeleteSubId(id)}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t.common.delete}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Edit/Read-only area */}
                  <div className="p-3">
                    {isEditing ? (
                      <SubAgentForm t={t} draft={editDraft} setDraft={setEditDraft} />
                    ) : (
                      <SubAgentReadView t={t} def={def} />
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* New sub-agent form */}
        {editingId === '__new__' && (
          <div className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 text-sm bg-accent/20">
              <Plus className="h-3.5 w-3.5" />
              <span className="font-medium">{t.agents.addSubAgent}</span>
            </div>
            <div className="border-t border-border">
              <div className="flex items-center justify-end px-3 py-1.5 bg-muted/30 border-b border-border/50 gap-2">
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:bg-accent transition-colors"
                >
                  <X className="h-3 w-3" />
                  {t.common.cancel}
                </button>
                <button
                  data-testid="subagent-save-btn"
                  onClick={handleSave}
                  disabled={isSaving || !newId.trim() || !editDraft.description.trim()}
                  className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Save className="h-3 w-3" />
                  {isSaving ? t.agents.saving : t.common.save}
                </button>
              </div>
              <div className="p-3 space-y-3">
                {/* ID input (shown only when adding new) */}
                <div>
                  <label className="block text-xs font-medium mb-1">{t.agents.subAgentId}</label>
                  <input
                    data-testid="subagent-input-id"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder={t.agents.subAgentIdPlaceholder}
                    className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t.agents.subAgentIdHint}</p>
                </div>
                <SubAgentForm t={t} draft={editDraft} setDraft={setEditDraft} />
              </div>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteSubId} onOpenChange={(open) => !open && setDeleteSubId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.agents.confirmDeleteSub}</AlertDialogTitle>
            <AlertDialogDescription>{''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteSubId) handleDeleteSub(deleteSubId); setDeleteSubId(null) }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// === Sub-Agent Read-Only View ===
function SubAgentReadView({ t, def }: { t: ReturnType<typeof useI18n>['t']; def: SubAgentDef }) {
  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-medium text-muted-foreground">{t.agents.descriptionLabel}</span>
        <p className="text-sm mt-0.5">{def.description}</p>
      </div>

      {def.prompt && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">{t.agents.promptLabel}</span>
          <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/50 rounded p-2 mt-0.5 text-foreground/80">
            {def.prompt}
          </pre>
        </div>
      )}

      {def.promptFile && (
        <InfoRow label={t.agents.promptFileLabel} value={<span className="text-xs font-mono">{def.promptFile}</span>} />
      )}

      {def.model && (
        <InfoRow label={t.agents.model} value={<span className="text-xs px-1.5 py-0.5 rounded bg-muted">{def.model}</span>} />
      )}

      {def.maxTurns != null && (
        <InfoRow label={t.agents.maxTurnsLabel} value={<span className="text-sm">{def.maxTurns}</span>} />
      )}

      {def.tools && def.tools.length > 0 && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">{t.agents.toolsLabel}</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {def.tools.map((tool) => (
              <span key={tool} className="text-xs px-1.5 py-0.5 rounded bg-muted">{tool}</span>
            ))}
          </div>
        </div>
      )}

      {def.disallowedTools && def.disallowedTools.length > 0 && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">{t.agents.disallowedToolsLabel}</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {def.disallowedTools.map((tool) => (
              <span key={tool} className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">{tool}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// === Sub-Agent Edit Form ===
function SubAgentForm({
  t,
  draft,
  setDraft,
}: {
  t: ReturnType<typeof useI18n>['t']
  draft: SubAgentDef
  setDraft: (d: SubAgentDef) => void
}) {
  const inputClass = 'w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium mb-1">{t.agents.descriptionLabel}</label>
        <input
          data-testid="subagent-input-desc"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder={t.agents.descriptionPlaceholder}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">{t.agents.promptLabel}</label>
        <textarea
          value={draft.prompt ?? ''}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          placeholder={t.agents.promptPlaceholder}
          rows={4}
          className={cn(inputClass, 'resize-y font-mono')}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">{t.agents.promptFileLabel}</label>
        <input
          value={draft.promptFile ?? ''}
          onChange={(e) => setDraft({ ...draft, promptFile: e.target.value })}
          placeholder={t.agents.promptFilePlaceholder}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">{t.agents.model}</label>
          <Select
            value={draft.model ?? 'inherit'}
            onValueChange={(v) => setDraft({ ...draft, model: v === 'inherit' ? undefined : v })}
          >
            <SelectTrigger className={inputClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">inherit</SelectItem>
              <SelectItem value="sonnet">sonnet</SelectItem>
              <SelectItem value="opus">opus</SelectItem>
              <SelectItem value="haiku">haiku</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t.agents.maxTurnsLabel}</label>
          <input
            type="number"
            value={draft.maxTurns ?? ''}
            onChange={(e) => setDraft({ ...draft, maxTurns: e.target.value ? Number(e.target.value) : undefined })}
            min={1}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">{t.agents.toolsLabel}</label>
        <input
          value={(draft.tools ?? []).join(', ')}
          onChange={(e) => {
            const val = e.target.value
            setDraft({ ...draft, tools: val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [] })
          }}
          placeholder={t.agents.toolsPlaceholder}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">{t.agents.disallowedToolsLabel}</label>
        <input
          value={(draft.disallowedTools ?? []).join(', ')}
          onChange={(e) => {
            const val = e.target.value
            setDraft({ ...draft, disallowedTools: val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [] })
          }}
          placeholder={t.agents.toolsPlaceholder}
          className={inputClass}
        />
      </div>
    </div>
  )
}

// === Status Card ===
function StatusCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color?: 'green' | 'yellow' | 'red'
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className={cn(
        'text-sm font-medium',
        color === 'green' && 'text-green-400',
        color === 'yellow' && 'text-yellow-400',
        color === 'red' && 'text-destructive',
      )}>
        {value}
      </div>
    </div>
  )
}

// === Info Row ===
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}
