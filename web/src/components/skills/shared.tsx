import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Skill } from '@/api/client'
import { configureSkillEnv, installSkill, installTool } from '@/api/client'
import { useI18n } from '@/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Copy,
  Download,
  FolderOpen,
  Key,
  Loader2,
  PencilLine,
  Puzzle,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import type { InstalledSkillListItem } from './skills-view-types'

export function EligibilityIcon({ skill }: { skill: Skill }) {
  if (!skill.enabled) {
    return <XCircle className="h-4 w-4 text-muted-foreground" />
  }
  if (skill.usable) {
    return <CheckCircle className="h-4 w-4 text-green-400" />
  }
  if (skill.eligible) {
    return <AlertTriangle className="h-4 w-4 text-yellow-400" />
  }
  return <XCircle className="h-4 w-4 text-red-400" />
}

export function SkillListItem({
  item,
  selected,
  setSelected,
  onEditSkill,
  t,
}: {
  item: InstalledSkillListItem
  selected: string | null
  setSelected: (value: string | null) => void
  onEditSkill: (skillName: string) => void
  t: ReturnType<typeof useI18n>['t']
}) {
  const isEditable = item.kind === 'editable'
  const canOpenDetail = !isEditable || item.skill.hasPublished
  const isSelected = canOpenDetail && selected === item.name
  const runtimeSkill = item.kind === 'installed' ? item.skill : null
  let avatarClass = 'bg-primary/10 text-primary'
  let avatarIcon: ReactNode = <Puzzle className="h-4 w-4" />

  if (isEditable) {
    if (item.skill.hasDraft || !item.skill.hasPublished) {
      avatarClass = 'bg-amber-500/15 text-amber-300'
      avatarIcon = <PencilLine className="h-4 w-4" />
    } else {
      avatarClass = 'bg-green-500/20 text-green-400'
      avatarIcon = <CheckCircle className="h-4 w-4" />
    }
  }

  if (!isEditable && runtimeSkill) {
    if (!runtimeSkill.enabled) avatarClass = 'bg-muted text-muted-foreground'
    else if (runtimeSkill.usable) avatarClass = 'bg-green-500/20 text-green-400'
    else avatarClass = 'bg-red-500/20 text-red-400'
  }

  return (
    <button
      data-testid="skill-item"
      onClick={() => {
        if (isEditable && !item.skill.hasPublished) {
          onEditSkill(item.name)
          return
        }
        setSelected(item.name)
      }}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium',
          avatarClass,
        )}
      >
        {avatarIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate font-medium">{item.name}</div>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {item.sourceLabel}
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">{item.description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.kind === 'editable' ? (
          <>
            {item.skill.hasDraft && <Badge variant="outline" className="text-[10px]">{t.skills.draftBadge}</Badge>}
            {item.skill.hasPublished && <Badge variant="secondary" className="text-[10px]">{t.skills.publishedBadge}</Badge>}
          </>
        ) : (
          runtimeSkill ? <EligibilityIcon skill={runtimeSkill} /> : null
        )}
      </div>
    </button>
  )
}

export function EnvConfigRow({ envName, configured, onSaved }: { envName: string; configured: boolean; onSaved: () => void }) {
  const { t } = useI18n()
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [editing, setEditing] = useState(!configured)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')

  const formatMessage = (template: string) => template.replace('{key}', envName)

  const handleSave = async () => {
    if (!value.trim()) return
    setStatus('saving')
    try {
      await configureSkillEnv(envName, value.trim())
      setStatus('idle')
      setEditing(false)
      setValue('')
      onSaved()
      showGlobalBubble({ message: formatMessage(t.skills.envSaveSuccess) })
    } catch (error) {
      setStatus('idle')
      showGlobalBubble({
        type: 'error',
        message: error instanceof Error && error.message
          ? error.message
          : formatMessage(t.skills.envSaveFailed),
      })
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <code className="text-xs font-mono shrink-0">{envName}</code>
        <span className="flex-1 text-xs text-muted-foreground font-mono">--------</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setEditing(true); setStatus('idle') }}
          className="h-7 px-2 text-xs"
        >
          {t.common.edit}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Key className={cn('h-3.5 w-3.5 shrink-0', configured ? 'text-green-400' : 'text-yellow-400')} />
      <code className="text-xs font-mono shrink-0">{envName}</code>
      <Input
        type="password"
        placeholder={t.skills.envPlaceholder}
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus('idle') }}
        onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
        className="h-7 text-xs flex-1"
        disabled={status === 'saving'}
        autoFocus
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleSave()}
        disabled={!value.trim() || status === 'saving'}
        className="h-7 px-2 text-xs"
      >
        {status === 'saving' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        {status === 'saving' ? t.skills.savingEnv : t.skills.configureEnv}
      </Button>
      {configured && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setEditing(false); setValue(''); setStatus('idle') }}
          className="h-7 px-2 text-xs"
        >
          {t.common.cancel}
        </Button>
      )}
    </div>
  )
}

