import { useMemo } from 'react'
import type { MarketplaceCardViewModel, MarketplaceResultsViewModel } from '@/lib/marketplace-view-model'
import type { MarketplaceSort, RegistrySelectableSource, RegistrySourceInfo } from '@/api/client'
import type { MarketplaceChangeEvent } from '@/lib/marketplace-updates'
import type { MarketplaceFeedStatus } from '@/hooks/useMarketplaceFeed'
import { MarketplaceCard } from '@/components/MarketplaceCard'
import { MarketplaceDisclaimer } from '@/components/MarketplaceDisclaimer'
import { RegistrySourceSelect } from '@/components/RegistrySourceSelect'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { MarketplaceVirtualList } from '@/components/skills/MarketplaceVirtualList'
import { Loader2, Search, Store } from 'lucide-react'
import { useI18n } from '@/i18n'

type MarketplaceViewRow =
  | { key: string; type: 'header'; label: string }
  | { key: string; type: 'card'; viewModel: MarketplaceCardViewModel }

interface MarketplaceViewProps {
  resultsViewModel: MarketplaceResultsViewModel
  marketplaceStatus: MarketplaceFeedStatus
  marketplaceError: string
  marketplaceAppendError: string
  marketplaceSort: MarketplaceSort
  setMarketplaceSort: (sort: MarketplaceSort) => void
  registrySource: RegistrySelectableSource
  registrySources: RegistrySourceInfo[]
  onRegistrySourceChange: (source: RegistrySelectableSource) => void
  searchQuery: string
  handleSearchChange: (value: string) => void
  onChanged: (change?: MarketplaceChangeEvent) => void
  onLoadMore: () => void
  onRetryLoadMore: () => void
  listKey: string
}

export function MarketplaceView({
  resultsViewModel,
  marketplaceStatus,
  marketplaceError,
  marketplaceAppendError,
  marketplaceSort,
  setMarketplaceSort,
  registrySource,
  registrySources,
  onRegistrySourceChange,
  searchQuery,
  handleSearchChange,
  onChanged,
  onLoadMore,
  onRetryLoadMore,
  listKey,
}: MarketplaceViewProps) {
  const { t } = useI18n()
  const selectedSourceInfo = registrySources.find((source) => source.id === registrySource) ?? null
  const supportedSorts = selectedSourceInfo?.capabilities.sorts ?? ['trending', 'updated', 'downloads', 'stars', 'installsCurrent', 'installsAllTime']

  const rows = useMemo<MarketplaceViewRow[]>(() => {
    if (resultsViewModel.isSearching) {
      return resultsViewModel.flatItems.map((viewModel) => ({
        key: `card:${viewModel.slug}`,
        type: 'card',
        viewModel,
      }))
    }

    return resultsViewModel.groupedItems.flatMap((group) => ([
      {
        key: `header:${group.category}`,
        type: 'header' as const,
        label: group.label,
      },
      ...group.items.map((viewModel) => ({
        key: `card:${viewModel.slug}`,
        type: 'card' as const,
        viewModel,
      })),
    ]))
  }, [resultsViewModel])

  const listHeader = (
    <div className="space-y-6 pb-6">
      <MarketplaceDisclaimer />

      {!resultsViewModel.isSearching && (
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{t.skills.recommended}</h3>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="marketplace-search-input"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t.skills.marketplaceSearchPlaceholder}
              className="pl-9"
            />
          </div>

          <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row lg:items-center">
            <RegistrySourceSelect
              sources={registrySources}
              value={registrySource}
              onValueChange={onRegistrySourceChange}
              className="w-full sm:w-[128px]"
            />

            {resultsViewModel.isSearching && supportedSorts.length > 0 && (
              <select
                data-testid="marketplace-sort-select"
                value={marketplaceSort}
                onChange={(e) => setMarketplaceSort(e.target.value as MarketplaceSort)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-[148px]"
              >
                {supportedSorts.includes('trending') && <option value="trending">{t.skills.marketplaceSortTrending}</option>}
                {supportedSorts.includes('updated') && <option value="updated">{t.skills.marketplaceSortUpdated}</option>}
                {supportedSorts.includes('downloads') && <option value="downloads">{t.skills.marketplaceSortDownloads}</option>}
                {supportedSorts.includes('stars') && <option value="stars">{t.skills.marketplaceSortStars}</option>}
                {supportedSorts.includes('installsCurrent') && <option value="installsCurrent">{t.skills.marketplaceSortInstalls}</option>}
                {supportedSorts.includes('installsAllTime') && <option value="installsAllTime">{t.skills.marketplaceSortInstallsAllTime}</option>}
              </select>
            )}

            {marketplaceStatus === 'refreshing' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t.common.loading}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-6 flex min-h-0 w-full max-w-3xl flex-1">
        <MarketplaceVirtualList
          rows={rows}
          listKey={listKey}
          rowKey={(row) => row.key}
          renderRow={(row) => {
            if (row.type === 'header') {
              return (
                <div className="pb-3 pt-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      {row.label}
                    </Badge>
                  </div>
                </div>
              )
            }

            return (
              <div className="pb-3">
                <MarketplaceCard
                  viewModel={row.viewModel}
                  onChanged={onChanged}
                  registrySource={registrySource}
                  hideCategoryBadge
                />
              </div>
            )
          }}
          status={marketplaceStatus}
          hasMore={resultsViewModel.canLoadMore}
          appendError={marketplaceAppendError}
          loadingLabel={t.common.loading}
          retryLabel={t.common.retry}
          emptyState={(
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
              <Store className="mb-4 h-12 w-12 opacity-20" />
              <p>{resultsViewModel.isSearching ? t.skills.noMarketplaceSkills : t.skills.noSkills}</p>
            </div>
          )}
          errorState={(
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
              <Store className="mb-4 h-12 w-12 opacity-20" />
              <p>{marketplaceError || t.skills.marketplaceLoadFailed}</p>
            </div>
          )}
          onLoadMore={onLoadMore}
          onRetryLoadMore={onRetryLoadMore}
          header={listHeader}
          scrollerClassName="pr-1"
        />
      </div>
    </div>
  )
}
