import { useState, useEffect, useCallback } from 'react'
import {
  getBrowserProfiles,
  createBrowserProfile,
  deleteBrowserProfile,
  launchBrowserProfile,
} from '../api/client'
import type { BrowserProfileDTO } from '../api/client'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { Globe, Plus, Trash2, Play, FolderOpen } from 'lucide-react'

export function BrowserProfiles() {
  const { t } = useI18n()
  const [profiles, setProfiles] = useState<BrowserProfileDTO[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null

  const loadProfiles = useCallback(() => {
    getBrowserProfiles().then(setProfiles).catch(() => {})
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const handleDelete = async (id: string) => {
    if (!confirm(t.browser.confirmDelete)) return
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
    } catch {
      setLaunchMessage({ type: 'error', text: t.browser.launchFailed })
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <div className="flex h-full">
      {/* 左面板 — Profile 列表 */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <h1 className="text-sm font-semibold">{t.browser.title}</h1>
              <span className="text-xs text-muted-foreground">({profiles.length})</span>
            </div>
            <button
              data-testid="browser-create-btn"
              onClick={() => {
                setSelectedId(null)
                setShowCreate(true)
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3 w-3" />
              {t.browser.createProfile}
            </button>
          </div>
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
            <div className="divide-y divide-border">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  data-testid="browser-profile-item"
                  onClick={() => {
                    setSelectedId(profile.id)
                    setShowCreate(false)
                  }}
                  className={cn(
                    'px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/30',
                    selectedId === profile.id && 'bg-accent/50'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate max-w-[200px]">
                      {profile.name}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(profile.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右面板 */}
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
            onDelete={() => handleDelete(selectedProfile.id)}
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
    </div>
  )
}

// ===== Profile 详情 =====

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
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold" data-testid="browser-profile-name">{profile.name}</h2>
        <div className="flex items-center gap-1">
          <button
            data-testid="browser-launch-btn"
            onClick={onLaunch}
            disabled={isLaunching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {isLaunching ? t.browser.launching : t.browser.launch}
          </button>
          <button
            data-testid="browser-delete-btn"
            onClick={onDelete}
            className="p-2 rounded hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-colors"
            title={t.common.delete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">{t.browser.profileId}</div>
          <div className="text-sm font-mono text-xs">{profile.id}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">{t.browser.created}</div>
          <div className="text-sm">{new Date(profile.created_at).toLocaleString()}</div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-muted-foreground mb-0.5">{t.browser.dataDir}</div>
          <div className="text-sm font-mono text-xs flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            browser-profiles/{profile.id}/
          </div>
        </div>
      </div>

      {launchMessage && (
        <div
          data-testid="browser-launch-message"
          className={cn(
            'text-xs rounded p-2.5 border',
            launchMessage.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400',
          )}
        >
          {launchMessage.text}
        </div>
      )}

      <div className="text-xs text-muted-foreground bg-accent/20 rounded p-3 border border-border">
        <p className="mb-1">使用方法：</p>
        <p>1. 点击"启动浏览器"打开 headed 浏览器窗口</p>
        <p>2. 在浏览器中手动登录需要的网站</p>
        <p>3. 关闭浏览器，登录状态会自动保存</p>
        <p>4. 在 Agent 详情页绑定此 Profile，或在聊天时临时选择</p>
        <p>5. Agent 后续使用浏览器时将自动复用登录状态</p>
      </div>
    </div>
  )
}

// ===== 创建表单 =====

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
      <h2 className="text-lg font-semibold mb-4">{t.browser.createTitle}</h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">{t.browser.profileName}</label>
          <input
            type="text"
            data-testid="browser-input-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.browser.profileNamePlaceholder}
            className="w-full px-3 py-2 text-sm rounded-md bg-accent/30 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
        </div>

        {error && <p data-testid="browser-form-error" className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            data-testid="browser-submit-btn"
            disabled={submitting || !name.trim()}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? t.browser.creating : t.common.create}
          </button>
          <button
            type="button"
            data-testid="browser-cancel-btn"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
      </form>
    </div>
  )
}
