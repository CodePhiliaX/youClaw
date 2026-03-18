import { useState, type ReactNode } from 'react'
import type { MarketplaceSkill, MarketplaceSkillDetail } from '../api/client'
import { getMarketplaceSkill, installRecommendedSkill, uninstallRecommendedSkill, updateMarketplaceSkill } from '../api/client'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { MarketplaceInstallDialog } from '../components/MarketplaceInstallDialog'
import { useI18n } from '../i18n'
import { Puzzle, Download, Loader2, Trash2, RefreshCw } from 'lucide-react'

function formatMarketplaceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

export function MarketplaceCard({
  skill: initialSkill,
  onChanged,
  extraActions,
}: {
  skill: MarketplaceSkill
  onChanged: () => void
  extraActions?: ReactNode
}) {
  const { t } = useI18n()
  const [skill, setSkill] = useState(initialSkill)
  const [status, setStatus] = useState<'idle' | 'installing' | 'updating' | 'uninstalling' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmDetail, setConfirmDetail] = useState<MarketplaceSkillDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const handleInstall = async () => {
    setStatus('installing')
    setErrorMsg('')
    try {
      const result = await installRecommendedSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        setSkill(s => ({ ...s, installed: true, hasUpdate: false }))
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.installFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.installFailed)
    }
  }

  const handleUpdate = async () => {
    setStatus('updating')
    setErrorMsg('')
    try {
      const result = await updateMarketplaceSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        setSkill(s => ({ ...s, hasUpdate: false, installedVersion: s.latestVersion ?? s.installedVersion }))
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.updateFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.updateFailed)
    }
  }

  const handleConfirmInstall = async () => {
    setLoadingDetail(true)
    setErrorMsg('')
    try {
      const detail = await getMarketplaceSkill(skill.slug)
      setConfirmDetail(detail)
    } catch {
      // Fallback: show dialog with basic info from the card
      setConfirmDetail({
        ...skill,
        ownerHandle: null,
        ownerDisplayName: null,
        ownerImage: null,
        moderation: null,
      })
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleUninstall = async () => {
    setStatus('uninstalling')
    setErrorMsg('')
    try {
      const result = await uninstallRecommendedSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        setSkill(s => ({ ...s, installed: false, hasUpdate: false, installedVersion: undefined }))
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.installFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.installFailed)
    }
  }

  return (
    <div
      data-testid={`marketplace-card-${skill.slug}`}
      className="rounded-xl border border-border p-4 transition-colors hover:bg-accent/20"
    >
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-sm">{skill.displayName}</div>
            {skill.installed && (
              <Badge data-testid={`marketplace-installed-badge-${skill.slug}`} variant="secondary">
                {t.skills.installed}
              </Badge>
            )}
            {skill.hasUpdate && (
              <Badge
                data-testid={`marketplace-update-badge-${skill.slug}`}
                variant="outline"
                className="text-amber-500 border-amber-500/40"
              >
                {t.skills.marketplaceUpdateAvailable}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{skill.summary}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {skill.latestVersion && (
              <span data-testid={`marketplace-latest-version-${skill.slug}`}>
                {t.skills.marketplaceVersionLabel}: {skill.latestVersion}
              </span>
            )}
            {skill.installedVersion && (
              <span data-testid={`marketplace-installed-version-${skill.slug}`}>
                {t.skills.marketplaceInstalledVersionLabel}: {skill.installedVersion}
              </span>
            )}
            {typeof skill.downloads === 'number' && (
              <span>{t.skills.marketplaceDownloadsLabel}: {skill.downloads}</span>
            )}
            {typeof skill.stars === 'number' && (
              <span>{t.skills.marketplaceStarsLabel}: {skill.stars}</span>
            )}
            {typeof skill.installsCurrent === 'number' && (
              <span>{t.skills.marketplaceInstallsLabel}: {skill.installsCurrent}</span>
            )}
            {skill.updatedAt && (
              <span>{t.skills.marketplaceUpdatedLabel}: {formatMarketplaceDate(skill.updatedAt)}</span>
            )}
          </div>

          {(skill.tags.length > 0 || skill.metadata?.os.length || skill.metadata?.systems.length) && (
            <div className="flex flex-wrap gap-2">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {skill.metadata?.os.map((os) => (
                <Badge key={`os-${os}`} variant="outline" className="text-xs">
                  {os}
                </Badge>
              ))}
              {skill.metadata?.systems.map((system) => (
                <Badge key={`sys-${system}`} variant="outline" className="text-xs">
                  {system}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-start gap-2">
          {extraActions ?? (
            <>
              {skill.installed && skill.hasUpdate && (
                <Button
                  data-testid={`marketplace-update-${skill.slug}`}
                  size="sm"
                  variant="secondary"
                  className="text-xs"
                  onClick={handleUpdate}
                  disabled={status === 'updating'}
                >
                  {status === 'updating' ? (
                    <><RefreshCw className="h-3 w-3 animate-spin mr-1" />{t.skills.updating}</>
                  ) : (
                    <><RefreshCw className="h-3 w-3 mr-1" />{t.skills.update}</>
                  )}
                </Button>
              )}
              {skill.installed ? (
                <Button
                  data-testid={`marketplace-uninstall-${skill.slug}`}
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground hover:text-red-400"
                  onClick={handleUninstall}
                  disabled={status === 'uninstalling'}
                >
                  {status === 'uninstalling' ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t.skills.uninstalling}</>
                  ) : (
                    <><Trash2 className="h-3 w-3 mr-1" />{t.skills.uninstall}</>
                  )}
                </Button>
              ) : (
                <Button
                  data-testid={`marketplace-install-${skill.slug}`}
                  size="sm"
                  variant="default"
                  className="text-xs"
                  onClick={handleConfirmInstall}
                  disabled={status === 'installing' || loadingDetail}
                >
                  {(status === 'installing' || loadingDetail) ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1" />{loadingDetail ? t.common.loading : t.skills.installing}</>
                  ) : (
                    <><Download className="h-3 w-3 mr-1" />{t.skills.installFromMarket}</>
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {status === 'error' && errorMsg && (
        <div className="text-xs text-red-400 mt-3">{errorMsg}</div>
      )}

      <MarketplaceInstallDialog
        open={!!confirmDetail}
        detail={confirmDetail}
        onOpenChange={(open) => {
          if (!open) setConfirmDetail(null)
        }}
        onConfirm={() => {
          setConfirmDetail(null)
          handleInstall()
        }}
      />
    </div>
  )
}
