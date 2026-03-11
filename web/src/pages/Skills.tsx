import { useState, useEffect, useCallback } from 'react'
import { getSkills, configureSkillEnv, installSkill, toggleSkill } from '../api/client'
import type { Skill } from '../api/client'
import { Puzzle, CheckCircle, AlertTriangle, XCircle, FolderOpen, Globe, Cpu, Terminal, Key, Wrench, Download, Copy, Check, Loader2 } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'

const sourceOrder: Skill['source'][] = ['workspace', 'builtin', 'user']

function EligibilityIcon({ skill }: { skill: Skill }) {
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

export function Skills() {
  const { t } = useI18n()
  const [skills, setSkills] = useState<Skill[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const sourceLabels: Record<Skill['source'], string> = {
    workspace: t.skills.workspace,
    builtin: t.skills.project,
    user: t.skills.user,
  }

  const loadSkills = useCallback(() => {
    getSkills().then(setSkills).catch(() => {})
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const selectedSkill = skills.find(s => s.name === selected)

  // 按来源分组
  const grouped = sourceOrder
    .map(source => ({
      source,
      skills: skills.filter(s => s.source === source),
    }))
    .filter(g => g.skills.length > 0)

  return (
    <div className="flex h-full">
      {/* 左侧：Skill 列表 */}
      <div className="w-[260px] border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <h2 className="font-semibold text-sm">{t.skills.title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {grouped.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              {t.skills.noSkills}
            </div>
          )}
          {grouped.map(group => (
            <div key={group.source}>
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {sourceLabels[group.source]}
              </div>
              <div className="space-y-0.5">
                {group.skills.map(skill => (
                  <button
                    key={skill.name}
                    data-testid="skill-item"
                    onClick={() => setSelected(skill.name)}
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md text-left transition-colors',
                      selected === skill.name ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                      !skill.enabled ? 'bg-muted text-muted-foreground' : skill.usable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    )}>
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{skill.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{skill.frontmatter.description}</div>
                    </div>
                    <EligibilityIcon skill={skill} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：Skill 详情 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {selectedSkill ? (
          <div className="max-w-2xl space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center',
                !selectedSkill.enabled ? 'bg-muted' : selectedSkill.usable ? 'bg-green-500/10' : 'bg-red-500/10'
              )}>
                <Puzzle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">{selectedSkill.name}</h1>
                  <Badge variant={selectedSkill.source === 'workspace' ? 'default' : 'secondary'}>
                    {sourceLabels[selectedSkill.source]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{selectedSkill.frontmatter.description}</p>
              </div>
              <Button
                data-testid="skill-toggle-btn"
                variant={selectedSkill.enabled ? 'secondary' : 'default'}
                size="sm"
                onClick={async () => {
                  try {
                    await toggleSkill(selectedSkill.name, !selectedSkill.enabled)
                    loadSkills()
                  } catch {}
                }}
              >
                {selectedSkill.enabled ? t.skills.disable : t.skills.enable}
              </Button>
            </div>

            {/* Eligibility status */}
            <div className="rounded-md border border-border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                {!selectedSkill.enabled ? (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{t.skills.disabled}</span>
                  </>
                ) : selectedSkill.usable ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <span className="text-green-400">{t.skills.usable}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-yellow-400" />
                    <span className="text-yellow-400">{t.skills.enabledNotReady}</span>
                  </>
                )}
              </div>

              {/* 环境变量配置：显示所有 env vars，支持配置和编辑 */}
              {selectedSkill.eligibilityDetail?.env.results.length > 0 && (
                <div className="space-y-2">
                  {selectedSkill.eligibilityDetail.env.results.map(r => (
                    <EnvConfigRow key={r.name} envName={r.name} configured={r.found} onSaved={loadSkills} />
                  ))}
                </div>
              )}

              {/* 缺失依赖 + 有安装命令：显示安装按钮 */}
              {selectedSkill.eligibilityDetail?.dependencies.passed === false && selectedSkill.frontmatter.install && Object.keys(selectedSkill.frontmatter.install).length > 0 && (
                <div className="pt-2 border-t border-border/50 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Download className="h-3.5 w-3.5" />
                    {t.skills.install}
                  </div>
                  {Object.entries(selectedSkill.frontmatter.install).map(([method, command]) => (
                    <InstallButton key={method} method={method} command={command} skillName={selectedSkill.name} onInstalled={loadSkills} />
                  ))}
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="grid gap-4">
              {selectedSkill.frontmatter.version && (
                <InfoRow label={t.skills.version} value={selectedSkill.frontmatter.version} />
              )}
              <InfoRow label={t.skills.path} value={
                <span className="flex items-center gap-1 font-mono text-xs">
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  <span className="truncate">{selectedSkill.path}</span>
                </span>
              } />
              {selectedSkill.frontmatter.os && selectedSkill.frontmatter.os.length > 0 && (
                <InfoRow label={t.skills.os} value={
                  <span className="flex items-center gap-1.5">
                    <Globe className="h-3 w-3 shrink-0" />
                    {selectedSkill.frontmatter.os.map(os => (
                      <Badge key={os} variant="outline" className="text-xs">{os}</Badge>
                    ))}
                  </span>
                } />
              )}
              {selectedSkill.frontmatter.dependencies && selectedSkill.frontmatter.dependencies.length > 0 && (
                <InfoRow label={t.skills.dependencies} value={
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Terminal className="h-3 w-3 shrink-0" />
                    {selectedSkill.frontmatter.dependencies.map(dep => (
                      <Badge key={dep} variant="outline" className="text-xs font-mono">{dep}</Badge>
                    ))}
                  </span>
                } />
              )}
              {selectedSkill.frontmatter.env && selectedSkill.frontmatter.env.length > 0 && (
                <InfoRow label={t.skills.envVars} value={
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Key className="h-3 w-3 shrink-0" />
                    {selectedSkill.frontmatter.env.map(env => (
                      <Badge key={env} variant="outline" className="text-xs font-mono">{env}</Badge>
                    ))}
                  </span>
                } />
              )}
              {selectedSkill.frontmatter.tools && selectedSkill.frontmatter.tools.length > 0 && (
                <InfoRow label={t.skills.tools} value={
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Wrench className="h-3 w-3 shrink-0" />
                    {selectedSkill.frontmatter.tools.map(tool => (
                      <Badge key={tool} variant="outline" className="text-xs">{tool}</Badge>
                    ))}
                  </span>
                } />
              )}
            </div>

            {/* Content */}
            {selectedSkill.content && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  {t.skills.content}
                </h3>
                <pre className="rounded-md border border-border bg-muted/30 p-4 text-sm overflow-x-auto whitespace-pre-wrap font-mono">
                  {selectedSkill.content}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Puzzle className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.skills.selectSkill}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 环境变量配置行：已配置显示掩码+编辑，未配置显示输入框 */
function EnvConfigRow({ envName, configured, onSaved }: { envName: string; configured: boolean; onSaved: () => void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(!configured)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const handleSave = async () => {
    if (!value.trim()) return
    setStatus('saving')
    try {
      await configureSkillEnv(envName, value.trim())
      setStatus('saved')
      setEditing(false)
      setValue('')
      onSaved()
    } catch {
      setStatus('error')
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <code className="text-xs font-mono shrink-0">{envName}</code>
        <span className="flex-1 text-xs text-muted-foreground font-mono">••••••••</span>
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
      <Key className={cn("h-3.5 w-3.5 shrink-0", configured ? "text-green-400" : "text-yellow-400")} />
      <code className="text-xs font-mono shrink-0">{envName}</code>
      <Input
        type="password"
        placeholder={t.skills.envPlaceholder}
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus('idle') }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
        className="h-7 text-xs flex-1"
        disabled={status === 'saving'}
        autoFocus
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={handleSave}
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

/** 安装按钮：复制命令 + 一键安装 */
function InstallButton({ method, command, skillName, onInstalled }: { method: string; command: string; skillName: string; onInstalled: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<'idle' | 'installing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleInstall = async () => {
    setStatus('installing')
    setErrorMsg('')
    try {
      const result = await installSkill(skillName, method)
      if (result.ok) {
        setStatus('success')
        onInstalled()
      } else {
        setStatus('error')
        setErrorMsg(result.stderr || `Exit code: ${result.exitCode}`)
      }
    } catch {
      setStatus('error')
      setErrorMsg('Request failed')
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
          title="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleInstall}
          disabled={status === 'installing' || status === 'success'}
          className="h-7 px-2 text-xs"
        >
          {status === 'installing' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          {status === 'success' && <Check className="h-3 w-3 text-green-400 mr-1" />}
          {status === 'success' ? t.skills.installSuccess : status === 'installing' ? t.skills.installing : t.skills.install}
        </Button>
      </div>
      {status === 'error' && errorMsg && (
        <pre className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">{errorMsg}</pre>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm max-w-[65%] text-right">{value}</span>
    </div>
  )
}
