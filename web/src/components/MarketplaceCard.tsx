import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { RegistrySelectableSource } from '../api/client'
import { getMarketplaceSkill, installRecommendedSkill, uninstallRecommendedSkill, updateMarketplaceSkill } from '../api/client'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { MarketplaceInstallDialog } from '../components/MarketplaceInstallDialog'
import { useI18n } from '../i18n'
import {
  toMarketplaceInstallDialogFallbackViewModel,
  toMarketplaceInstallDialogViewModel,
  type MarketplaceCardViewModel,
  type MarketplaceInstallDialogViewModel,
} from '../lib/marketplace-view-model'
import type { MarketplaceChangeEvent } from '../lib/marketplace-updates'
import { useAppStore } from '../stores/app'
import { Puzzle, Download, Loader2, Trash2, RefreshCw } from 'lucide-react'

function normalizeMarketplaceActionError(message: string, fallback: string, skillNotFoundLabel: string) {
  if (!message) {
    return fallback
  }

  const skillNotFoundMatch = message.match(/^Skill "(.+)" was not found$/)
  if (skillNotFoundMatch) {
    return skillNotFoundLabel.replace('{name}', skillNotFoundMatch[1] ?? '')
  }

  return message
}

export function MarketplaceCard({
  viewModel,
  onChanged,
  extraActions,
  hideInstalledBadge = false,
  hideCategoryBadge = false,
  statusBadges,
  onOpenInstallDialog,
  openInstallDialogDisabled = false,
  registrySource,
}: {
  viewModel: MarketplaceCardViewModel
  onChanged: (change?: MarketplaceChangeEvent) => void
  extraActions?: ReactNode
  hideInstalledBadge?: boolean
  hideCategoryBadge?: boolean
  statusBadges?: ReactNode
  onOpenInstallDialog?: () => void | Promise<void>
  openInstallDialogDisabled?: boolean
  registrySource?: RegistrySelectableSource
}) {
  const { t } = useI18n()
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [status, setStatus] = useState<'idle' | 'installing' | 'updating' | 'uninstalling'>('idle')
  const [confirmDetailViewModel, setConfirmDetailViewModel] = useState<MarketplaceInstallDialogViewModel | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const actionSource = useMemo<RegistrySelectableSource>(
    () => registrySource ?? (viewModel.source === 'tencent' ? 'tencent' : 'clawhub'),
    [registrySource, viewModel.source],
  )
  const buildMarketplaceMessage = (template: string) => template.replace('{name}', viewModel.displayName)
  const formatActionError = (message: string | undefined, fallback: string) => (
    normalizeMarketplaceActionError(message ?? '', fallback, t.skills.marketplaceSkillNotFound)
  )

  const handleInstall = async () => {
    setStatus('installing')
    try {
      const result = await installRecommendedSkill(viewModel.slug, actionSource)
      if (result.ok) {
        setStatus('idle')
        showGlobalBubble({
          message: buildMarketplaceMessage(t.skills.marketplaceInstallSuccess),
        })
        onChanged({ type: 'install', slug: viewModel.slug, source: actionSource })
      } else {
        const message = formatActionError(result.error, t.skills.installFailed)
        setStatus('idle')
        showGlobalBubble({ type: 'error', message })
      }
    } catch (error) {
      const message = formatActionError(error instanceof Error ? error.message : undefined, t.skills.installFailed)
      setStatus('idle')
      showGlobalBubble({ type: 'error', message })
    }
  }

  const handleUpdate = async () => {
    setStatus('updating')
    try {
      const result = await updateMarketplaceSkill(viewModel.slug, actionSource)
      if (result.ok) {
        setStatus('idle')
        showGlobalBubble({
          message: buildMarketplaceMessage(t.skills.marketplaceUpdateSuccess),
        })
        onChanged({ type: 'update', slug: viewModel.slug, source: actionSource })
      } else {
        const message = formatActionError(result.error, t.skills.updateFailed)
        setStatus('idle')
        showGlobalBubble({ type: 'error', message })
      }
    } catch (error) {
      const message = formatActionError(error instanceof Error ? error.message : undefined, t.skills.updateFailed)
      setStatus('idle')
      showGlobalBubble({ type: 'error', message })
    }
  }

  const handleConfirmInstall = async () => {
    setLoadingDetail(true)
    try {
      const detail = await getMarketplaceSkill(viewModel.slug, actionSource)
      setConfirmDetailViewModel(toMarketplaceInstallDialogViewModel(detail, t))
    } catch {
      setConfirmDetailViewModel(toMarketplaceInstallDialogFallbackViewModel(viewModel, t))
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleUninstall = async () => {
    setStatus('uninstalling')
    try {
      const result = await uninstallRecommendedSkill(viewModel.slug, actionSource)
      if (result.ok) {
        setStatus('idle')
        showGlobalBubble({
          message: buildMarketplaceMessage(t.skills.marketplaceUninstallSuccess),
        })
        onChanged({ type: 'uninstall', slug: viewModel.slug, source: actionSource })
      } else {
        const message = formatActionError(result.error, t.skills.uninstallFailed)
        setStatus('idle')
        showGlobalBubble({ type: 'error', message })
      }
    } catch (error) {
      const message = formatActionError(error instanceof Error ? error.message : undefined, t.skills.uninstallFailed)
      setStatus('idle')
      showGlobalBubble({ type: 'error', message })
    }
  }

  const canOpenInstallDialog = !viewModel.installed
    && !openInstallDialogDisabled
    && status !== 'installing'
    && !loadingDetail
    && (Boolean(onOpenInstallDialog) || !extraActions)

  const triggerInstallDialog = () => {
    if (!canOpenInstallDialog) return
    if (onOpenInstallDialog) {
      void onOpenInstallDialog()
      return
    }
    void handleConfirmInstall()
  }

  const isNestedInteractiveTarget = (target: EventTarget | null, currentTarget: HTMLDivElement) => {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    const interactiveTarget = target.closest('button, a, input, select, textarea, summary, [role="button"], [role="link"]')
    return interactiveTarget !== null && interactiveTarget !== currentTarget
  }

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isNestedInteractiveTarget(event.target, event.currentTarget)) {
      return
    }
    triggerInstallDialog()
  }

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerInstallDialog()
    }
  }

  return (
    <div
      data-testid={`marketplace-card-${viewModel.slug}`}
      className={`rounded-xl border border-border p-4 transition-colors hover:bg-accent/20 ${
        canOpenInstallDialog ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]' : ''
      }`}
      role={canOpenInstallDialog ? 'button' : undefined}
      tabIndex={canOpenInstallDialog ? 0 : undefined}
      onClick={canOpenInstallDialog ? handleCardClick : undefined}
      onKeyDown={canOpenInstallDialog ? handleCardKeyDown : undefined}
    >
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-sm">{viewModel.displayName}</div>
            {!hideCategoryBadge && (
              <Badge
                data-testid={`marketplace-category-badge-${viewModel.slug}`}
                variant="outline"
                className="text-[10px] uppercase tracking-wide"
              >
                {viewModel.categoryLabel}
              </Badge>
            )}
            {!hideInstalledBadge && viewModel.installed && (
              <Badge data-testid={`marketplace-installed-badge-${viewModel.slug}`} variant="secondary">
                {t.skills.installed}
              </Badge>
            )}
            {statusBadges}
            {viewModel.hasUpdate && (
              <Badge
                data-testid={`marketplace-update-badge-${viewModel.slug}`}
                variant="outline"
                className="text-amber-500 border-amber-500/40"
              >
                {t.skills.marketplaceUpdateAvailable}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{viewModel.summary}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {viewModel.metrics.map((metric) => (
              <span key={metric.key} data-testid={metric.testId}>
                {metric.text}
              </span>
            ))}
          </div>

          {viewModel.metadataBadges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {viewModel.metadataBadges.map((badge) => (
                <Badge key={badge} variant="outline" className="text-xs">
                  {badge}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-start gap-2">
          {extraActions ?? (
            <>
              {viewModel.installed && viewModel.hasUpdate && (
                <Button
                  data-testid={`marketplace-update-${viewModel.slug}`}
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
              {viewModel.installed ? (
                <Button
                  data-testid={`marketplace-uninstall-${viewModel.slug}`}
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
                  data-testid={`marketplace-install-${viewModel.slug}`}
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

      <MarketplaceInstallDialog
        open={!!confirmDetailViewModel}
        viewModel={confirmDetailViewModel}
        onOpenChange={(open) => {
          if (!open) setConfirmDetailViewModel(null)
        }}
        onConfirm={() => {
          setConfirmDetailViewModel(null)
          handleInstall()
        }}
      />
    </div>
  )
}
