import { parse as parseYaml } from 'yaml'
import type { SkillFrontmatter, SkillPriority } from './types.ts'

const VALID_PRIORITIES = new Set<SkillPriority>(['critical', 'normal', 'low'])

export interface ParseResult {
  frontmatter: SkillFrontmatter
  content: string
}

/**
 * Parse SKILL.md file content, extract YAML frontmatter and body.
 * Frontmatter is delimited by `---`.
 */
export function parseFrontmatter(raw: string): ParseResult {
  const trimmed = raw.trimStart()

  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md missing frontmatter (must start with ---)')
  }

  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter not closed (missing second ---)')
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const content = trimmed.slice(endIndex + 3).trim()

  const parsed = parseYaml(yamlBlock) as Record<string, unknown>

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('SKILL.md frontmatter parsed to invalid result')
  }

  if (typeof parsed.name !== 'string' || !parsed.name) {
    throw new Error('SKILL.md frontmatter missing required field: name')
  }

  if (typeof parsed.description !== 'string' || !parsed.description) {
    throw new Error('SKILL.md frontmatter missing required field: description')
  }

  // Parse install field (Record<string, string>)
  let install: Record<string, string> | undefined
  if (parsed.install && typeof parsed.install === 'object' && !Array.isArray(parsed.install)) {
    install = {}
    for (const [key, value] of Object.entries(parsed.install as Record<string, unknown>)) {
      install[key] = String(value)
    }
  }

  // Parse priority field, ignore invalid values
  const rawPriority = typeof parsed.priority === 'string' ? parsed.priority as SkillPriority : undefined
  const priority = rawPriority && VALID_PRIORITIES.has(rawPriority) ? rawPriority : undefined

  const frontmatter: SkillFrontmatter = {
    name: parsed.name,
    description: String(parsed.description),
    version: parsed.version != null ? String(parsed.version) : undefined,
    os: Array.isArray(parsed.os) ? (parsed.os as unknown[]).map(String) : undefined,
    dependencies: Array.isArray(parsed.dependencies) ? (parsed.dependencies as unknown[]).map(String) : undefined,
    env: Array.isArray(parsed.env) ? (parsed.env as unknown[]).map(String) : undefined,
    tools: Array.isArray(parsed.tools) ? (parsed.tools as unknown[]).map(String) : undefined,
    tags: Array.isArray(parsed.tags) ? (parsed.tags as unknown[]).map(String) : undefined,
    globs: Array.isArray(parsed.globs) ? (parsed.globs as unknown[]).map(String) : undefined,
    priority,
    install,
  }

  return { frontmatter, content }
}
