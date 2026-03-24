import { useState, useEffect, useCallback, type FormEvent, type ReactNode } from 'react'
import {
  createBrowserProfile,
  deleteBrowserProfile,
  restartBrowserProfile,
  startBrowserProfile,
  stopBrowserProfile,
} from '../api/client'
import type { BrowserProfileDTO } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { useChatContext } from '../hooks/chatCtx'
import { SidePanel } from '@/components/layout/SidePanel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FolderOpen, Globe, Link, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'
import { useDragRegion } from '@/hooks/useDragRegion'

type Notice = { type: 'success' | 'error'; text: string } | null

export function BrowserProfiles() {
  const { t } = useI18n()
  const {
    browserProfiles: profiles,
    refreshBrowserProfiles,
    selectedProfileId,
    setSelectedProfileId,
  } = useChatContext()
  const drag = useDragRegion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null

  const loadProfiles = useCallback(() => {
    refreshBrowserProfiles()
  }, [refreshBrowserProfiles])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const handleDelete = async (id: string) => {
    await deleteBrowserProfile(id).catch(() => {})
    if (selectedId === id) setSelectedId(null)
    if (selectedProfileId === id) setSelectedProfileId(null)
    loadProfiles()
  }

  const handleControl = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusyId(id)
    setNotice(null)
    try {
      if (action === 'start') {
        await startBrowserProfile(id)
        setNotice({ type: 'success', text: t.browser.launchSuccess })
      } else if (action === 'stop') {
        await stopBrowserProfile(id)
        setNotice({ type: 'success', text: 'Browser stopped' })
      } else {
        await restartBrowserProfile(id)
        setNotice({ type: 'success', text: 'Browser restarted' })
      }
      loadProfiles()
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : t.browser.launchFailed })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex h-full">
      <SidePanel>
        <div className="h-9 shrink-0 px-3 border-b border-[var(--subtle-border)] flex items-center justify-between" {...drag}>
          <h2 className="font-semibold text-sm">{t.browser.title}</h2>
          <button
            data-testid="browser-create-btn"
            onClick={() => {
              setSelectedId(null)
              setShowCreate(true)
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
            title={t.browser.createProfile}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {profiles.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Globe className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">{t.browser.noProfiles}</p>
                <p className="text-xs mt-1">{t.browser.noProfilesHint}</p>
              </div>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  data-testid="browser-profile-item"
                  onClick={() => {
                    setSelectedId(profile.id)
                    setShowCreate(false)
                  }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all',
                    selectedId === profile.id
                      ? 'bg-accent text-accent-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                    selectedId === profile.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-foreground">{profile.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{profile.driver}</span>
                      <span>·</span>
                      <span>{profile.runtime?.status ?? 'stopped'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SidePanel>

      <div className="flex-1 overflow-y-auto">
        {showCreate ? (
          <CreateProfileForm
            onCreated={() => {
              loadProfiles()
              setShowCreate(false)
            }}
            onCancel={() => setShowCreate(false)}
          />
        ) : selectedProfile ? (
          <ProfileDetail
            profile={selectedProfile}
            isBusy={busyId === selectedProfile.id}
            notice={selectedId === selectedProfile.id ? notice : null}
            onStart={() => handleControl(selectedProfile.id, 'start')}
            onStop={() => handleControl(selectedProfile.id, 'stop')}
            onRestart={() => handleControl(selectedProfile.id, 'restart')}
            onDelete={() => setDeleteId(selectedProfile.id)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm">{t.browser.selectProfile}</p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.browser.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>Delete this browser profile and its persisted browser data directory.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) handleDelete(deleteId)
                setDeleteId(null)
              }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProfileDetail({
  profile,
  isBusy,
  notice,
  onStart,
  onStop,
  onRestart,
  onDelete,
}: {
  profile: BrowserProfileDTO
  isBusy: boolean
  notice: Notice
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onDelete: () => void
}) {
  const runtimeStatus = profile.runtime?.status ?? 'stopped'
  const running = runtimeStatus === 'running' || runtimeStatus === 'starting'

  return (
    <div className="p-6 space-y-6" data-testid="browser-profile-detail">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold" data-testid="browser-profile-name">{profile.name}</h2>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{profile.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="browser-launch-btn"
            onClick={running ? onStop : onStart}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Stop Browser' : 'Start Browser'}
          </button>
          <button
            onClick={onRestart}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl border border-border hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Restart
          </button>
          <button
            data-testid="browser-delete-btn"
            onClick={onDelete}
            className="p-2 rounded-xl hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="Driver" value={profile.driver} />
        <InfoCard label="Runtime" value={runtimeStatus} />
        <InfoCard label="Created" value={new Date(profile.createdAt).toLocaleString()} />
        <InfoCard label="Default" value={profile.isDefault ? 'Yes' : 'No'} />
        <InfoCard
          label="Data Dir"
          value={profile.userDataDir ? (
            <span className="text-sm font-mono flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{profile.userDataDir}</span>
            </span>
          ) : 'N/A'}
        />
        <InfoCard
          label="CDP Endpoint"
          value={profile.cdpUrl ?? (profile.cdpPort ? `127.0.0.1:${profile.cdpPort}` : 'N/A')}
        />
      </div>

      {profile.runtime?.wsEndpoint && (
        <div className="rounded-2xl border border-border p-4">
          <div className="text-xs text-muted-foreground mb-1.5">WebSocket Endpoint</div>
          <div className="text-sm font-mono break-all flex items-start gap-2">
            <Link className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <span>{profile.runtime.wsEndpoint}</span>
          </div>
        </div>
      )}

      {notice && (
        <div
          data-testid="browser-launch-message"
          className={cn(
            'text-xs rounded-xl p-3 border whitespace-pre-line',
            notice.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-500'
              : 'bg-red-500/10 border-red-500/30 text-red-400',
          )}
        >
          {notice.text}
        </div>
      )}

      {profile.runtime?.lastError && (
        <div className="text-xs rounded-xl p-3 border bg-red-500/10 border-red-500/30 text-red-400 whitespace-pre-line">
          {profile.runtime.lastError}
        </div>
      )}

      <div className="text-xs text-muted-foreground bg-muted/50 rounded-2xl p-4 border border-border space-y-1">
        <p className="font-medium text-foreground mb-2">Usage</p>
        <p>1. Start the browser for a managed profile.</p>
        <p>2. Log in manually to websites that require authentication.</p>
        <p>3. The browser state is stored in the profile data directory.</p>
        <p>4. Bind this profile to an agent or select it in chat.</p>
        <p>5. Browser MCP tools will reuse the same persisted session.</p>
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      <div className="text-sm font-semibold break-all">{value}</div>
    </div>
  )
}

function CreateProfileForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [driver, setDriver] = useState<'managed' | 'remote-cdp'>('managed')
  const [cdpUrl, setCdpUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await createBrowserProfile({
        name: name.trim(),
        driver,
        cdpUrl: driver === 'remote-cdp' ? cdpUrl.trim() || null : undefined,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create profile')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">{t.browser.createTitle}</h2>
      <form onSubmit={handleSubmit} className="space-y-5 max-w-lg">
        <div>
          <label className="block text-xs font-medium mb-1.5">{t.browser.profileName}</label>
          <input
            type="text"
            data-testid="browser-input-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.browser.profileNamePlaceholder}
            className="w-full px-3 py-2 text-sm rounded-xl bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">Driver</label>
          <select
            value={driver}
            onChange={(e) => setDriver(e.target.value as 'managed' | 'remote-cdp')}
            className="w-full px-3 py-2 text-sm rounded-xl bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="managed">Managed Chromium</option>
            <option value="remote-cdp">Remote CDP</option>
          </select>
        </div>

        {driver === 'remote-cdp' && (
          <div>
            <label className="block text-xs font-medium mb-1.5">CDP URL</label>
            <input
              type="text"
              value={cdpUrl}
              onChange={(e) => setCdpUrl(e.target.value)}
              placeholder="http://127.0.0.1:9222 or ws://host/devtools/browser/..."
              className="w-full px-3 py-2 text-sm rounded-xl bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {error && <p data-testid="browser-form-error" className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            data-testid="browser-submit-btn"
            disabled={submitting || !name.trim()}
            className="px-5 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? t.browser.creating : t.common.create}
          </button>
          <button
            type="button"
            data-testid="browser-cancel-btn"
            onClick={onCancel}
            className="px-5 py-2 text-sm font-medium rounded-xl border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </form>
    </div>
  )
}
