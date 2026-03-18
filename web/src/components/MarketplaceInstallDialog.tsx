import type { MarketplaceSkillDetail } from '../api/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { useI18n } from '../i18n'
import { AlertTriangle, ExternalLink, ShieldAlert, User } from 'lucide-react'

export function MarketplaceInstallDialog({
  open,
  detail,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  detail: MarketplaceSkillDetail | null
  confirmLabel?: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.skills.confirmInstallTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.skills.confirmInstallDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {detail.displayName}
              {detail.ownerHandle && detail.slug && (
                <a
                  href={`https://clawhub.ai/${detail.ownerHandle}/${detail.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{detail.summary}</div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {typeof detail.downloads === 'number' && (
                <span>{t.skills.marketplaceDownloadsLabel}: {detail.downloads}</span>
              )}
              {typeof detail.stars === 'number' && (
                <span>{t.skills.marketplaceStarsLabel}: {detail.stars}</span>
              )}
              {typeof detail.installsCurrent === 'number' && (
                <span>{t.skills.marketplaceInstallsLabel}: {detail.installsCurrent}</span>
              )}
            </div>

            {(detail.ownerHandle || detail.ownerDisplayName) && (
              <div className="flex items-center gap-2 text-xs">
                {detail.ownerImage ? (
                  <img src={detail.ownerImage} alt="" className="w-5 h-5 rounded-full" />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">{t.skills.skillAuthor}:</span>
                <span>{detail.ownerDisplayName || detail.ownerHandle}</span>
              </div>
            )}

            {detail.moderation?.isSuspicious && (
              <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-500">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t.skills.skillSuspicious}</span>
              </div>
            )}

            {detail.moderation?.isMalwareBlocked && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-500">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{t.skills.skillBlocked}</span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
              <span>{t.skills.marketplaceInstallCaution}</span>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={detail?.moderation?.isMalwareBlocked}
          >
            {confirmLabel || t.skills.confirmInstall}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
