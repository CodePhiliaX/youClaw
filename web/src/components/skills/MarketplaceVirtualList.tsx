import { forwardRef, useEffect, useMemo, type ComponentProps, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MarketplaceFeedStatus } from '@/hooks/useMarketplaceFeed'

interface MarketplaceVirtualListProps<Row> {
  rows: Row[]
  listKey: string
  rowKey: (row: Row, index: number) => string
  renderRow: (row: Row, index: number) => ReactNode
  status: MarketplaceFeedStatus
  hasMore: boolean
  appendError: string
  loadingLabel: string
  retryLabel: string
  emptyState: ReactNode
  errorState: ReactNode
  onLoadMore: () => void
  onRetryLoadMore: () => void
  header?: ReactNode
  className?: string
  scrollerClassName?: string
}

const VirtualListScroller = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      data-testid="marketplace-results-scroller"
      ref={ref}
      className={cn('h-full overflow-y-auto', className)}
      {...props}
    />
  ),
)

VirtualListScroller.displayName = 'VirtualListScroller'

export function MarketplaceVirtualList<Row>({
  rows,
  listKey,
  rowKey,
  renderRow,
  status,
  hasMore,
  appendError,
  loadingLabel,
  retryLabel,
  emptyState,
  errorState,
  onLoadMore,
  onRetryLoadMore,
  header,
  className,
  scrollerClassName,
}: MarketplaceVirtualListProps<Row>) {
  useEffect(() => {
    if (rows.length === 0 && hasMore && status === 'idle' && !appendError) {
      onLoadMore()
    }
  }, [appendError, hasMore, onLoadMore, rows.length, status])

  const Scroller = useMemo(() => {
    const MarketplaceResultsScroller = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
      ({ className, ...props }, ref) => (
        <VirtualListScroller
          ref={ref}
          className={cn(scrollerClassName, className)}
          {...props}
        />
      ),
    )

    MarketplaceResultsScroller.displayName = 'MarketplaceResultsScroller'
    return MarketplaceResultsScroller
  }, [scrollerClassName])

  const Header = useMemo(() => (
    header
      ? function MarketplaceVirtualListHeader() {
          return <>{header}</>
        }
      : undefined
  ), [header])

  const Footer = useMemo(() => {
    function MarketplaceVirtualListFooter() {
      if (status === 'loading-more') {
        return (
          <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{loadingLabel}</span>
          </div>
        )
      }

      if (appendError) {
        return (
          <div className="flex flex-col items-center gap-2 py-3 text-sm text-muted-foreground">
            <p>{appendError}</p>
            <Button variant="secondary" onClick={onRetryLoadMore}>
              {retryLabel}
            </Button>
          </div>
        )
      }

      return <div className="h-3" />
    }

    MarketplaceVirtualListFooter.displayName = 'MarketplaceVirtualListFooter'
    return MarketplaceVirtualListFooter
  }, [appendError, loadingLabel, onRetryLoadMore, retryLabel, status])

  if (status === 'loading' && rows.length === 0) {
    return (
      <div className={cn('h-full overflow-y-auto', scrollerClassName)}>
        {header}
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (status === 'error' && rows.length === 0) {
    return (
      <div className={cn('h-full overflow-y-auto', scrollerClassName)}>
        {header}
        {errorState}
      </div>
    )
  }

  if (rows.length === 0 && !hasMore) {
    return (
      <div className={cn('h-full overflow-y-auto', scrollerClassName)}>
        {header}
        {emptyState}
      </div>
    )
  }

  return (
    <Virtuoso<Row>
      key={listKey}
      className={cn('h-full w-full', className)}
      style={{ height: '100%' }}
      data={rows}
      computeItemKey={(index, row) => rowKey(row, index)}
      itemContent={(index, row) => renderRow(row, index)}
      endReached={() => {
        if (hasMore && status === 'idle' && !appendError) {
          onLoadMore()
        }
      }}
      increaseViewportBy={{ top: 480, bottom: 960 }}
      components={{
        Scroller,
        Header,
        Footer,
      }}
    />
  )
}
