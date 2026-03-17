import { useState, useEffect, useCallback } from 'react'
import {
  getBrowserProfiles,
  createBrowserProfile,
  deleteBrowserProfile,
  launchBrowserProfile,
  BrowserLaunchError,
} from '../api/client'
import type { BrowserProfileDTO } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Globe, Plus, Trash2, Play, FolderOpen } from 'lucide-react'
import { useDragRegion } from "@/hooks/useDragRegion"

export function BrowserProfiles() {
  const { t } = useI18n()
  const drag = useDragRegion()
  const [profiles, setProfiles] = useState<BrowserProfileDTO[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null

  const loadProfiles = useCallback(() => {
    getBrowserProfiles().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const handleDelete = async (id: string) => {
    await deleteBrowserProfile(id).catch(() => {})
    if (selectedId === id) setSelectedId(null)
    loadProfiles()
  }

  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [launchMessage, setLaunchMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleLaunch = async (id: string) => {
    setLaunchingId(id)
    setLaunchMessage(null)
    try {
      await launchBrowserProfile(id)
      setLaunchMessage({ type: 'success', text: t.browser.launchSuccess })
    } catch (err) {
      if (err instanceof BrowserLaunchError && err.code === 'AGENT_BROWSER_NOT_FOUND') {
        const hint = err.installHint ? `\n${t.browser.installHint}: ${err.installHint}` : ''
        setLaunchMessage({ type: 'error', text: `${t.browser.notInstalled}${hint}` })
      } else {
        const detail = err instanceof Error ? err.message : ''
        setLaunchMessage({ type: 'error', text: detail || t.browser.launchFailed })
      }
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <div className="flex h-full">
      {/* Left panel — Profile list */}
      <SidePanel>
        <div className="h-12 shrink-0 px-3 border-b border-[var(--subtle-border)] flex items-center justify-between" {...drag}>
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
                      : 'text-muted-foreground hover:bg-accent/50'
                  )}
                >
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                    selectedId === profile.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  )}>
                    <Globe className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-foreground">
                      {profile.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(profile.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SidePanel>

      {/* Right panel */}
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
            onLaunch={() => handleLaunch(selectedProfile.id)}
            onDelete={() => setDeleteId(selectedProfile.id)}
            isLaunching={launchingId === selectedProfile.id}
            launchMessage={selectedId === selectedProfile.id ? launchMessage : null}
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
            <AlertDialogDescription>{''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) handleDelete(deleteId); setDeleteId(null) }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== Profile details =====

function ProfileDetail({
  profile,
  onLaunch,
  onDelete,
  isLaunching,
  launchMessage,
}: {
  profile: BrowserProfileDTO
  onLaunch: () => void
  onDelete: () => void
  isLaunching: boolean
  launchMessage: { type: 'success' | 'error'; text: string } | null
}) {
  const { t } = useI18n()

  return (
    <div className="p-6 space-y-6" data-testid="browser-profile-detail">
      <div className="flex items-center justify-between">
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
            onClick={onLaunch}
            disabled={isLaunching}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {isLaunching ? t.browser.launching : t.browser.launch}
          </button>
          <button
            data-testid="browser-delete-btn"
            onClick={onDelete}
            className="p-2 rounded-xl hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-colors"
            title={t.common.delete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border p-4">
          <div className="text-xs text-muted-foreground mb-1.5">{t.browser.created}</div>
          <div className="text-sm font-semibold">{new Date(profile.created_at).toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <div className="text-xs text-muted-foreground mb-1.5">{t.browser.dataDir}</div>
          <div className="text-sm font-mono flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="truncate">browser-profiles/{profile.id}/</span>
          </div>
        </div>
      </div>

      {launchMessage && (
        <div
          data-testid="browser-launch-message"
          className={cn(
            'text-xs rounded-xl p-3 border whitespace-pre-line',
            launchMessage.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-500'
              : 'bg-red-500/10 border-red-500/30 text-red-400',
          )}
        >
          {launchMessage.text}
        </div>
      )}

      <div className="text-xs text-muted-foreground bg-muted/50 rounded-2xl p-4 border border-border space-y-1">
        <p className="font-medium text-foreground mb-2">Usage</p>
        <p>1. Click "Launch Browser" to open a headed browser window</p>
        <p>2. Manually log in to the required websites in the browser</p>
        <p>3. Close the browser; login state is saved automatically</p>
        <p>4. Bind this Profile in Agent details, or select it during chat</p>
        <p>5. The Agent will automatically reuse the saved login state</p>
      </div>
    </div>
  )
}

// ===== Create form =====

function CreateProfileForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await createBrowserProfile(name.trim())
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
