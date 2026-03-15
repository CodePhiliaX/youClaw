export type SkillPriority = 'critical' | 'normal' | 'low'

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
  source: 'builtin' | 'workspace' | 'user' // Source tier
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

/** Agent skills view */
export interface AgentSkillsView {
  available: Skill[]       // All skills available to this agent
  enabled: Skill[]         // Enabled skills (listed in agent.yaml skills)
  eligible: Skill[]        // Skills that passed eligibility checks
}

/** Registry metadata (.registry.json) */
export interface SkillRegistryMeta {
  source: string
  slug: string
  installedAt: string
  displayName: string
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
