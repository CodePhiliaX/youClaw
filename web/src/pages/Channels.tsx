import { useState, useEffect, useCallback } from 'react'
import {
  Radio, CheckCircle, Save, Eye, EyeOff,
  ExternalLink, RefreshCw, Plus, Trash2,
  Power, PowerOff, AlertTriangle, Pencil, Check, X,
} from 'lucide-react'
import {
  getChannels, getChannelTypes, createChannel,
  updateChannel, deleteChannel, connectChannel, disconnectChannel,
} from '../api/client'
import type { ChannelInstance, ChannelTypeInfo } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDragRegion } from "@/hooks/useDragRegion"

export function Channels() {
  const { t } = useI18n()
  const drag = useDragRegion()
  const [channels, setChannels] = useState<ChannelInstance[]>([])
  const [channelTypes, setChannelTypes] = useState<ChannelTypeInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

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
    getChannelTypes().then(setChannelTypes).catch(() => {})
    const interval = setInterval(fetchChannels, 5000)
    return () => clearInterval(interval)
  }, [fetchChannels])

  const selectedChannel = channels.find((c) => c.id === selected)

  return (
    <div className="flex h-full">
      {/* Left: Channel list */}
      <SidePanel>
        <div className="h-12 shrink-0 px-3 border-b border-border flex items-center justify-between" {...drag}>
          <h2 className="font-semibold text-sm">{t.channels.title}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreate(true)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title={t.channels.addChannel}
              data-testid="channel-create-btn"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={fetchChannels}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title={t.channels.refresh}
              data-testid="channel-refresh-btn"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSelected(ch.id)}
              data-testid="channel-item"
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
                    : ch.enabled
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-zinc-500/20 text-zinc-400',
                )}
              >
                {ch.connected ? (
                  <CheckCircle className="h-4 w-4" />
                ) : ch.enabled && ch.error ? (
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
                    : !ch.enabled
                      ? t.channels.disabled
                      : ch.error
                        ? t.channels.error
                        : t.channels.disconnected}
                </div>
              </div>
            </button>
          ))}
          {channels.length === 0 && !loading && (
            <div className="text-center text-xs text-muted-foreground py-8" data-testid="channel-empty">
              {t.channels.noChannels}
            </div>
          )}
        </div>
      </SidePanel>

      {/* Right: Details / Create */}
      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <CreateChannelForm
            t={t}
            types={channelTypes}
            onCreated={() => {
              setShowCreate(false)
              fetchChannels()
            }}
            onCancel={() => setShowCreate(false)}
          />
        ) : selectedChannel ? (
          <ChannelDetail
            t={t}
            channel={selectedChannel}
            typeInfo={channelTypes.find((ct) => ct.type === selectedChannel.type)}
            onUpdated={fetchChannels}
            onDeleted={() => {
              setSelected(null)
              fetchChannels()
            }}
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

// === Create Channel form ===
function CreateChannelForm({
  t,
  types,
  onCreated,
  onCancel,
}: {
  t: ReturnType<typeof useI18n>['t']
  types: ChannelTypeInfo[]
  onCreated: () => void
  onCancel: () => void
}) {
  const visibleTypes = types.filter((t) => !t.hidden)
  const [selectedType, setSelectedType] = useState('')
  const [label, setLabel] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const typeInfo = visibleTypes.find((t) => t.type === selectedType)

  useEffect(() => {
    if (typeInfo) {
      setLabel(typeInfo.label)
      setConfigValues({})
    }
  }, [selectedType])

  const handleCreate = async () => {
    if (!selectedType) return
    setCreating(true)
    setError('')
    try {
      await createChannel({
        type: selectedType,
        label,
        config: configValues,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">{t.channels.addChannel}</h1>

      {/* Select type */}
      <div>
        <label className="text-xs font-medium mb-1.5 block">{t.channels.channelType}</label>
        <Select value={selectedType || '__none__'} onValueChange={(v) => setSelectedType(v === '__none__' ? '' : v)}>
          <SelectTrigger data-testid="channel-select-type" className="w-full">
            <SelectValue placeholder={t.channels.selectType} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t.channels.selectType}</SelectItem>
            {visibleTypes.map((ct) => (
              <SelectItem key={ct.type} value={ct.type}>{ct.label} - {ct.description}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {typeInfo && (
        <>
          {/* Label */}
          <div>
            <label className="text-xs font-medium mb-1.5 block">{t.channels.labelField}</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="channel-input-label"
            />
          </div>

          {/* Config fields */}
          {typeInfo.configFields.map((field) => (
            <div key={field.key}>
              <label className="text-xs font-medium mb-1.5 block">{field.label}</label>
              <input
                type={field.secret ? 'password' : 'text'}
                value={configValues[field.key] ?? ''}
                onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid={`channel-input-config-${field.key}`}
              />
            </div>
          ))}
        </>
      )}

      {error && (
        <div className="text-sm text-red-400" data-testid="channel-form-error">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={creating || !selectedType}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          data-testid="channel-submit-btn"
        >
          {creating ? t.channels.creating : t.common.create}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent/50 transition-colors"
          data-testid="channel-cancel-btn"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  )
}

// === Channel detail view ===
function ChannelDetail({
  t,
  channel,
  typeInfo,
  onUpdated,
  onDeleted,
}: {
  t: ReturnType<typeof useI18n>['t']
  channel: ChannelInstance
  typeInfo?: ChannelTypeInfo
  onUpdated: () => void
  onDeleted: () => void
}) {
  const [actionLoading, setActionLoading] = useState('')
  const [actionError, setActionError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(channel.label)

  const handleConnect = async () => {
    setActionLoading('connect')
    setActionError('')
    try {
      await connectChannel(channel.id)
      onUpdated()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading('')
    }
  }

  const handleDisconnect = async () => {
    setActionLoading('disconnect')
    setActionError('')
    try {
      await disconnectChannel(channel.id)
      onUpdated()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading('')
    }
  }

  const handleDelete = async () => {
    setActionLoading('delete')
    setActionError('')
    try {
      await deleteChannel(channel.id)
      onDeleted()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading('')
      setConfirmDelete(false)
    }
  }

  const handleSaveLabel = async () => {
    const trimmed = labelDraft.trim()
    if (!trimmed || trimmed === channel.label) {
      setEditingLabel(false)
      setLabelDraft(channel.label)
      return
    }
    setActionLoading('label')
    setActionError('')
    try {
      await updateChannel(channel.id, { label: trimmed })
      setEditingLabel(false)
      onUpdated()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading('')
    }
  }

  const handleToggleEnabled = async () => {
    setActionLoading('toggle')
    setActionError('')
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled })
      onUpdated()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionLoading('')
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
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
            {editingLabel ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveLabel()
                    if (e.key === 'Escape') { setEditingLabel(false); setLabelDraft(channel.label) }
                  }}
                  className="text-xl font-semibold bg-muted border border-border rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="channel-label-input"
                />
                <button
                  onClick={handleSaveLabel}
                  disabled={actionLoading === 'label'}
                  className="p-1 rounded-md text-green-400 hover:bg-green-500/10 transition-colors"
                  data-testid="channel-label-save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { setEditingLabel(false); setLabelDraft(channel.label) }}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent/50 transition-colors"
                  data-testid="channel-label-cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1
                className="text-xl font-semibold group/label flex items-center gap-1.5 cursor-pointer"
                onClick={() => { setEditingLabel(true); setLabelDraft(channel.label) }}
                data-testid="channel-label-display"
              >
                {channel.label}
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover/label:opacity-100 transition-opacity" />
              </h1>
            )}
            <p className="text-sm text-muted-foreground font-mono">{channel.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {channel.connected ? (
          <button
            onClick={handleDisconnect}
            disabled={!!actionLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
            data-testid="channel-disconnect-btn"
          >
            <PowerOff className="h-3.5 w-3.5" />
            {t.channels.disconnect}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={!!actionLoading || !channel.enabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
            data-testid="channel-connect-btn"
          >
            <Power className="h-3.5 w-3.5" />
            {t.channels.connect}
          </button>
        )}
        <button
          onClick={handleToggleEnabled}
          disabled={!!actionLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
          data-testid="channel-toggle-btn"
        >
          {channel.enabled ? t.channels.disable : t.channels.enable}
        </button>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
            data-testid="channel-delete-btn"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.common.delete}
          </button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-red-400">{t.channels.confirmDelete}</span>
            <button
              onClick={handleDelete}
              disabled={!!actionLoading}
              className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              data-testid="channel-confirm-delete-btn"
            >
              {t.common.delete}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent/50 transition-colors"
              data-testid="channel-cancel-delete-btn"
            >
              {t.common.cancel}
            </button>
          </div>
        )}
      </div>

      {/* Action error */}
      {actionError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-3" data-testid="channel-action-error">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-400">{actionError}</div>
        </div>
      )}

      {/* Connection error */}
      {channel.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-400">{channel.error}</div>
        </div>
      )}

      {/* Status info */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCard
          label={t.channels.status}
          value={
            channel.connected
              ? t.channels.connected
              : !channel.enabled
                ? t.channels.disabled
                : t.channels.disconnected
          }
          color={channel.connected ? 'green' : !channel.enabled ? 'zinc' : 'yellow'}
        />
        <InfoCard
          label={t.channels.chatIdPrefix}
          value={channel.chatIdPrefix || '-'}
          mono
        />
      </div>

      {/* Config editor */}
      {typeInfo && (
        <div>
          <h2 className="text-sm font-semibold mb-3">{t.channels.configuration}</h2>
          <div className="space-y-3">
            {typeInfo.configFields.map((field) => (
              <ConfigFieldEditor
                key={field.key}
                t={t}
                channelId={channel.id}
                field={field}
                currentValue={channel.config[field.key] ?? ''}
                isConfigured={channel.configuredFields.includes(field.key)}
                onSaved={onUpdated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// === Single config field editor ===
function ConfigFieldEditor({
  t,
  channelId,
  field,
  currentValue,
  isConfigured,
  onSaved,
}: {
  t: ReturnType<typeof useI18n>['t']
  channelId: string
  field: { key: string; label: string; placeholder: string; secret: boolean }
  currentValue: string
  isConfigured: boolean
  onSaved: () => void
}) {
  const [value, setValue] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setValue(field.secret ? '' : currentValue)
  }, [field.key, field.secret, currentValue])

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      await updateChannel(channelId, {
        config: { [field.key]: value.trim() },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium">
          {field.label}
          <span className="text-muted-foreground ml-1.5 font-mono">{field.key}</span>
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
            type={field.secret && !showSecret ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              field.secret && isConfigured
                ? t.channels.secretConfigured
                : field.placeholder || field.key
            }
            className="w-full px-3 py-2 text-sm rounded-md bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-ring pr-10"
            data-testid={`channel-input-config-${field.key}`}
          />
          {field.secret && (
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
          data-testid={`channel-config-save-${field.key}`}
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? t.channels.saving : saved ? t.channels.saved : t.common.save}
        </button>
      </div>
      {saveError && (
        <div className="text-xs text-red-400 mt-1" data-testid={`channel-config-error-${field.key}`}>{saveError}</div>
      )}
    </div>
  )
}

// === Info card ===
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
