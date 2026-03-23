import type { RefObject } from 'react'
import type { MarketplaceSort, RegistrySelectableSource, RegistrySourceInfo } from '@/api/client'
import { MarketplaceCard } from '@/components/MarketplaceCard'
import { MarketplaceDisclaimer } from '@/components/MarketplaceDisclaimer'
import { RegistrySourceSelect } from '@/components/RegistrySourceSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, Store } from 'lucide-react'
import { useI18n } from '@/i18n'
import type { MarketplaceResultsViewModel } from '@/lib/marketplace-view-model'
import type { MarketplaceChangeEvent } from '@/lib/marketplace-updates'

interface MarketplaceViewProps {
  resultsViewModel: MarketplaceResultsViewModel
  marketplaceStatus: 'idle' | 'loading' | 'refreshing' | 'loading-more' | 'error'
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
  marketplaceScrollRef: RefObject<HTMLDivElement | null>
  marketplaceLoadMoreRef: RefObject<HTMLDivElement | null>
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
  marketplaceScrollRef,
  marketplaceLoadMoreRef,
}: MarketplaceViewProps) {
  const { t } = useI18n()
  const selectedSourceInfo = registrySources.find((source) => source.id === registrySource) ?? null
  const supportedSorts = selectedSourceInfo?.capabilities.sorts ?? ['trending', 'updated', 'downloads', 'stars', 'installsCurrent', 'installsAllTime']

  return (
    <div ref={marketplaceScrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="marketplace-search-input"
              defaultValue={searchQuery}
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

        <MarketplaceDisclaimer />

        {!resultsViewModel.isSearching && (
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t.skills.recommended}</h3>
          </div>
        )}

        {marketplaceStatus === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {marketplaceStatus === 'error' && (
          <div className="text-center text-muted-foreground text-sm py-12">
            <Store className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{marketplaceError || t.skills.marketplaceLoadFailed}</p>
          </div>
        )}

        {marketplaceStatus !== 'loading' && marketplaceStatus !== 'error' && !resultsViewModel.hasItems && !resultsViewModel.canLoadMore && (
          <div className="text-center text-muted-foreground text-sm py-12">
            <Store className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{resultsViewModel.isSearching ? t.skills.noMarketplaceSkills : t.skills.noSkills}</p>
          </div>
        )}

        {marketplaceStatus !== 'loading' && resultsViewModel.hasItems && (
          resultsViewModel.isSearching ? (
            <div className="grid gap-3">
              {resultsViewModel.flatItems.map((viewModel) => (
                <MarketplaceCard
                  key={viewModel.slug}
                  viewModel={viewModel}
                  onChanged={onChanged}
                  registrySource={registrySource}
                  hideCategoryBadge
                />
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {resultsViewModel.groupedItems.map((group) => (
                <section key={group.category} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      {group.label}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {group.items.map((viewModel) => (
                      <MarketplaceCard
                        key={viewModel.slug}
                        viewModel={viewModel}
                        onChanged={onChanged}
                        registrySource={registrySource}
                        hideCategoryBadge
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )
        )}

        {resultsViewModel.canLoadMore && (
          <div className="space-y-3">
            <div ref={marketplaceLoadMoreRef} className="h-1" aria-hidden="true" />
            {marketplaceStatus === 'loading-more' && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t.common.loading}</span>
              </div>
            )}
            {marketplaceAppendError && (
              <div className="flex flex-col items-center gap-2 py-2 text-sm text-muted-foreground">
                <p>{marketplaceAppendError}</p>
                <Button data-testid="marketplace-load-more-retry" variant="secondary" onClick={onRetryLoadMore}>
                  {t.common.retry}
                </Button>
              </div>
            )}
            {!marketplaceAppendError && marketplaceStatus === 'idle' && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={onLoadMore}>{t.skills.marketplaceLoadMore}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
