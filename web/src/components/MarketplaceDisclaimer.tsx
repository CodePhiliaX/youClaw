import { AlertTriangle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function MarketplaceDisclaimer({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { t } = useI18n()

  return (
    <div
      data-testid="marketplace-disclaimer"
      className={cn(
        'rounded-xl border border-yellow-500/30 bg-yellow-500/10',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
        <div className="min-w-0 space-y-1">
          <div className={cn('font-medium text-yellow-600', compact ? 'text-xs' : 'text-sm')}>
            {t.skills.marketplaceDisclaimerTitle}
          </div>
          <p className={cn('leading-relaxed text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
            {t.skills.marketplaceDisclaimerBody}
          </p>
        </div>
      </div>
    </div>
  )
}
