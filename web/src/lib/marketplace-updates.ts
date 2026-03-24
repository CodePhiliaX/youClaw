import type { MarketplacePage, MarketplaceSkill, RegistrySelectableSource } from '@/api/client'

export interface MarketplaceChangeEvent {
  type: 'install' | 'update' | 'uninstall'
  slug: string
  source: RegistrySelectableSource
}

function applyMarketplaceChangeToSkill(skill: MarketplaceSkill, change: MarketplaceChangeEvent): MarketplaceSkill {
  switch (change.type) {
    case 'install':
      return {
        ...skill,
        installed: true,
        installSource: change.source,
        installedVersion: skill.latestVersion ?? skill.installedVersion,
        hasUpdate: false,
      }
    case 'update':
      return {
        ...skill,
        installed: true,
        installSource: change.source,
        installedVersion: skill.latestVersion ?? skill.installedVersion,
        hasUpdate: false,
      }
    case 'uninstall':
      return {
        ...skill,
        installed: false,
        installedSkillName: undefined,
        installSource: undefined,
        installedVersion: undefined,
        hasUpdate: false,
      }
  }
}

export function applyMarketplaceChangeToPage(page: MarketplacePage, change: MarketplaceChangeEvent): MarketplacePage {
  return {
    ...page,
    items: page.items.map((skill) => (
      skill.slug === change.slug
        ? applyMarketplaceChangeToSkill(skill, change)
        : skill
    )),
  }
}

export function getVisibleMarketplaceItems(page: MarketplacePage): MarketplaceSkill[] {
  return page.items.filter((skill) => !skill.installed)
}
