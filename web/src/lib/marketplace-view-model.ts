import type { MarketplacePage, MarketplaceSkill, MarketplaceSkillDetail } from '@/api/client'
import type { Translations } from '@/i18n/types'
import { getMarketplaceCategoryLabels, groupMarketplaceSkillsByCategory, normalizeMarketplaceCategory } from '@/lib/marketplace-category'
import { getVisibleMarketplaceItems } from '@/lib/marketplace-updates'

function formatMarketplaceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

export interface MarketplaceCardMetricViewModel {
  key: string
  text: string
  testId?: string
}

export interface MarketplaceCardViewModel {
  slug: string
  source: MarketplaceSkill['source']
  displayName: string
  summary: string
  categoryLabel: string
  installed: boolean
  installedSkillName?: string
  installSource?: string
  installedVersion?: string
  latestVersion?: string | null
  hasUpdate: boolean
  downloads?: number | null
  stars?: number | null
  installsCurrent?: number | null
  metrics: MarketplaceCardMetricViewModel[]
  metadataBadges: string[]
}

export interface MarketplaceInstallDialogViewModel {
  displayName: string
  externalUrl: string | null
  summary: string
  stats: Array<{ key: string; label: string; value: string | number }>
  authorName: string | null
  authorImage: string | null
  isSuspicious: boolean
  isMalwareBlocked: boolean
}

export interface MarketplaceResultsGroupViewModel {
  category: string
  label: string
  items: MarketplaceCardViewModel[]
}

export interface MarketplaceResultsViewModel {
  isSearching: boolean
  hasItems: boolean
  canLoadMore: boolean
  flatItems: MarketplaceCardViewModel[]
  groupedItems: MarketplaceResultsGroupViewModel[]
}

export function toMarketplaceCardViewModel(skill: MarketplaceSkill, t: Translations): MarketplaceCardViewModel {
  const category = normalizeMarketplaceCategory(skill.category)
  const categoryLabels = getMarketplaceCategoryLabels(t)
  const metrics: MarketplaceCardMetricViewModel[] = []

  if (skill.latestVersion) {
    metrics.push({
      key: 'latestVersion',
      text: `${t.skills.marketplaceVersionLabel}: ${skill.latestVersion}`,
      testId: `marketplace-latest-version-${skill.slug}`,
    })
  }

  if (skill.installedVersion) {
    metrics.push({
      key: 'installedVersion',
      text: `${t.skills.marketplaceInstalledVersionLabel}: ${skill.installedVersion}`,
      testId: `marketplace-installed-version-${skill.slug}`,
    })
  }

  if (typeof skill.downloads === 'number') {
    metrics.push({ key: 'downloads', text: `${t.skills.marketplaceDownloadsLabel}: ${skill.downloads}` })
  }

  if (typeof skill.stars === 'number') {
    metrics.push({ key: 'stars', text: `${t.skills.marketplaceStarsLabel}: ${skill.stars}` })
  }

  if (typeof skill.installsCurrent === 'number') {
    metrics.push({ key: 'installsCurrent', text: `${t.skills.marketplaceInstallsLabel}: ${skill.installsCurrent}` })
  }

  if (skill.updatedAt) {
    metrics.push({ key: 'updatedAt', text: `${t.skills.marketplaceUpdatedLabel}: ${formatMarketplaceDate(skill.updatedAt)}` })
  }

  return {
    slug: skill.slug,
    source: skill.source,
    displayName: skill.displayName,
    summary: skill.summary,
    categoryLabel: categoryLabels[category],
    installed: skill.installed,
    installedSkillName: skill.installedSkillName,
    installSource: skill.installSource,
    installedVersion: skill.installedVersion,
    latestVersion: skill.latestVersion,
    hasUpdate: skill.hasUpdate,
    downloads: skill.downloads ?? null,
    stars: skill.stars ?? null,
    installsCurrent: skill.installsCurrent ?? null,
    metrics,
    metadataBadges: [
      ...skill.tags,
      ...(skill.metadata?.os ?? []),
      ...(skill.metadata?.systems ?? []),
    ],
  }
}

export function toMarketplaceInstallDialogFallbackViewModel(viewModel: MarketplaceCardViewModel, t: Translations): MarketplaceInstallDialogViewModel {
  const stats: Array<{ key: string; label: string; value: string | number }> = []

  if (typeof viewModel.downloads === 'number') {
    stats.push({ key: 'downloads', label: t.skills.marketplaceDownloadsLabel, value: viewModel.downloads })
  }

  if (typeof viewModel.stars === 'number') {
    stats.push({ key: 'stars', label: t.skills.marketplaceStarsLabel, value: viewModel.stars })
  }

  if (typeof viewModel.installsCurrent === 'number') {
    stats.push({ key: 'installsCurrent', label: t.skills.marketplaceInstallsLabel, value: viewModel.installsCurrent })
  }

  return {
    displayName: viewModel.displayName,
    externalUrl: null,
    summary: viewModel.summary,
    stats,
    authorName: null,
    authorImage: null,
    isSuspicious: false,
    isMalwareBlocked: false,
  }
}

export function toMarketplaceInstallDialogViewModel(detail: MarketplaceSkillDetail, t: Translations): MarketplaceInstallDialogViewModel {
  const stats: Array<{ key: string; label: string; value: string | number }> = []

  if (typeof detail.downloads === 'number') {
    stats.push({ key: 'downloads', label: t.skills.marketplaceDownloadsLabel, value: detail.downloads })
  }

  if (typeof detail.stars === 'number') {
    stats.push({ key: 'stars', label: t.skills.marketplaceStarsLabel, value: detail.stars })
  }

  if (typeof detail.installsCurrent === 'number') {
    stats.push({ key: 'installsCurrent', label: t.skills.marketplaceInstallsLabel, value: detail.installsCurrent })
  }

  return {
    displayName: detail.displayName,
    externalUrl: detail.detailUrl ?? detail.homepageUrl ?? null,
    summary: detail.summary,
    stats,
    authorName: detail.ownerDisplayName || detail.ownerHandle || null,
    authorImage: detail.ownerImage ?? null,
    isSuspicious: Boolean(detail.moderation?.isSuspicious),
    isMalwareBlocked: Boolean(detail.moderation?.isMalwareBlocked),
  }
}

export function toMarketplaceResultsViewModel(
  page: MarketplacePage,
  searchQuery: string,
  appendError: string,
  t: Translations,
): MarketplaceResultsViewModel {
  const isSearching = searchQuery.trim().length > 0
  const visibleItems = getVisibleMarketplaceItems(page)
  const flatItems = visibleItems.map((skill) => toMarketplaceCardViewModel(skill, t))
  const categoryLabels = getMarketplaceCategoryLabels(t)
  const groupedItems = groupMarketplaceSkillsByCategory(visibleItems).map((group) => ({
    category: group.category,
    label: categoryLabels[group.category],
    items: group.items.map((skill) => toMarketplaceCardViewModel(skill, t)),
  }))

  return {
    isSearching,
    hasItems: visibleItems.length > 0,
    canLoadMore: isSearching && Boolean(page.nextCursor) && !appendError,
    flatItems,
    groupedItems,
  }
}