export function InstallButton({ method, command, skillName, onInstalled }: { method: string; command: string; skillName: string; onInstalled: () => void }) {
  const { t } = useI18n()
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<'idle' | 'installing'>('idle')

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleInstall = async () => {
    setStatus('installing')
    try {
      const result = await installSkill(skillName, method)
      if (result.ok) {
        setStatus('idle')
        onInstalled()
        showGlobalBubble({ message: t.skills.installSuccess })
      } else {
        setStatus('idle')
        showGlobalBubble({
          type: 'error',
          message: result.stderr || `${t.skills.exitCodeLabel}: ${result.exitCode}`,
        })
      }
    } catch (error) {
      setStatus('idle')
      showGlobalBubble({
        type: 'error',
        message: error instanceof Error && error.message ? error.message : t.skills.installFailed,
      })
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs shrink-0">{method}</Badge>
        <code className="flex-1 text-xs font-mono bg-muted/50 px-2 py-1.5 rounded truncate">{command}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label={t.common.copy}
          title={t.common.copy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void handleInstall()}
          disabled={status === 'installing'}
          className="h-7 px-2 text-xs shrink-0"
        >
          {status === 'installing' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          {status === 'installing' ? t.skills.installing : t.skills.installFromMarket}
        </Button>
      </div>
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div className="text-muted-foreground shrink-0">{label}</div>
      <div className="text-right min-w-0">{value}</div>
    </div>
  )
}

export function PathValue({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-1 font-mono text-xs">
      <FolderOpen className="h-3 w-3 shrink-0" />
      <span className="truncate">{value}</span>
    </span>
  )
}

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="text-sm font-medium flex items-center gap-2">
      {icon}
      {children}
    </h3>
  )
}

/**
 * Map executable names (from skill dependencies) to env tool names (from /api/install-tool).
 * If a dependency can be installed via the environment module, we show a one-click install button.
 */
const DEP_TO_ENV_TOOL: Record<string, string> = {
  uv: 'uv',
  uvx: 'uv',       // uvx is part of the uv package
  python: 'python',
  python3: 'python',
  bun: 'bun',
  git: 'git',
  node: 'node',
}

/**
 * Resolve which env tools are needed for a list of missing skill dependencies.
 * Returns deduplicated list of env tool names that can be installed via /api/install-tool.
 */
export function resolveEnvTools(missingDeps: string[]): string[] {
  const tools = new Set<string>()
  for (const dep of missingDeps) {
    const tool = DEP_TO_ENV_TOOL[dep]
    if (tool) tools.add(tool)
  }
  return Array.from(tools)
}

/**
 * One-click install button for env-managed tools (uv, bun, git, python).
 * Reuses the /api/install-tool endpoint with CDN download support.
 */
export function EnvToolInstallButton({ tool, onInstalled }: { tool: string; onInstalled: () => void }) {
  const { t } = useI18n()
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [status, setStatus] = useState<'idle' | 'installing'>('idle')

  const handleInstall = async () => {
    setStatus('installing')
    try {
      const result = await installTool(tool)
      if (result.ok) {
        showGlobalBubble({ message: `${tool} ${t.envSetup.installSuccess}` })
        onInstalled()
      } else {
        showGlobalBubble({
          type: 'error',
          message: result.stderr || t.envSetup.installFailed,
          durationMs: 6000,
        })
      }
    } catch (err) {
      showGlobalBubble({
        type: 'error',
        message: err instanceof Error ? err.message : t.envSetup.installFailed,
        durationMs: 6000,
      })
    }
    setStatus('idle')
  }

  return (
    <Button
      size="sm"
      variant="default"
      onClick={() => void handleInstall()}
      disabled={status === 'installing'}
      className="gap-1.5"
    >
      {status === 'installing' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {status === 'installing'
        ? t.envSetup.installing.replace('{name}', tool)
        : `${t.envSetup.installButton} ${tool}`}
    </Button>
  )
}

export function InstallSectionHeader({ children, onRefresh }: { children: ReactNode; onRefresh: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Download className="h-3.5 w-3.5" />
        {children}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRefresh}
        className="h-6 px-2 text-xs text-muted-foreground"
      >
        <RefreshCw className="h-3 w-3 mr-1" />
        {t.skills.recheckDeps}
      </Button>
    </div>
  )
}
