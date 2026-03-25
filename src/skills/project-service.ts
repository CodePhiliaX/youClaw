import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { AgentManager } from '../agent/index.ts'
import type { AgentConfig } from '../agent/types.ts'
import { getPaths } from '../config/index.ts'
import { parseFrontmatter } from './frontmatter.ts'
import type {
  Skill,
  SkillAuthoringDraft,
  SkillDraftMeta,
  SkillFrontmatter,
  SkillProject,
  SkillProjectMeta,
  SkillValidationMessage,
  SkillValidationResult,
} from './types.ts'
import type { SkillsLoader } from './loader.ts'

const META_FILENAME = '.youclaw-skill.json'
const DRAFT_DIRNAME = '.draft'
const DRAFT_FILENAME = 'SKILL.md'
const DRAFT_META_FILENAME = 'meta.json'
const ENTRY_FILENAME = 'SKILL.md'
const SCHEMA_VERSION = 1

export interface DraftPayload {
  mode: 'form' | 'source'
  draft?: {
    frontmatter?: Record<string, unknown>
    content?: string
    rawMarkdown?: string
  }
  rawMarkdown?: string
}

export interface PublishOptions {
  bindingAgentIds?: string[]
}

export interface SkillProjectDetail {
  project: SkillProject
  publishedDraft: SkillAuthoringDraft | null
  draft: SkillAuthoringDraft | null
  draftMeta: SkillDraftMeta | null
  bindingStates: Array<{ id: string; name: string; state: 'bound' | 'bound_via_wildcard' | 'unbound' }>
}

export class SkillProjectService {
  constructor(
    private readonly skillsLoader: SkillsLoader,
    private readonly agentManager: AgentManager,
    private readonly userSkillsDir: string = getPaths().userSkills,
  ) {}

  listProjects(): SkillProject[] {
    const projectsByName = new Map<string, SkillProject>()
    const allSkills = this.skillsLoader.loadAllSkills()
    const userSkillMap = new Map(allSkills.filter((skill) => skill.source === 'user').map((skill) => [skill.name, skill]))
    const directories = this.listProjectDirectories()

    for (const dir of directories) {
      const project = this.buildManagedProject(dir, userSkillMap.get(basename(dir)) ?? null)
      projectsByName.set(project.name, project)
    }

    for (const skill of allSkills) {
      if (projectsByName.has(skill.name)) continue
      projectsByName.set(skill.name, this.buildReadonlyProject(skill))
    }

    return Array.from(projectsByName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  getProject(name: string): SkillProjectDetail {
    const normalizedName = normalizeSkillName(name)
    const allSkills = this.skillsLoader.loadAllSkills()
    const managedDir = resolve(this.userSkillsDir, normalizedName)

    if (existsSync(managedDir) && statSync(managedDir).isDirectory()) {
      const publishedSkill = allSkills.find((skill) => skill.name === normalizedName && skill.source === 'user') ?? null
      const project = this.buildManagedProject(managedDir, publishedSkill)
      return {
        project,
        publishedDraft: publishedSkill ? skillToDraft(publishedSkill) : this.readPublishedDraft(managedDir),
        draft: this.readDraft(managedDir),
        draftMeta: this.readDraftMeta(managedDir),
        bindingStates: this.getBindingStates(normalizedName),
      }
    }

    const publishedSkill = allSkills.find((skill) => skill.name === normalizedName)
    if (!publishedSkill) {
      throw new Error(`Skill not found: ${name}`)
    }

    const project = this.buildReadonlyProject(publishedSkill)
    return {
      project,
      publishedDraft: skillToDraft(publishedSkill),
      draft: null,
      draftMeta: null,
      bindingStates: this.getBindingStates(normalizedName),
    }
  }

  createProject(input: { name: string; description: string; locale?: 'en' | 'zh' }): SkillProjectDetail {
    const normalizedName = normalizeSkillName(input.name)
    this.ensureSkillNameAvailable(normalizedName)

    const rootDir = resolve(this.userSkillsDir, normalizedName)
    mkdirSync(rootDir, { recursive: true })

    const now = new Date().toISOString()
    this.writeProjectMeta(rootDir, {
      schemaVersion: SCHEMA_VERSION,
      managed: true,
      origin: 'user',
      createdAt: now,
      updatedAt: now,
    })

    const draft: SkillAuthoringDraft = {
      frontmatter: {
        name: normalizedName,
        description: input.description,
        version: '1',
      },
      content: '',
      rawMarkdown: '',
    }
    draft.rawMarkdown = stringifySkillMarkdown(draft.frontmatter, draft.content)
    this.writeDraft(rootDir, draft, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: now,
      basedOnPublishedUpdatedAt: undefined,
      isValid: true,
      lastEditorMode: 'form',
    })

    return this.getProject(normalizedName)
  }

  validateDraft(currentName: string, payload: DraftPayload): SkillValidationResult {
    if (payload.mode === 'source') {
      return this.validateRawDraft(currentName, payload.rawMarkdown ?? '')
    }

    const structured = normalizeDraftInput(payload.draft)
    return this.validateStructuredDraft(currentName, structured)
  }

  saveDraft(currentName: string, payload: DraftPayload): SkillProjectDetail {
    const project = this.getManagedProject(currentName)
    const now = new Date().toISOString()
    let validation: SkillValidationResult
    let rawMarkdown = ''

    if (payload.mode === 'source') {
      rawMarkdown = payload.rawMarkdown ?? ''
      validation = this.validateRawDraft(project.name, rawMarkdown)
    } else {
      const structured = normalizeDraftInput(payload.draft)
      validation = this.validateStructuredDraft(project.name, structured)
      rawMarkdown = validation.generatedMarkdown
    }

    mkdirSync(resolve(project.rootDir, DRAFT_DIRNAME), { recursive: true })
    writeFileSync(resolve(project.rootDir, DRAFT_DIRNAME, DRAFT_FILENAME), rawMarkdown, 'utf-8')
    writeFileSync(resolve(project.rootDir, DRAFT_DIRNAME, DRAFT_META_FILENAME), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      updatedAt: now,
      basedOnPublishedUpdatedAt: project.updatedAt,
      isValid: validation.errors.length === 0,
      lastEditorMode: payload.mode,
    } satisfies SkillDraftMeta, null, 2), 'utf-8')

