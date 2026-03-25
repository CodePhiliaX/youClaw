import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteSkill,
  getMySkills,
  getSkillAgents,
  getSkills,
  toggleSkill,
  type ManagedSkill,
  type MarketplaceSort,
  type Skill,
} from '@/api/client'
import { AlertTriangle, Store } from 'lucide-react'
import { SkillImportPanel, type SkillImportProviderId } from '@/components/SkillImportPanel'
import { SkillEditor } from '@/components/skills/SkillEditor'
import { InstalledSkillsView } from '@/components/skills/InstalledSkillsView'
import { MarketplaceView } from '@/components/skills/MarketplaceView'
import { getExternalSkillSourceLabel } from '@/components/skills/shared-utils'
import { compareByNewestThenName, type InstalledSkillListItem } from '@/components/skills/skills-view-types'
import { type MarketplaceChangeEvent } from '@/lib/marketplace-updates'
import { toMarketplaceResultsViewModel } from '@/lib/marketplace-view-model'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useMarketplaceFeed } from '@/hooks/useMarketplaceFeed'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app'

type TabType = 'installed' | 'marketplace'
type InstalledWorkspace =
  | { kind: 'detail'; skillName: string | null }
  | { kind: 'create' }
  | { kind: 'edit'; skillName: string }
  | { kind: 'import'; provider: SkillImportProviderId }

