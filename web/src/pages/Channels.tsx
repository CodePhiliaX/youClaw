import { useState, useEffect, useCallback } from 'react'
import {
  Radio, CheckCircle, XCircle, Save, Eye, EyeOff,
  ExternalLink, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { getChannels, updateChannelEnv } from '../api/client'
import type { ChannelDefinition } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'

export function Channels() {
  const { t } = useI18n()
  const [channels, setChannels] = useState<ChannelDefinition[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchChannels = useCallback(() => {
    getChannels()
      .then((list) => {
        setChannels(list)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchChannels()
    const interval = setInterval(fetchChannels, 5000)
    return () => clearInterval(interval)
  }, [fetchChannels])

  const selectedChannel = channels.find((c) => c.id === selected)

  return (
    <div className="flex h-full">
      {/* 左侧：Channel 列表 */}
      <div className="w-[260px] border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-sm">{t.channels.title}</h2>
          <button
            onClick={fetchChannels}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            title={t.channels.refresh}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSelected(ch.id)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 text-sm rounded-md text-left transition-colors group',
                selected === ch.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                  ch.connected
                    ? 'bg-green-500/20 text-green-400'
                    : ch.configured
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-zinc-500/20 text-zinc-400',
                )}
              >
                {ch.connected ? (
                  <CheckCircle className="h-4 w-4" />
                ) : ch.configured ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <Radio className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{ch.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {ch.connected
                    ? t.channels.connected
                    : ch.configured
                      ? t.channels.needsRestart
                      : t.channels.notConfigured}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：详情 + 配置 */}
      <div className="flex-1 overflow-y-auto">
        {selectedChannel ? (
          <ChannelDetail
            t={t}
            channel={selectedChannel}
            onEnvSaved={fetchChannels}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Radio className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.channels.selectChannel}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// === Channel 详情视图 ===
function ChannelDetail({
  t,
  channel,
  onEnvSaved,
}: {
  t: ReturnType<typeof useI18n>['t']
  channel: ChannelDefinition
  onEnvSaved: () => void
}) {
  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center',
              channel.connected
                ? 'bg-green-500/15 text-green-400'
                : 'bg-zinc-500/15 text-zinc-400',
            )}
          >
            {channel.connected ? (
              <CheckCircle className="h-6 w-6" />
            ) : (
              <Radio className="h-6 w-6" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-semibold">{channel.label}</h1>
            <p className="text-sm text-muted-foreground">{channel.description}</p>
          </div>
        </div>
        {channel.docsUrl && (
          <a
            href={channel.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t.channels.docs}
          </a>
        )}
      </div>

      {/* 状态信息 */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCard
          label={t.channels.status}
          value={
            channel.connected
              ? t.channels.connected
              : channel.configured
                ? t.channels.needsRestart
                : t.channels.notConfigured
          }
          color={channel.connected ? 'green' : channel.configured ? 'yellow' : 'zinc'}
        />
        <InfoCard
          label={t.channels.chatIdPrefix}
          value={channel.chatIdPrefix}
          mono
        />
      </div>

      {/* 环境变量配置 */}
      <div>
        <h2 className="text-sm font-semibold mb-3">{t.channels.configuration}</h2>
        <div className="space-y-3">
          {channel.envKeys.map((envKey) => (
            <EnvKeyEditor
              key={envKey.key}
              t={t}
              envKey={envKey}
              envValue={channel.envValues[envKey.key]}
              onSaved={onEnvSaved}
            />
          ))}
        </div>
      </div>

      {/* 重启提示 */}
      {channel.configured && !channel.connected && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-yellow-400">{t.channels.restartRequired}</p>
            <p className="text-muted-foreground text-xs mt-1">{t.channels.restartHint}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// === 单个环境变量编辑器 ===
function EnvKeyEditor({
  t,
  envKey,
  envValue,
  onSaved,
}: {
  t: ReturnType<typeof useI18n>['t']
  envKey: { key: string; label: string; placeholder: string; secret: boolean }
  envValue?: { value: string; configured: boolean }
  onSaved: () => void
}) {
  const [value, setValue] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // 初始化值
  useEffect(() => {
    if (envValue && !envKey.secret) {
      setValue(envValue.value)
    } else {
      setValue('')
    }
  }, [envKey.key, envKey.secret, envValue])

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await updateChannelEnv(envKey.key, value.trim())
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch {
      // 静默
    } finally {
      setSaving(false)
    }
  }

  const isConfigured = envValue?.configured ?? false

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium">
          {envKey.label}
          <span className="text-muted-foreground ml-1.5 font-mono">{envKey.key}</span>
        </label>
        {isConfigured && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">
            {t.channels.configured}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={envKey.secret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              envKey.secret && isConfigured
                ? t.channels.secretConfigured
                : envKey.placeholder || envKey.key
            }
            className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring pr-10"
          />
          {envKey.secret && (
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? t.channels.saving : saved ? t.channels.saved : t.common.save}
        </button>
      </div>
    </div>
  )
}

// === 信息卡片 ===
function InfoCard({
  label,
  value,
  color,
  mono,
}: {
  label: string
  value: string
  color?: 'green' | 'yellow' | 'zinc'
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-sm font-medium mt-1',
          color === 'green' && 'text-green-400',
          color === 'yellow' && 'text-yellow-400',
          color === 'zinc' && 'text-muted-foreground',
          mono && 'font-mono',
        )}
      >
        {value}
      </p>
    </div>
  )
}
