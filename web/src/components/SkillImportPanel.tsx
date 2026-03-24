import { useCallback, useMemo, useState } from 'react'
import {
  importFromGitHub,
  importFromRawUrl,
  probeGitHubSkillImport,
  probeRawUrlImport,
} from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import {
  extractDuplicateSkillName,
  getPrimaryImportErrorCode,
  mapImportActionError,
  normalizePastedUrl,
  resolveImportModeFromUrl,
} from '@/lib/skill-import'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { Download, FolderGit2, Link2, Loader2, Sparkles, Wand2 } from 'lucide-react'

export type SkillImportProviderId = 'raw-url' | 'github'

type ProviderFormValues = Record<string, string>
type ProbeResult = {
  provider: SkillImportProviderId
  ok: boolean
  suggestedName?: string
  summary?: string
}

interface ProviderField {
  key: string
  label: string
  placeholder: string
  optional?: boolean
}

interface ProviderDefinition {
  title: string
  description: string
  icon: typeof Link2
  fields: ProviderField[]
  probe: (values: ProviderFormValues) => Promise<ProbeResult>
  importSkill: (values: ProviderFormValues) => Promise<{ ok: boolean }>
}

const initialForms: Record<SkillImportProviderId, ProviderFormValues> = {
  'raw-url': { url: '' },
  github: { repoUrl: '', path: '', ref: '' },
}

