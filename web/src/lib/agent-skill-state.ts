import type { MarketplaceSkill, Skill } from '../api/client'

export enum AgentSkillBindingState {
  Unbound = 'unbound',
  Bound = 'bound',
  BoundViaWildcard = 'bound_via_wildcard',
  Unresolvable = 'unresolvable',
}

export enum AgentMarketplaceSkillState {
  InstallAndBind = 'install_and_bind',
  Bind = 'bind',
  HiddenBound = 'hidden_bound',
}

export interface AgentSkillBindingsModel {
  isWildcard: boolean
  installedSkillNames: string[]
  normalizedAgentSkillNames: string[]
  boundSkillNames: Set<string>
  installedSkillNameSet: Set<string>
  installedSkillNameBySlug: Map<string, string>
}

export function createAgentSkillBindingsModel(
  allSkills: Skill[],
  agentSkills: string[] | undefined,
): AgentSkillBindingsModel {
  const installedSkillNames = allSkills.map((skill) => skill.name)
  const installedSkillNameSet = new Set(installedSkillNames)
  const installedSkillNameBySlug = new Map<string, string>()

  for (const skill of allSkills) {
    const slug = skill.registryMeta?.slug
    if (slug) {
      installedSkillNameBySlug.set(slug, skill.name)
    }
  }

  const isWildcard = agentSkills?.includes('*') ?? false
  const normalizedAgentSkillNames = isWildcard
    ? installedSkillNames
    : normalizeAgentSkillNames(agentSkills, installedSkillNameSet, installedSkillNameBySlug)

  return {
    isWildcard,
    installedSkillNames,
    normalizedAgentSkillNames,
    boundSkillNames: new Set(normalizedAgentSkillNames),
    installedSkillNameSet,
    installedSkillNameBySlug,
  }
}

function normalizeAgentSkillNames(
  agentSkills: string[] | undefined,
  installedSkillNameSet: Set<string>,
  installedSkillNameBySlug: Map<string, string>,
): string[] {
  if (!agentSkills?.length) {
    return []
  }

  const normalized: string[] = []
  const seen = new Set<string>()

  for (const configuredSkill of agentSkills) {
    const normalizedSkillName = installedSkillNameSet.has(configuredSkill)
      ? configuredSkill
      : (installedSkillNameBySlug.get(configuredSkill) ?? configuredSkill)

    if (!installedSkillNameSet.has(normalizedSkillName) || seen.has(normalizedSkillName)) {
      continue
    }

    seen.add(normalizedSkillName)
    normalized.push(normalizedSkillName)
  }

  return normalized
}

export function resolveMarketplaceLocalSkillName(
  skill: MarketplaceSkill,
  model: AgentSkillBindingsModel,
): string | null {
  if (skill.installedSkillName && model.installedSkillNameSet.has(skill.installedSkillName)) {
    return skill.installedSkillName
  }

  const mappedName = model.installedSkillNameBySlug.get(skill.slug)
  if (mappedName && model.installedSkillNameSet.has(mappedName)) {
    return mappedName
  }

  if (model.installedSkillNameSet.has(skill.slug)) {
    return skill.slug
  }

  return null
}

export function getMarketplaceBindingState(
  skill: MarketplaceSkill,
  model: AgentSkillBindingsModel,
): AgentSkillBindingState {
  const localSkillName = resolveMarketplaceLocalSkillName(skill, model)

  if (!localSkillName) {
    return AgentSkillBindingState.Unresolvable
  }
  if (model.isWildcard) {
    return AgentSkillBindingState.BoundViaWildcard
  }
  return model.boundSkillNames.has(localSkillName)
    ? AgentSkillBindingState.Bound
    : AgentSkillBindingState.Unbound
}

export function getAgentMarketplaceSkillState(
  skill: MarketplaceSkill,
  model: AgentSkillBindingsModel,
): AgentMarketplaceSkillState {
  if (!skill.installed) {
    return AgentMarketplaceSkillState.InstallAndBind
  }

  const bindingState = getMarketplaceBindingState(skill, model)
  return bindingState === AgentSkillBindingState.Bound || bindingState === AgentSkillBindingState.BoundViaWildcard
    ? AgentMarketplaceSkillState.HiddenBound
    : AgentMarketplaceSkillState.Bind
}