    return this.getProject(project.name)
  }

  async publishDraft(currentName: string, options?: PublishOptions): Promise<SkillProjectDetail> {
    const project = this.getManagedProject(currentName)
    const draft = this.readDraft(project.rootDir)
    if (!draft) {
      throw new Error('No draft to publish')
    }

    const validation = this.validateRawDraft(project.name, draft.rawMarkdown)
    if (validation.errors.length > 0 || !validation.draft) {
      throw new Error(validation.errors[0]?.message ?? 'Draft is invalid')
    }

    const publishedName = validation.draft.frontmatter.name
    if (publishedName !== project.name) {
      this.ensureSkillNameAvailable(publishedName, project.name)
    }
    this.assertValidBindingAgentIds(options?.bindingAgentIds ?? null)

    let rootDir = project.rootDir
    if (publishedName !== project.name) {
      const nextDir = resolve(this.userSkillsDir, publishedName)
      renameSync(project.rootDir, nextDir)
      rootDir = nextDir
      this.renameAgentBindings(project.name, publishedName)
    }

    writeFileSync(resolve(rootDir, ENTRY_FILENAME), validation.generatedMarkdown, 'utf-8')
    const meta = this.readProjectMeta(rootDir)
    const now = new Date().toISOString()
    this.writeProjectMeta(rootDir, {
      schemaVersion: SCHEMA_VERSION,
      managed: true,
      origin: meta?.origin ?? 'user',
      createdAt: meta?.createdAt ?? now,
      updatedAt: now,
    })

    this.applyBindingSelection(publishedName, options?.bindingAgentIds ?? null)
    rmSync(resolve(rootDir, DRAFT_DIRNAME), { recursive: true, force: true })
    this.skillsLoader.refresh()
    await this.agentManager.reloadAgents()

    return this.getProject(publishedName)
  }

  discardDraft(currentName: string): SkillProjectDetail {
    const project = this.getManagedProject(currentName)
    rmSync(resolve(project.rootDir, DRAFT_DIRNAME), { recursive: true, force: true })
    return this.getProject(project.name)
  }

  async deleteProject(currentName: string): Promise<{ ok: true; affectedAgents: Array<{ id: string; name: string }> }> {
    const project = this.getManagedProject(currentName)
    const affectedAgents = this.getBindingStates(project.name)
      .filter((binding) => binding.state !== 'unbound')
      .map((binding) => ({ id: binding.id, name: binding.name }))

    this.removeSkillFromAllAgents(project.name)
    rmSync(project.rootDir, { recursive: true, force: true })
    this.skillsLoader.refresh()
    await this.agentManager.reloadAgents()

    return { ok: true, affectedAgents }
  }

  duplicateProject(currentName: string, nextName?: string): SkillProjectDetail {
    const project = this.getManagedProject(currentName)
    const baseName = nextName ? normalizeSkillName(nextName) : makeDuplicateName(project.name, this.listProjects().map((item) => item.name))
    this.ensureSkillNameAvailable(baseName)

    const sourceDraft = this.readDraft(project.rootDir) ?? this.readPublishedDraft(project.rootDir)
    if (!sourceDraft) {
      throw new Error('Skill has no content to duplicate')
    }

    const duplicated = cloneDraftWithName(sourceDraft, baseName)
    const rootDir = resolve(this.userSkillsDir, baseName)
    mkdirSync(rootDir, { recursive: true })
    const now = new Date().toISOString()
    this.writeProjectMeta(rootDir, {
      schemaVersion: SCHEMA_VERSION,
      managed: true,
      origin: 'duplicated',
      createdAt: now,
      updatedAt: now,
    })
    this.writeDraft(rootDir, duplicated, {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: now,
      basedOnPublishedUpdatedAt: undefined,
      isValid: true,
      lastEditorMode: 'form',
    })

    return this.getProject(baseName)
  }

  async bindSkill(skillName: string, agentId: string): Promise<{ ok: true; state: 'bound' | 'bound_via_wildcard' }> {
    const normalizedName = normalizeSkillName(skillName)
    this.assertSkillExists(normalizedName)
    const projectDir = resolve(this.userSkillsDir, normalizedName)
    if (existsSync(projectDir) && !existsSync(resolve(projectDir, ENTRY_FILENAME))) {
      throw new Error('Publish the skill before binding it to agents')
    }
    const instance = this.agentManager.getAgent(agentId)
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const currentSkills = instance.config.skills ?? []
    if (currentSkills.includes('*')) {
      return { ok: true, state: 'bound_via_wildcard' }
    }

    const nextSkills = Array.from(new Set([...currentSkills, normalizedName]))
    this.writeAgentSkills(instance.config, nextSkills)
    await this.agentManager.reloadAgents()
    return { ok: true, state: 'bound' }
  }

  async unbindSkill(skillName: string, agentId: string): Promise<{ ok: true }> {
    const normalizedName = normalizeSkillName(skillName)
    const instance = this.agentManager.getAgent(agentId)
    if (!instance) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const currentSkills = instance.config.skills ?? []
    if (currentSkills.includes('*')) {
      throw new Error('Agent uses wildcard skills; remove wildcard in the agent settings before unbinding a specific skill')
    }

    const nextSkills = currentSkills.filter((item) => item !== normalizedName)
    this.writeAgentSkills(instance.config, nextSkills)
    await this.agentManager.reloadAgents()
    return { ok: true }
  }

  private getManagedProject(name: string): SkillProject {
    const normalizedName = normalizeSkillName(name)
    const rootDir = resolve(this.userSkillsDir, normalizedName)
    if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
      throw new Error(`Skill not found: ${name}`)
    }

    const meta = this.readProjectMeta(rootDir)
    if (!meta?.managed) {
      throw new Error(`Skill is not editable: ${name}`)
    }

    const publishedSkill = this.skillsLoader.loadAllSkills().find((skill) => skill.name === normalizedName && skill.source === 'user') ?? null
    return this.buildManagedProject(rootDir, publishedSkill)
  }

  private listProjectDirectories(): string[] {
    if (!existsSync(this.userSkillsDir)) {
      return []
    }

    return readdirSync(this.userSkillsDir)
      .map((entry) => resolve(this.userSkillsDir, entry))
      .filter((entry) => {
        try {
          return statSync(entry).isDirectory() && !basename(entry).startsWith('.')
        } catch {
          return false
        }
      })
  }

  private buildManagedProject(rootDir: string, publishedSkill: Skill | null): SkillProject {
    const meta = this.readProjectMeta(rootDir)
    const draftMeta = this.readDraftMeta(rootDir)
    const fallbackName = basename(rootDir)
    const publishedDraft = publishedSkill ? skillToDraft(publishedSkill) : this.readPublishedDraft(rootDir)
    const name = publishedSkill?.name ?? publishedDraft?.frontmatter.name ?? fallbackName
    const origin = meta?.origin
      ?? (publishedSkill?.registryMeta ? 'marketplace' : meta?.managed ? 'user' : 'manual')

    return {
      name,
      rootDir,
      entryFile: ENTRY_FILENAME,
      path: resolve(rootDir, ENTRY_FILENAME),
      source: 'user',
      editable: meta?.managed === true,
      managed: meta?.managed === true,
      origin,
      createdAt: meta?.createdAt,
      updatedAt: meta?.updatedAt,
      hasPublished: existsSync(resolve(rootDir, ENTRY_FILENAME)),
      hasDraft: existsSync(resolve(rootDir, DRAFT_DIRNAME, DRAFT_FILENAME)),
      draftUpdatedAt: draftMeta?.updatedAt,
      description: publishedDraft?.frontmatter.description,
      boundAgentIds: this.getBindingStates(name)
        .filter((binding) => binding.state !== 'unbound')
        .map((binding) => binding.id),
    }
  }

  private buildReadonlyProject(skill: Skill): SkillProject {
    const origin = skill.source === 'user'
      ? (skill.registryMeta?.source === 'clawhub' ? 'marketplace' : 'manual')
      : 'builtin'

    return {
      name: skill.name,
      rootDir: resolve(skill.path, '..'),
      entryFile: ENTRY_FILENAME,
      path: skill.path,
      source: skill.source,
      editable: false,
      managed: false,
      origin,
      createdAt: undefined,
      updatedAt: undefined,
      hasPublished: true,
      hasDraft: false,
      draftUpdatedAt: undefined,
      description: skill.frontmatter.description,
      boundAgentIds: this.getBindingStates(skill.name)
        .filter((binding) => binding.state !== 'unbound')
        .map((binding) => binding.id),
    }
  }

  private readProjectMeta(rootDir: string): SkillProjectMeta | null {
    const metaPath = resolve(rootDir, META_FILENAME)
    if (!existsSync(metaPath)) return null

    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8')) as SkillProjectMeta
    } catch {
      return null
    }
  }

  private writeProjectMeta(rootDir: string, meta: SkillProjectMeta): void {
    writeFileSync(resolve(rootDir, META_FILENAME), JSON.stringify(meta, null, 2), 'utf-8')
  }

  private readDraftMeta(rootDir: string): SkillDraftMeta | null {
    const metaPath = resolve(rootDir, DRAFT_DIRNAME, DRAFT_META_FILENAME)
    if (!existsSync(metaPath)) return null

    try {
      return JSON.parse(readFileSync(metaPath, 'utf-8')) as SkillDraftMeta
    } catch {
      return null
    }
  }

  private readPublishedDraft(rootDir: string): SkillAuthoringDraft | null {
    const filePath = resolve(rootDir, ENTRY_FILENAME)
    if (!existsSync(filePath)) return null

    try {
      return parseSkillMarkdown(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  }

  private readDraft(rootDir: string): SkillAuthoringDraft | null {
    const filePath = resolve(rootDir, DRAFT_DIRNAME, DRAFT_FILENAME)
    if (!existsSync(filePath)) return null

    const rawMarkdown = readFileSync(filePath, 'utf-8')
    try {
      return parseSkillMarkdown(rawMarkdown)
    } catch {
      return {
        frontmatter: {
          name: basename(rootDir),
          description: '',
        },
        content: rawMarkdown,
        rawMarkdown,
      }
    }
  }

  private writeDraft(rootDir: string, draft: SkillAuthoringDraft, meta: SkillDraftMeta): void {
    mkdirSync(resolve(rootDir, DRAFT_DIRNAME), { recursive: true })
    writeFileSync(resolve(rootDir, DRAFT_DIRNAME, DRAFT_FILENAME), draft.rawMarkdown, 'utf-8')
    writeFileSync(resolve(rootDir, DRAFT_DIRNAME, DRAFT_META_FILENAME), JSON.stringify(meta, null, 2), 'utf-8')
  }

  private validateStructuredDraft(currentName: string, draft: SkillAuthoringDraft): SkillValidationResult {
    const normalizedName = normalizeSkillName(draft.frontmatter.name || currentName)
    const nextDraft: SkillAuthoringDraft = {
      frontmatter: {
        ...draft.frontmatter,
        name: normalizedName,
        version: sanitizeIntegerVersion(draft.frontmatter.version),
      },
      content: draft.content.trim(),
      rawMarkdown: '',
    }

    const errors: SkillValidationMessage[] = []
    const warnings: SkillValidationMessage[] = []

    if (!draft.frontmatter.name?.trim()) {
      errors.push({ field: 'name', message: 'Skill name is required' })
    }
    if (!draft.frontmatter.description?.trim()) {
      errors.push({ field: 'description', message: 'Skill description is required' })
    }
    if (!normalizedName) {
      errors.push({ field: 'name', message: 'Skill name must contain at least one letter or number' })
    }
    if (draft.frontmatter.version?.trim() && !sanitizeIntegerVersion(draft.frontmatter.version)) {
      errors.push({ field: 'version', message: 'Skill version must be an integer' })
    }

    const conflict = this.findNameConflict(normalizedName, currentName)
    if (conflict) {
      errors.push({ field: 'name', message: conflict })
    }

    if (Array.isArray(nextDraft.frontmatter.requires) && nextDraft.frontmatter.requires.length > 0) {
      const allNames = new Set(this.skillsLoader.loadAllSkills().map((skill) => skill.name))
      for (const required of nextDraft.frontmatter.requires) {
        if (!allNames.has(required)) {
          warnings.push({ field: 'requires', message: `Referenced skill not found: ${required}` })
        }
      }
    }

    if (Array.isArray(nextDraft.frontmatter.conflicts) && nextDraft.frontmatter.conflicts.length > 0) {
      for (const conflictName of nextDraft.frontmatter.conflicts) {
        if (this.skillsLoader.loadAllSkills().some((skill) => skill.name === conflictName)) {
          warnings.push({ field: 'conflicts', message: `Conflicting skill is installed: ${conflictName}` })
        }
      }
    }

    const generatedMarkdown = stringifySkillMarkdown(nextDraft.frontmatter, nextDraft.content)
    nextDraft.rawMarkdown = generatedMarkdown

    try {
      parseSkillMarkdown(generatedMarkdown)
    } catch (error) {
      errors.push({ message: error instanceof Error ? error.message : String(error) })
    }

    return {
      normalizedName,
      errors,
      warnings,
      generatedMarkdown,
      draft: nextDraft,
    }
  }

  private validateRawDraft(currentName: string, rawMarkdown: string): SkillValidationResult {
    const warnings: SkillValidationMessage[] = []

    try {
      const draft = parseSkillMarkdown(rawMarkdown)
      return this.validateStructuredDraft(currentName, draft)
    } catch (error) {
      return {
        normalizedName: normalizeSkillName(currentName),
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
        warnings,
        generatedMarkdown: rawMarkdown,
        draft: null,
      }
    }
  }

  private getBindingStates(skillName: string): Array<{ id: string; name: string; state: 'bound' | 'bound_via_wildcard' | 'unbound' }> {
    return this.agentManager.getAgents().map((agent) => {
      const skills = agent.skills ?? []
      const state = skills.includes('*')
        ? 'bound_via_wildcard'
        : skills.includes(skillName)
          ? 'bound'
          : 'unbound'
      return { id: agent.id, name: agent.name, state }
    })
  }

  private writeAgentSkills(agent: AgentConfig, nextSkills: string[]): void {
    const configPath = resolve(agent.workspaceDir, 'agent.yaml')
    if (!existsSync(configPath)) {
      throw new Error(`agent.yaml not found for agent ${agent.id}`)
    }

    const existingYaml = readFileSync(configPath, 'utf-8')
    const existingConfig = parseYaml(existingYaml) as Record<string, unknown>
    existingConfig.skills = nextSkills
    writeFileSync(configPath, stringifyYaml(existingConfig), 'utf-8')
  }

  private applyBindingSelection(skillName: string, bindingAgentIds: string[] | null): void {
    if (!bindingAgentIds) {
      return
    }

    const uniqueBindingIds = Array.from(new Set(bindingAgentIds.map((agentId) => agentId.trim()).filter(Boolean)))
    const targetAgentIds = new Set(uniqueBindingIds)
    const agents = this.agentManager.getAgents()

    for (const agent of agents) {
      const currentSkills = agent.skills ?? []
      if (currentSkills.includes('*')) {
        continue
      }

      const wantsBinding = targetAgentIds.has(agent.id)
      const hasBinding = currentSkills.includes(skillName)

      if (wantsBinding === hasBinding) {
        continue
      }

      const nextSkills = wantsBinding
        ? Array.from(new Set([...currentSkills, skillName]))
        : currentSkills.filter((item) => item !== skillName)

      this.writeAgentSkills(agent, nextSkills)
      agent.skills = nextSkills
    }
  }

  private assertValidBindingAgentIds(bindingAgentIds: string[] | null): void {
    if (!bindingAgentIds) {
      return
    }

    const targetAgentIds = new Set(bindingAgentIds.map((agentId) => agentId.trim()).filter(Boolean))
    const agentIds = new Set(this.agentManager.getAgents().map((agent) => agent.id))

    for (const agentId of targetAgentIds) {
      if (!agentIds.has(agentId)) {
        throw new Error(`Agent not found: ${agentId}`)
      }
    }
  }

  private renameAgentBindings(oldName: string, newName: string): void {
    for (const agent of this.agentManager.getAgents()) {
      const currentSkills = agent.skills ?? []
      if (!currentSkills.includes(oldName)) continue
      const nextSkills = currentSkills.map((skill) => skill === oldName ? newName : skill)
      this.writeAgentSkills(agent, Array.from(new Set(nextSkills)))
    }
  }

  private removeSkillFromAllAgents(skillName: string): void {
    for (const agent of this.agentManager.getAgents()) {
      const currentSkills = agent.skills ?? []
      if (!currentSkills.includes(skillName)) continue
      this.writeAgentSkills(agent, currentSkills.filter((item) => item !== skillName))
    }
  }

  private ensureSkillNameAvailable(nextName: string, currentName?: string): void {
    const conflict = this.findNameConflict(nextName, currentName)
    if (conflict) {
      throw new Error(conflict)
    }
  }

  private findNameConflict(nextName: string, currentName?: string): string | null {
    if (!nextName) {
      return 'Skill name must contain at least one letter or number'
    }

    if (currentName && nextName === currentName) {
      return null
    }

    const projectDir = resolve(this.userSkillsDir, nextName)
    if (existsSync(projectDir)) {
      return `Skill already exists: ${nextName}`
    }

    const existingSkill = this.skillsLoader.loadAllSkills().find((skill) => skill.name === nextName)
    if (existingSkill) {
      return `Skill name already exists: ${nextName}`
    }

    return null
  }

  private assertSkillExists(name: string): void {
    const existsInProjects = existsSync(resolve(this.userSkillsDir, name))
    const existsInLoader = this.skillsLoader.loadAllSkills().some((skill) => skill.name === name)
    if (!existsInProjects && !existsInLoader) {
      throw new Error(`Skill not found: ${name}`)
    }
  }
}

export function normalizeSkillName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function parseSkillMarkdown(rawMarkdown: string): SkillAuthoringDraft {
  const { frontmatter, content } = parseFrontmatter(rawMarkdown)
  return {
    frontmatter,
    content,
    rawMarkdown,
  }
}

export function stringifySkillMarkdown(frontmatter: SkillFrontmatter, content: string): string {
  const normalized = normalizeFrontmatter(frontmatter)
  const yaml = stringifyYaml(normalized).trim()
  const body = content.trim()
  return `---\n${yaml}\n---\n\n${body}\n`
}

function normalizeFrontmatter(frontmatter: SkillFrontmatter): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    name: normalizeSkillName(frontmatter.name),
    description: frontmatter.description.trim(),
  }

  const version = sanitizeIntegerVersion(frontmatter.version)
  if (version) normalized.version = version
  if (frontmatter.os?.length) normalized.os = frontmatter.os.filter(Boolean)
  if (frontmatter.dependencies?.length) normalized.dependencies = frontmatter.dependencies.filter(Boolean)
  if (frontmatter.env?.length) normalized.env = frontmatter.env.filter(Boolean)
  if (frontmatter.tools?.length) normalized.tools = frontmatter.tools.filter(Boolean)
  if (frontmatter.tags?.length) normalized.tags = frontmatter.tags.filter(Boolean)
  if (frontmatter.globs?.length) normalized.globs = frontmatter.globs.filter(Boolean)
  if (frontmatter.priority) normalized.priority = frontmatter.priority
  if (frontmatter.install && Object.keys(frontmatter.install).length > 0) normalized.install = frontmatter.install
  if (frontmatter.requires?.length) normalized.requires = frontmatter.requires.filter(Boolean)
  if (frontmatter.conflicts?.length) normalized.conflicts = frontmatter.conflicts.filter(Boolean)
  if (frontmatter.setup?.trim()) normalized.setup = frontmatter.setup.trim()
  if (frontmatter.teardown?.trim()) normalized.teardown = frontmatter.teardown.trim()
  if (frontmatter.source?.trim()) normalized.source = frontmatter.source.trim()

  return normalized
}