export function SkillImportPanel({
  mode,
  onImported,
  existingSkillNames = [],
}: {
  mode: SkillImportProviderId
  onImported: () => void | Promise<void>
  existingSkillNames?: string[]
}) {
  const { t } = useI18n()
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [forms, setForms] = useState<Record<SkillImportProviderId, ProviderFormValues>>(initialForms)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [actionStatus, setActionStatus] = useState<'idle' | 'probing' | 'importing'>('idle')
  const [actionError, setActionError] = useState('')
  const existingSkillNameSet = useMemo(() => new Set(existingSkillNames), [existingSkillNames])

  const definitions = useMemo<Record<SkillImportProviderId, ProviderDefinition>>(() => ({
    'raw-url': {
      title: t.skills.importFromRawUrl,
      description: t.skills.importRawUrlDescription,
      icon: Link2,
      fields: [
        {
          key: 'url',
          label: t.skills.importFieldUrl,
          placeholder: t.skills.importFieldUrlPlaceholder,
        },
      ],
      probe: async (values) => {
        const url = values.url.trim()
        return resolveImportModeFromUrl(url) === 'github'
          ? probeGitHubSkillImport({ repoUrl: url })
          : probeRawUrlImport({ url })
      },
      importSkill: async (values) => {
        const url = values.url.trim()
        return resolveImportModeFromUrl(url) === 'github'
          ? importFromGitHub({ repoUrl: url })
          : importFromRawUrl({ url })
      },
    },
    github: {
      title: t.skills.importFromGitHub,
      description: t.skills.importGitHubDescription,
      icon: FolderGit2,
      fields: [
        {
          key: 'repoUrl',
          label: t.skills.importFieldRepoUrl,
          placeholder: t.skills.importFieldRepoUrlPlaceholder,
        },
        {
          key: 'path',
          label: t.skills.importFieldPath,
          placeholder: t.skills.importFieldPathPlaceholder,
          optional: true,
        },
        {
          key: 'ref',
          label: t.skills.importFieldRef,
          placeholder: t.skills.importFieldRefPlaceholder,
          optional: true,
        },
      ],
      probe: async (values) => probeGitHubSkillImport({
        repoUrl: values.repoUrl.trim(),
        path: values.path.trim() || undefined,
        ref: values.ref.trim() || undefined,
      }),
      importSkill: async (values) => importFromGitHub({
        repoUrl: values.repoUrl.trim(),
        path: values.path.trim() || undefined,
        ref: values.ref.trim() || undefined,
      }),
    },
  }), [t.skills])

  const selectedDefinition = definitions[mode]
  const supportsProbe = mode === 'github'
  const formValues = forms[mode]
  const primaryFieldKey = mode === 'github' ? 'repoUrl' : 'url'
  const normalizedPrimaryValue = normalizePastedUrl(formValues[primaryFieldKey] ?? '')
  const primaryFieldErrorCode = getPrimaryImportErrorCode(mode, normalizedPrimaryValue)
  const primaryFieldError = primaryFieldErrorCode ? getImportErrorText(primaryFieldErrorCode, t) : ''
  const requiredFieldsFilled = selectedDefinition.fields
    .filter((field) => !field.optional)
    .every((field) => Boolean(formValues[field.key]?.trim()))
  const canSubmit = requiredFieldsFilled && !primaryFieldError && actionStatus === 'idle'
  const suggestedSkillName = probeResult?.provider === mode ? probeResult.suggestedName?.trim() || '' : ''
  const nameConflictMessage = suggestedSkillName && existingSkillNameSet.has(suggestedSkillName)
    ? t.skills.importSkillAlreadyExists.replace('{name}', suggestedSkillName)
    : ''
  const canImport = canSubmit && (!supportsProbe || !nameConflictMessage)
  const duplicateErrorPrefix = t.skills.importSkillAlreadyExists.split('{name}')[0] || t.skills.importSkillAlreadyExists
  const isDuplicateErrorMessage = Boolean(
    actionError
    && (
      actionError === t.skills.importSkillAlreadyExistsGeneric
      || actionError.startsWith(duplicateErrorPrefix)
    ),
  )
  const visibleActionError = isDuplicateErrorMessage ? '' : actionError

  const updateField = useCallback((key: string, value: string) => {
    setForms((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        [key]: value,
      },
    }))
    setActionError('')
    setProbeResult(null)
  }, [mode])

  const handleProbe = useCallback(async () => {
    if (!supportsProbe || primaryFieldError) {
      setActionError('')
      setProbeResult(null)
      return
    }
    setActionStatus('probing')
    setActionError('')

    try {
      const result = await selectedDefinition.probe(formValues)
      setProbeResult(result)
    } catch (error) {
      setProbeResult(null)
      setActionError(getMappedImportErrorMessage(mode, error, t))
    } finally {
      setActionStatus('idle')
    }
  }, [formValues, mode, primaryFieldError, selectedDefinition, supportsProbe, t.skills.requestFailed])

  const handleImport = useCallback(async () => {
    if (primaryFieldError) {
      setActionError('')
      return
    }
    setActionStatus('importing')
    setActionError('')

    try {
      if (supportsProbe) {
        const nextProbeResult = probeResult?.provider === mode ? probeResult : await selectedDefinition.probe(formValues)
        setProbeResult(nextProbeResult)

        const nextSuggestedName = nextProbeResult.suggestedName?.trim() || ''
        if (nextSuggestedName && existingSkillNameSet.has(nextSuggestedName)) {
          const message = t.skills.importSkillAlreadyExists.replace('{name}', nextSuggestedName)
          showGlobalBubble({ type: 'error', message })
          return
        }
      }

      await selectedDefinition.importSkill(formValues)
      await onImported()
      showGlobalBubble({ message: t.skills.importSuccess })
    } catch (error) {
      const message = getMappedImportErrorMessage(mode, error, t)
      setActionError(message)
      showGlobalBubble({
        type: 'error',
        message,
      })
    } finally {
      setActionStatus('idle')
    }
  }, [existingSkillNameSet, formValues, mode, onImported, primaryFieldError, probeResult, selectedDefinition, showGlobalBubble, supportsProbe, t])

  const ProviderIcon = selectedDefinition.icon

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50">
            <ProviderIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold">{selectedDefinition.title}</h2>
            <p className="text-sm text-muted-foreground">{selectedDefinition.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="rounded-2xl border border-border bg-background/80 p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              {selectedDefinition.fields.map((field) => (
                <label key={field.key} className={cn('space-y-2', field.key === 'url' || field.key === 'repoUrl' ? 'md:col-span-2' : '')}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{field.label}</span>
                    {field.optional && <span className="text-xs font-normal text-muted-foreground">{t.skills.importOptional}</span>}
                  </div>
                  <Input
                    value={formValues[field.key] ?? ''}
                    onChange={(event) => updateField(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    aria-invalid={field.key === primaryFieldKey && Boolean(primaryFieldError)}
                    className={cn(
                      'rounded-xl',
                      field.key === primaryFieldKey && primaryFieldError && 'border-destructive/70 focus-visible:ring-destructive/60',
                    )}
                  />
                  {field.key === primaryFieldKey && primaryFieldError && (
                    <div className="text-sm text-destructive">{primaryFieldError}</div>
                  )}
                </label>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {supportsProbe && (
                <Button
                  variant="outline"
                  onClick={() => void handleProbe()}
                  disabled={!canSubmit}
                  className="disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100"
                >
                  {actionStatus === 'probing' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.skills.importInspect}</>
                  ) : (
                    <><Wand2 className="mr-2 h-4 w-4" />{t.skills.importInspect}</>
                  )}
                </Button>
              )}
              <Button
                onClick={() => void handleImport()}
                disabled={!canImport}
                className="disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100"
              >
                {actionStatus === 'importing' ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.skills.importing}</>
                ) : (
                  <><Download className="mr-2 h-4 w-4" />{t.skills.importNow}</>
                )}
              </Button>
            </div>
          </div>

          {supportsProbe && probeResult && (
            <div className="rounded-2xl border border-border bg-muted/30 px-4 py-4 text-sm">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t.skills.importDetectionResult}</span>
              </div>
              <div className="space-y-3">
                {probeResult.suggestedName && (
                  <div>
                    <div className="text-xs text-muted-foreground">{t.skills.importSuggestedName}</div>
                    <div className="font-medium">{probeResult.suggestedName}</div>
                  </div>
                )}
                {probeResult.summary && (
                  <div>
                    <div className="text-xs text-muted-foreground">{t.skills.importSummary}</div>
                    <div className="whitespace-pre-wrap">{probeResult.summary}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {visibleActionError && (
            <div className="whitespace-pre-wrap rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {visibleActionError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getImportErrorText(code: ReturnType<typeof getPrimaryImportErrorCode>, t: ReturnType<typeof useI18n>['t']): string {
  switch (code) {
    case 'invalid_github_url':
      return t.skills.importInvalidGitHubUrl
    case 'invalid_url':
      return t.skills.importInvalidUrl
    default:
      return t.skills.requestFailed
  }
}

function getMappedImportErrorMessage(
  mode: SkillImportProviderId,
  error: unknown,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const rawMessage = error instanceof Error ? error.message : t.skills.requestFailed
  const code = mapImportActionError(mode, rawMessage)

  switch (code) {
    case 'duplicate_skill': {
      const name = extractDuplicateSkillName(rawMessage)
      return name
        ? t.skills.importSkillAlreadyExists.replace('{name}', name)
        : t.skills.importSkillAlreadyExistsGeneric
    }
    case 'invalid_github_url':
      return `${t.skills.importInvalidGitHubUrl}\n${t.skills.importGitHubUseSupportedLinks}`
    case 'invalid_url':
      return t.skills.importInvalidUrl
    case 'not_skill_directory':
      return `${t.skills.importGitHubNotSkillDirectory}\n${t.skills.importGitHubUseDirectoryOrFile}`
    case 'wrong_skill_file':
      return `${t.skills.importGitHubWrongFile}\n${t.skills.importGitHubUseDirectoryOrFile}`
    case 'not_found':
      return t.skills.importGitHubNotFound
    case 'request_failed':
    default:
      if (rawMessage && !/^API error:\s*\d+$/.test(rawMessage) && rawMessage !== t.skills.requestFailed) {
        return rawMessage
      }
      return mode === 'github' ? t.skills.importGitHubRequestFailed : t.skills.requestFailed
  }
}
