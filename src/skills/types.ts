export type SkillPriority = 'critical' | 'normal' | 'low'

export const SkillRuntimeSource = {
  Builtin: 'builtin',
  Workspace: 'workspace',
  User: 'user',
} as const

export type SkillRuntimeSource = typeof SkillRuntimeSource[keyof typeof SkillRuntimeSource]

export const RegistryMarketplaceSource = {
  ClawHub: 'clawhub',
  Tencent: 'tencent',
} as const

export type RegistryMarketplaceSource = typeof RegistryMarketplaceSource[keyof typeof RegistryMarketplaceSource]
export const REGISTRY_MARKETPLACE_SOURCES = Object.values(RegistryMarketplaceSource)

export const SkillImportProvider = {
  RawUrl: 'raw-url',
  GitHub: 'github',
} as const

export type SkillImportProvider = typeof SkillImportProvider[keyof typeof SkillImportProvider]
export const SKILL_IMPORT_PROVIDERS = Object.values(SkillImportProvider)

export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  os?: string[]           // Supported OS platforms, e.g. ["darwin", "linux"]
  dependencies?: string[] // Required executables, e.g. ["chrome", "node"]
  env?: string[]          // Required environment variables, e.g. ["MINIMAX_API_KEY"]
  tools?: string[]        // Provided tools
  tags?: string[]         // Tag categories, e.g. ["coding", "search"]
  globs?: string[]        // File patterns to match, e.g. ["*.py", "*.ts"]
  priority?: SkillPriority // Priority: critical > normal > low
  install?: Record<string, string> // Install instructions, e.g. { brew: "brew install chrome", apt: "apt install chromium" }

  // Extension fields
  requires?: string[]      // Other skills this skill depends on
  conflicts?: string[]     // Skills that conflict with this one
  setup?: string           // Command to run after installation
  teardown?: string        // Command to run before uninstallation
  source?: string          // Source URL (for remote installation)
}

/** Single dependency check result */
export interface DependencyCheckResult {
  name: string
  found: boolean
  path?: string  // Executable path when found
}

/** Single environment variable check result */
export interface EnvCheckResult {
  name: string
  found: boolean
}

/** Detailed eligibility check results */
export interface EligibilityDetail {
  os: { passed: boolean; current: string; required?: string[] }
  dependencies: { passed: boolean; results: DependencyCheckResult[] }
  env: { passed: boolean; results: EnvCheckResult[] }
}

export interface Skill {
  name: string
  source: SkillRuntimeSource // Source tier
  frontmatter: SkillFrontmatter
  content: string          // SKILL.md body (frontmatter stripped)
  path: string             // File path
  eligible: boolean        // Eligibility check result
  eligibilityErrors: string[] // Eligibility check failure reasons
  eligibilityDetail: EligibilityDetail // Detailed eligibility check results
  loadedAt: number         // Load timestamp (ms)
  enabled: boolean         // Whether user has enabled this skill (default true)
  usable: boolean          // eligible && enabled
  registryMeta?: SkillRegistryMeta // Metadata from .registry.json
}

export interface SkillPromptSnapshot {
  prompt: string
  skills: Skill[]
  resolvedSkills: Skill[]
  version: number
  requestedSkills?: string[]
}

export interface SkillResolutionSummaryEntry {
  name: string
  source: SkillRuntimeSource
  path: string
}

export interface SkillResolutionSummary {
  version: number
  skills: SkillResolutionSummaryEntry[]
}

/** Agent skills view */
export interface AgentSkillsView {
  available: Skill[]       // All skills available to this agent
  enabled: Skill[]         // Enabled skills (listed in agent.yaml skills)
  eligible: Skill[]        // Skills that passed eligibility checks
}

interface SkillRegistryMetaBase {
  slug: string
  installedAt: string
  displayName?: string
  version?: string
}

export interface MarketplaceSkillRegistryMeta extends SkillRegistryMetaBase {
  source: RegistryMarketplaceSource
  homepageUrl?: string
}

export interface RawUrlSkillRegistryMeta extends SkillRegistryMetaBase {
  source: typeof SkillImportProvider.RawUrl
  provider: typeof SkillImportProvider.RawUrl
  sourceUrl: string
}

export interface GitHubSkillRegistryMeta extends SkillRegistryMetaBase {
  source: typeof SkillImportProvider.GitHub
  provider: typeof SkillImportProvider.GitHub
  sourceUrl: string
  homepageUrl?: string
  ref?: string
  path?: string
}

/** Registry metadata (.registry.json) */
export type SkillRegistryMeta =
  | MarketplaceSkillRegistryMeta
  | RawUrlSkillRegistryMeta
  | GitHubSkillRegistryMeta

export type SkillCatalogGroup = 'builtin' | 'user'
export type UserSkillKind = 'external' | 'custom'
export type ExternalSkillSource = 'marketplace' | 'imported' | 'manual'

export interface SkillCatalogInfo {
  catalogGroup: SkillCatalogGroup
  userSkillKind?: UserSkillKind
  externalSource?: ExternalSkillSource
  sortTimestamp?: string
}

export type SkillProjectOrigin = 'user' | 'imported' | 'marketplace' | 'manual' | 'duplicated' | 'builtin'

export interface SkillProjectMeta {
  schemaVersion: number
  managed: boolean
  origin: SkillProjectOrigin
  createdAt: string
  updatedAt: string
}

export interface SkillDraftMeta {
  schemaVersion: number
  updatedAt: string
  basedOnPublishedUpdatedAt?: string
  isValid: boolean
  lastEditorMode: 'form' | 'source'
}

export interface SkillValidationMessage {
  field?: string
  message: string
}

export interface SkillValidationResult {
  normalizedName: string
  errors: SkillValidationMessage[]
  warnings: SkillValidationMessage[]
  generatedMarkdown: string
  draft: SkillAuthoringDraft | null
}

export interface SkillAuthoringDraft {
  frontmatter: SkillFrontmatter
  content: string
  rawMarkdown: string
}

export interface SkillProject {
  name: string
  rootDir: string
  entryFile: string
  path: string
  source: SkillRuntimeSource
  editable: boolean
  managed: boolean
  origin: SkillProjectOrigin
  createdAt?: string
  updatedAt?: string
  hasPublished: boolean
  hasDraft: boolean
  draftUpdatedAt?: string
  description?: string
  boundAgentIds: string[]
}

/** Skills configuration */
export interface SkillsConfig {
  maxSkillCount: number       // Maximum number of skills
  maxTotalChars: number       // Total character limit for all skill content
  maxSingleSkillChars: number // Character limit for a single skill
}

/** Default configuration */
export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  maxSkillCount: 50,
  maxTotalChars: 30000,
  maxSingleSkillChars: 5000,
}