function normalizeDraftInput(draft: DraftPayload['draft'] | undefined): SkillAuthoringDraft {
  const frontmatter = draft?.frontmatter ?? { name: '', description: '' }
  const content = typeof draft?.content === 'string' ? draft.content : ''
  return {
    frontmatter: {
      name: String(frontmatter.name ?? ''),
      description: String(frontmatter.description ?? ''),
      version: normalizeVersionValue(frontmatter.version),
      os: sanitizeStringArray(frontmatter.os),
      dependencies: sanitizeStringArray(frontmatter.dependencies),
      env: sanitizeStringArray(frontmatter.env),
      tools: sanitizeStringArray(frontmatter.tools),
      tags: sanitizeStringArray(frontmatter.tags),
      globs: sanitizeStringArray(frontmatter.globs),
      priority: frontmatter.priority === 'critical' || frontmatter.priority === 'normal' || frontmatter.priority === 'low'
        ? frontmatter.priority
        : undefined,
      install: sanitizeRecord(frontmatter.install),
      requires: sanitizeStringArray(frontmatter.requires),
      conflicts: sanitizeStringArray(frontmatter.conflicts),
      setup: frontmatter.setup ? String(frontmatter.setup) : undefined,
      teardown: frontmatter.teardown ? String(frontmatter.teardown) : undefined,
      source: frontmatter.source ? String(frontmatter.source) : undefined,
    },
    content,
    rawMarkdown: typeof draft?.rawMarkdown === 'string' ? draft.rawMarkdown : '',
  }
}

