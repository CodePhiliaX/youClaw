import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getSettings,
  updateSettings,
  type SettingsDTO,
} from '@/api/client'

export function MarketplacePanel() {
  const { t } = useI18n()
  const refreshRegistrySources = useAppStore((s) => s.refreshRegistrySources)
  const [settingsState, setSettingsState] = useState<SettingsDTO | null>(null)
  const [tokenValue, setTokenValue] = useState('')
  const [hasConfiguredToken, setHasConfiguredToken] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [settingsError, setSettingsError] = useState('')

  useEffect(() => {
    let cancelled = false
    setSettingsLoading(true)
    getSettings()
      .then((settings) => {
        if (!cancelled) {
          setSettingsState(settings)
          setTokenValue('')
          setHasConfiguredToken(Boolean(settings.registrySources.clawhub.token))
          setSettingsError('')
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : t.skills.requestFailed)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSettingsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [t.skills.requestFailed])

  const updateRegistryToken = useCallback((value: string) => {
    setTokenValue(value)
    setSettingsMessage('')
    setSettingsError('')
  }, [])

  const handleSaveRegistrySettings = useCallback(async () => {
    if (!settingsState) return
    setSettingsSaving(true)
    setSettingsMessage('')
    setSettingsError('')
    try {
      const normalizedToken = tokenValue.trim()
      const updated = await updateSettings({
        registrySources: {
          clawhub: normalizedToken ? { token: normalizedToken } : {},
          tencent: {
            ...settingsState.registrySources.tencent,
          },
        },
      })
      setSettingsState(updated)
      setTokenValue('')
      setHasConfiguredToken(Boolean(normalizedToken || updated.registrySources.clawhub.token))
      await refreshRegistrySources()
      setSettingsMessage(t.settings.registrySaved)
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : t.skills.requestFailed)
    } finally {
      setSettingsSaving(false)
    }
  }, [refreshRegistrySources, settingsState, t.settings.registrySaved, t.skills.requestFailed, tokenValue])

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
          {t.settings.marketplace}
        </h4>
        <p className="text-xs text-muted-foreground">{t.settings.marketplaceHint}</p>
      </div>

      {settingsLoading && <p className="text-sm text-muted-foreground">{t.common.loading}</p>}

      {!settingsLoading && settingsState && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border p-4 space-y-4 max-w-2xl">
            <div>
              <div className="text-sm font-medium">ClawHub</div>
              <div className="text-xs text-muted-foreground mt-1">{t.settings.marketplaceSourceClawhubHint}</div>
            </div>
            <label className="space-y-2 block">
              <span className="text-xs font-medium text-muted-foreground">{t.settings.registryToken}</span>
              {hasConfiguredToken && !tokenValue && (
                <div className="text-xs text-green-500">{t.settings.marketplaceTokenConfigured}</div>
              )}
              <Input
                type="password"
                value={tokenValue}
                onChange={(event) => updateRegistryToken(event.target.value)}
                placeholder={t.settings.marketplaceTokenPlaceholder}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void handleSaveRegistrySettings()} disabled={settingsSaving}>
              {settingsSaving ? t.settings.marketplaceSaving : t.settings.marketplaceSave}
            </Button>
            {settingsMessage && <span className="text-sm text-green-500">{settingsMessage}</span>}
            {settingsError && <span className="text-sm text-red-400">{settingsError}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