export function Skills() {
  const { t } = useI18n()
  const registrySource = useAppStore((state) => state.registrySource)
  const registrySources = useAppStore((state) => state.registrySources)
  const setRegistrySource = useAppStore((state) => state.setRegistrySource)
  const refreshRegistrySources = useAppStore((state) => state.refreshRegistrySources)
  const showGlobalBubble = useAppStore((state) => state.showGlobalBubble)
  const [tab, setTab] = useState<TabType>('installed')
  const [installedWorkspace, setInstalledWorkspace] = useState<InstalledWorkspace>({ kind: 'detail', skillName: null })

  const [skills, setSkills] = useState<Skill[]>([])
  const [mySkills, setMySkills] = useState<ManagedSkill[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteAffectedAgents, setDeleteAffectedAgents] = useState<Array<{ id: string; name: string }>>([])

  const [marketplaceSort, setMarketplaceSort] = useState<MarketplaceSort>('trending')
  const [searchQuery, setSearchQuery] = useState('')

  const listScrollRef = useRef<HTMLDivElement | null>(null)

  const marketplaceFeed = useMarketplaceFeed({
    enabled: tab === 'marketplace',
    query: searchQuery,
    sort: marketplaceSort,
    source: registrySource,
    loadFailedMessage: t.skills.marketplaceLoadFailed,
  })
  const {
    activeQuery: marketplaceActiveQuery,
    appendError: marketplaceAppendError,
    applyChange: applyMarketplaceChange,
    error: marketplaceError,
    listKey: marketplaceListKey,
    loadMore: loadMoreMarketplace,
    page: marketplacePage,
    refresh: refreshMarketplace,
    status: marketplaceStatus,
  } = marketplaceFeed

  const sourceLabels = useMemo<Record<Skill['source'], string>>(() => ({
    workspace: t.skills.workspace,
    builtin: t.skills.builtin,
    user: t.skills.user,
  }), [t.skills.builtin, t.skills.user, t.skills.workspace])
  const formatSkillMessage = useCallback((template: string, skillName: string) => (
    template.replace('{name}', skillName)
  ), [])

  const refreshInstalledData = useCallback(async () => {
    const [nextSkills, nextMySkills] = await Promise.all([getSkills(), getMySkills()])
    setSkills(nextSkills)
    setMySkills(nextMySkills)
    window.dispatchEvent(new CustomEvent('skills-changed'))
    return { nextSkills, nextMySkills }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshInstalledData().catch(() => {})
      void refreshRegistrySources()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshInstalledData, refreshRegistrySources])

  useEffect(() => {
    if (!deleteTarget) return
    getSkillAgents(deleteTarget)
      .then((res) => setDeleteAffectedAgents(res.agents))
      .catch(() => setDeleteAffectedAgents([]))
  }, [deleteTarget])

  const selectedSkillName = installedWorkspace.kind === 'detail' ? installedWorkspace.skillName : null
  const selectedSkill = skills.find((skill) => skill.name === selectedSkillName)
  const selectedManagedSkill = mySkills.find((skill) => skill.name === selectedSkillName) ?? null
  const editableSkills = mySkills.filter((skill) => skill.editable)
  const editableSkillNames = useMemo(() => new Set(editableSkills.map((skill) => skill.name)), [editableSkills])

  const customSkillItems = useMemo<InstalledSkillListItem[]>(() => (
    [...editableSkills]
      .sort(compareByNewestThenName)
      .map((skill) => ({
        kind: 'editable',
        name: skill.name,
        description: skill.description || t.skills.skillDescriptionFallback,
        sourceLabel: t.skills.sourceCustom,
        skill,
        sortTimestamp: skill.sortTimestamp,
      }))
  ), [editableSkills, t.skills.skillDescriptionFallback, t.skills.sourceCustom])

  const externalSkillItems = useMemo<InstalledSkillListItem[]>(() => (
    skills
      .filter((skill) => (
        skill.catalogGroup === 'user'
        && skill.userSkillKind === 'external'
        && !editableSkillNames.has(skill.name)
      ))
      .sort(compareByNewestThenName)
      .map((skill) => ({
        kind: 'installed',
        name: skill.name,
        description: skill.frontmatter.description || t.skills.skillDescriptionFallback,
        sourceLabel: getExternalSkillSourceLabel(skill, t),
        skill,
        sortTimestamp: skill.sortTimestamp,
      }))
  ), [editableSkillNames, skills, t])

  const builtinSkillItems = useMemo<InstalledSkillListItem[]>(() => (
    skills
      .filter((skill) => skill.catalogGroup === 'builtin' && !editableSkillNames.has(skill.name))
      .sort(compareByNewestThenName)
      .map((skill) => ({
        kind: 'installed',
        name: skill.name,
        description: skill.frontmatter.description || t.skills.skillDescriptionFallback,
        sourceLabel: sourceLabels[skill.source],
        skill,
        sortTimestamp: skill.sortTimestamp,
      }))
  ), [editableSkillNames, skills, sourceLabels, t.skills.skillDescriptionFallback])

  const marketplaceResultsViewModel = useMemo(
    () => toMarketplaceResultsViewModel(
      marketplacePage,
      marketplaceActiveQuery,
      marketplaceAppendError,
      t,
    ),
    [marketplaceActiveQuery, marketplaceAppendError, marketplacePage, t],
  )

  const openSkillBuilder = useCallback((skillName: string) => {
    setInstalledWorkspace({ kind: 'edit', skillName })
  }, [])

  const handleMarketplaceLoadMore = useCallback(() => {
    void loadMoreMarketplace()
  }, [loadMoreMarketplace])

  const handleMarketplaceChanged = useCallback((change?: MarketplaceChangeEvent) => {
    applyMarketplaceChange(change)
    refreshInstalledData().catch(() => {})
    if (tab === 'marketplace') {
      void refreshMarketplace()
    }
  }, [applyMarketplaceChange, refreshInstalledData, refreshMarketplace, tab])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
  }, [])

  const handleImportSuccess = useCallback(async () => {
    const existingNames = new Set(skills.map((skill) => skill.name))
    const { nextSkills } = await refreshInstalledData()
    const importedSkill = nextSkills
      .filter((skill) => skill.catalogGroup === 'user' && !existingNames.has(skill.name))
      .sort(compareByNewestThenName)[0]

    setInstalledWorkspace({
      kind: 'detail',
      skillName: importedSkill?.name ?? selectedSkillName ?? null,
    })
  }, [refreshInstalledData, selectedSkillName, skills])

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null)
    setDeleteAffectedAgents([])
  }, [])

  const installedWorkspaceContent = useMemo(() => {
    if (installedWorkspace.kind === 'create') {
      return (
        <SkillEditor
          mode="create"
          skillName={null}
          onBack={() => {
            setInstalledWorkspace({ kind: 'detail', skillName: null })
          }}
          onSkillSelected={(skillName) => {
            if (skillName) {
              setInstalledWorkspace({ kind: 'edit', skillName })
              return
            }
            setInstalledWorkspace({ kind: 'detail', skillName: null })
          }}
          onSkillsChanged={() => {
            void refreshInstalledData()
          }}
        />
      )
    }

    if (installedWorkspace.kind === 'edit') {
      return (
        <SkillEditor
          mode="edit"
          skillName={installedWorkspace.skillName}
          onBack={() => {
            setInstalledWorkspace({ kind: 'detail', skillName: installedWorkspace.skillName })
          }}
          onSkillSelected={(skillName) => {
            if (skillName) {
              setInstalledWorkspace({ kind: 'edit', skillName })
              return
            }
            setInstalledWorkspace({ kind: 'detail', skillName: null })
          }}
          onSkillsChanged={() => {
            void refreshInstalledData()
          }}
        />
      )
    }

    if (installedWorkspace.kind === 'import') {
      return (
        <SkillImportPanel
          mode={installedWorkspace.provider}
          onImported={handleImportSuccess}
          existingSkillNames={skills.map((skill) => skill.name)}
        />
      )
    }

    return undefined
  }, [handleImportSuccess, installedWorkspace, refreshInstalledData, skills])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="inline-flex items-center gap-1 rounded-xl bg-muted/60 p-1">
          <button
            data-testid="skills-installed-tab"
            onClick={() => setTab('installed')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              tab === 'installed'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.skills.installed}
          </button>
          <button
            data-testid="skills-marketplace-tab"
            onClick={() => setTab('marketplace')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              tab === 'marketplace'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Store className="h-3 w-3" />
            {t.skills.marketplace}
          </button>
        </div>
      </div>

      {tab === 'installed' && (
        <InstalledSkillsView
          builtinSkillItems={builtinSkillItems}
          externalSkillItems={externalSkillItems}
          customSkillItems={customSkillItems}
          selectedSkill={selectedSkill}
          selectedManagedSkill={selectedManagedSkill}
          selected={selectedSkillName}
          setSelected={(skillName) => setInstalledWorkspace({ kind: 'detail', skillName })}
          onEditSkill={openSkillBuilder}
          onCreateSkill={() => {
            setInstalledWorkspace({ kind: 'create' })
          }}
          onImportSkill={(provider) => {
            setInstalledWorkspace({ kind: 'import', provider })
          }}
          onToggleSkill={async (skillName, enabled) => {
            try {
              await toggleSkill(skillName, enabled)
              await refreshInstalledData()
              showGlobalBubble({
                message: formatSkillMessage(
                  enabled ? t.skills.skillEnabledSuccess : t.skills.skillDisabledSuccess,
                  skillName,
                ),
              })
            } catch (error) {
              showGlobalBubble({
                type: 'error',
                message: error instanceof Error && error.message
                  ? error.message
                  : formatSkillMessage(
                    enabled ? t.skills.skillEnableFailed : t.skills.skillDisableFailed,
                    skillName,
                  ),
              })
            }
          }}
          onDeleteSkill={(skillName) => setDeleteTarget(skillName)}
          onReloadSkills={() => {
            void refreshInstalledData()
          }}
          listRef={listScrollRef}
          workspaceContent={installedWorkspaceContent}
        />
      )}

      {tab === 'marketplace' && (
        <MarketplaceView
          resultsViewModel={marketplaceResultsViewModel}
          marketplaceStatus={marketplaceStatus}
          marketplaceError={marketplaceError}
          marketplaceAppendError={marketplaceAppendError}
          marketplaceSort={marketplaceSort}
          setMarketplaceSort={setMarketplaceSort}
          registrySource={registrySource}
          registrySources={registrySources}
          onRegistrySourceChange={setRegistrySource}
          searchQuery={searchQuery}
          handleSearchChange={handleSearchChange}
          onChanged={handleMarketplaceChanged}
          onLoadMore={handleMarketplaceLoadMore}
          onRetryLoadMore={() => {
            void loadMoreMarketplace()
          }}
          listKey={marketplaceListKey}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.skills.deleteSkill}</AlertDialogTitle>
            <AlertDialogDescription>{t.skills.confirmDeleteSkill}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteAffectedAgents.length > 0 && (
            <div className="space-y-1 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-yellow-500">
                <AlertTriangle className="h-4 w-4" />
                <span>{t.skills.deleteAffectsAgents}</span>
              </div>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {deleteAffectedAgents.map((agent) => (
                  <li key={agent.id}>{agent.name}</li>
                ))}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return
                const skillName = deleteTarget
                try {
                  await deleteSkill(skillName)
                  setInstalledWorkspace({ kind: 'detail', skillName: null })
                  await refreshInstalledData()
                  showGlobalBubble({
                    message: formatSkillMessage(t.skills.skillDeleteSuccess, skillName),
                  })
                } catch (error) {
                  showGlobalBubble({
                    type: 'error',
                    message: error instanceof Error && error.message
                      ? error.message
                      : formatSkillMessage(t.skills.skillDeleteFailed, skillName),
                  })
                }
                closeDeleteDialog()
              }}
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
