export type SkillImportMode = 'raw-url' | 'github'

export type SkillImportErrorCode =
  | 'invalid_url'
  | 'invalid_github_url'
  | 'not_skill_directory'
  | 'wrong_skill_file'
  | 'not_found'
  | 'duplicate_skill'
  | 'request_failed'

const GITHUB_ALLOWED_HOSTS = new Set(['github.com', 'www.github.com', 'raw.githubusercontent.com'])

export function normalizePastedUrl(value: string): string {
  return value.trim().replace(/^[-*+]\s+/, '')
}

export function getPrimaryImportErrorCode(mode: SkillImportMode, value: string): SkillImportErrorCode | null {
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return mode === 'github' ? 'invalid_github_url' : 'invalid_url'
    }
    if (mode === 'github' && !GITHUB_ALLOWED_HOSTS.has(parsed.hostname)) {
      return 'invalid_github_url'
    }
    return null
  } catch {
    return mode === 'github' ? 'invalid_github_url' : 'invalid_url'
  }
}

export function mapImportActionError(mode: SkillImportMode, message: string): SkillImportErrorCode {
  if (message.includes('already exists in target directory')) {
    return 'duplicate_skill'
  }

  if (mode === 'github') {
    if (
      message.includes('Selected GitHub location is not a skill directory')
      || message.includes('GitHub import requires a SKILL.md file at the selected directory root')
    ) {
      return 'not_skill_directory'
    }
    if (
      message.includes('Selected GitHub file must be SKILL.md')
      || message.includes('GitHub file import only supports SKILL.md files')
    ) {
      return 'wrong_skill_file'
    }
    if (message.includes('GitHub repository, ref, or path was not found')) {
      return 'not_found'
    }
    if (
      message.includes('Unsupported GitHub URL')
      || message.includes('GitHub import currently supports github.com and raw.githubusercontent.com URLs only')
      || message.includes('GitHub import requires a valid GitHub URL')
      || message.includes('GitHub raw URLs must point to a SKILL.md file')
      || message.includes('GitHub tree URLs must include a branch, tag, or commit')
      || message.includes('GitHub blob URLs must point to a file path')
    ) {
      return 'invalid_github_url'
    }
    return 'request_failed'
  }

  return message.includes('Invalid URL') ? 'invalid_url' : 'request_failed'
}

export function extractDuplicateSkillName(message: string): string | null {
  const match = message.match(/Skill "(.+)" already exists in target directory/)
  return match?.[1] ?? null
}

export function resolveImportModeFromUrl(value: string): SkillImportMode {
  try {
    const parsed = new URL(value)
    if (GITHUB_ALLOWED_HOSTS.has(parsed.hostname)) {
      return 'github'
    }
  } catch {
    return 'raw-url'
  }

  return 'raw-url'
}