function sanitizeIntegerVersion(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = String(value).trim()
  if (!normalized) return undefined
  if (!/^\d+$/.test(normalized)) return undefined
  return String(Number.parseInt(normalized, 10))
}

function normalizeVersionValue(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map(String).map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function sanitizeRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key.trim(), String(item).trim()] as const)
    .filter(([key, item]) => key && item)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function cloneDraftWithName(draft: SkillAuthoringDraft, name: string): SkillAuthoringDraft {
  const nextDraft: SkillAuthoringDraft = {
    frontmatter: {
      ...draft.frontmatter,
      name,
      description: draft.frontmatter.description,
    },
    content: draft.content,
    rawMarkdown: '',
  }
  nextDraft.rawMarkdown = stringifySkillMarkdown(nextDraft.frontmatter, nextDraft.content)
  return nextDraft
}

function skillToDraft(skill: Skill): SkillAuthoringDraft {
  return {
    frontmatter: skill.frontmatter,
    content: skill.content,
    rawMarkdown: stringifySkillMarkdown(skill.frontmatter, skill.content),
  }
}

function makeDuplicateName(name: string, existingNames: string[]): string {
  const existing = new Set(existingNames)
  let suffix = 2
  let candidate = `${name}-copy`
  while (existing.has(candidate)) {
    candidate = `${name}-copy-${suffix}`
    suffix += 1
  }
  return candidate
}
