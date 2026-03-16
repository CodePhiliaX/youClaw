import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getSkills,
  configureSkillEnv,
  installSkill,
  toggleSkill,
  deleteSkill,
  getMarketplaceSkills,
  getRecommendedSkills,
  installRecommendedSkill,
  uninstallRecommendedSkill,
  updateMarketplaceSkill,
} from '../api/client'
import type { Skill, MarketplacePage, MarketplaceSkill, MarketplaceSort, RecommendedSkill } from '../api/client'
import {
  Puzzle,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FolderOpen,
  Globe,
  Cpu,
  Terminal,
  Key,
  Wrench,
  Download,
  Copy,
  Check,
  Loader2,
  Store,
  Trash2,
  Search,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { SidePanel } from '@/components/layout/SidePanel'
import { useDragRegion } from "@/hooks/useDragRegion"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

const sourceOrder: Skill['source'][] = ['workspace', 'builtin', 'user']

type TabType = 'installed' | 'marketplace'

function EligibilityIcon({ skill }: { skill: Skill }) {
  if (!skill.enabled) {
    return <XCircle className="h-4 w-4 text-muted-foreground" />
  }
  if (skill.usable) {
    return <CheckCircle className="h-4 w-4 text-green-400" />
  }
  if (skill.eligible) {
    return <AlertTriangle className="h-4 w-4 text-yellow-400" />
  }
  return <XCircle className="h-4 w-4 text-red-400" />
}

export function Skills() {
  const { t } = useI18n()
  const drag = useDragRegion()
  const [tab, setTab] = useState<TabType>('installed')
  const [skills, setSkills] = useState<Skill[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [marketplace, setMarketplace] = useState<MarketplacePage>({
    items: [],
    nextCursor: null,
    source: 'clawhub',
    query: '',
    sort: 'trending',
  })
  const [marketplaceStatus, setMarketplaceStatus] = useState<'idle' | 'loading' | 'loading-more' | 'error'>('idle')
  const [marketplaceError, setMarketplaceError] = useState('')
  const [marketplaceSort, setMarketplaceSort] = useState<MarketplaceSort>('trending')

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Unified search state
  const [searchQuery, setSearchQuery] = useState('')
  const [recommended, setRecommended] = useState<RecommendedSkill[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sourceLabels: Record<Skill['source'], string> = {
    workspace: t.skills.workspace,
    builtin: t.skills.project,
    user: t.skills.user,
  }

  const loadSkills = useCallback(() => {
    getSkills().then(setSkills).catch(() => {})
  }, [])

  const loadMarketplace = useCallback(
    (options?: { append?: boolean; cursor?: string | null; query?: string; sort?: MarketplaceSort }) => {
      const append = Boolean(options?.append)
      const query = options?.query ?? searchQuery
      const sort = options?.sort ?? marketplaceSort
      const cursor = append ? (options?.cursor ?? marketplace.nextCursor) : null

      setMarketplaceStatus(append ? 'loading-more' : 'loading')
      setMarketplaceError('')

      getMarketplaceSkills({ query, sort, cursor, limit: 24 })
        .then((page) => {
          setMarketplace((current) => ({
            ...page,
            items: append ? [...current.items, ...page.items] : page.items,
          }))
          setMarketplaceStatus('idle')
        })
        .catch((error) => {
          if (!append) {
            setMarketplace((current) => ({ ...current, items: [], nextCursor: null }))
          }
          setMarketplaceStatus('error')
          setMarketplaceError(error instanceof Error ? error.message : t.skills.marketplaceLoadFailed)
        })
    },
    [marketplace.nextCursor, searchQuery, marketplaceSort, t.skills.marketplaceLoadFailed],
  )

  // Load recommended list (no search query)
  const loadRecommended = useCallback(() => {
    setRecommendedLoading(true)
    getRecommendedSkills()
      .then(setRecommended)
      .catch(() => setRecommended([]))
      .finally(() => setRecommendedLoading(false))
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])
  useEffect(() => {
    if (tab === 'marketplace') {
      if (searchQuery.trim()) {
        loadMarketplace({ query: searchQuery })
      } else {
        loadRecommended()
      }
    }
  }, [tab, searchQuery, marketplaceSort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search input by 300ms
  const handleSearchChange = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setSearchQuery(value), 300)
  }, [])

  // Cleanup timer
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [])

  const selectedSkill = skills.find(s => s.name === selected)

  // Group installed skills by source
  const grouped = sourceOrder
    .map(source => ({
      source,
      skills: skills.filter(s => s.source === source),
    }))
    .filter(g => g.skills.length > 0)

  const isSearching = searchQuery.trim().length > 0
  const hasMarketplaceItems = isSearching ? marketplace.items.length > 0 : recommended.length > 0
  const canLoadMore = isSearching && Boolean(marketplace.nextCursor)

  return (
    <div className="flex h-full flex-col">
      {/* Tab switcher */}
      <div className="border-b border-border px-4 flex gap-0">
        <button
          data-testid="skills-installed-tab"
          onClick={() => setTab('installed')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
            tab === 'installed'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {t.skills.installed}
        </button>
        <button
          data-testid="skills-marketplace-tab"
          onClick={() => setTab('marketplace')}
          className={cn(
            'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
            tab === 'marketplace'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Store className="h-4 w-4" />
          {t.skills.marketplace}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'installed' ? (
        <div className="flex flex-1 min-h-0">
          {/* Left panel: skill list */}
          <SidePanel>
            <div className="h-12 shrink-0 px-3 border-b border-border flex items-center" {...drag}>
              <h2 className="font-semibold text-sm">{t.skills.title}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {grouped.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-8">
                  {t.skills.noSkills}
                </div>
              )}
              {grouped.map(group => (
                <div key={group.source}>
                  <div className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {sourceLabels[group.source]}
                  </div>
                  <div className="space-y-0.5">
                    {group.skills.map(skill => (
                      <button
                        key={skill.name}
                        data-testid="skill-item"
                        onClick={() => setSelected(skill.name)}
                        className={cn(
                          'flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md text-left transition-colors',
                          selected === skill.name ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                        )}
                      >
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                          !skill.enabled ? 'bg-muted text-muted-foreground' : skill.usable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        )}>
                          <Puzzle className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{skill.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{skill.frontmatter.description}</div>
                        </div>
                        <EligibilityIcon skill={skill} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SidePanel>

          {/* Right panel: skill details */}
          <div className="flex-1 p-6 overflow-y-auto">
            {selectedSkill ? (
              <div className="max-w-2xl space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'w-12 h-12 rounded-full flex items-center justify-center',
                    !selectedSkill.enabled ? 'bg-muted' : selectedSkill.usable ? 'bg-green-500/10' : 'bg-red-500/10'
                  )}>
                    <Puzzle className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h1 className="text-xl font-semibold">{selectedSkill.name}</h1>
                      <Badge variant={selectedSkill.source === 'workspace' ? 'default' : 'secondary'}>
                        {sourceLabels[selectedSkill.source]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedSkill.frontmatter.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      data-testid="skill-toggle-btn"
                      variant={selectedSkill.enabled ? 'secondary' : 'default'}
                      size="sm"
                      onClick={async () => {
                        try {
                          await toggleSkill(selectedSkill.name, !selectedSkill.enabled)
                          loadSkills()
                        } catch (error) {
                          console.error('Failed to toggle skill:', error)
                        }
                      }}
                    >
                      {selectedSkill.enabled ? t.skills.disable : t.skills.enable}
                    </Button>
                    {selectedSkill.source !== 'workspace' && (
                      <Button
                        data-testid="skill-delete-btn"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-red-400"
                        onClick={() => setDeleteTarget(selectedSkill.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Eligibility status */}
                <div className="rounded-md border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {!selectedSkill.enabled ? (
                      <>
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{t.skills.disabled}</span>
                      </>
                    ) : selectedSkill.usable ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-400" />
                        <span className="text-green-400">{t.skills.usable}</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        <span className="text-yellow-400">{t.skills.enabledNotReady}</span>
                      </>
                    )}
                  </div>

                  {/* Environment variable configuration */}
                  {selectedSkill.eligibilityDetail?.env.results.length > 0 && (
                    <div className="space-y-2">
                      {selectedSkill.eligibilityDetail.env.results.map(r => (
                        <EnvConfigRow key={r.name} envName={r.name} configured={r.found} onSaved={loadSkills} />
                      ))}
                    </div>
                  )}

                  {/* Missing dependencies with install commands */}
                  {selectedSkill.eligibilityDetail?.dependencies.passed === false && selectedSkill.frontmatter.install && Object.keys(selectedSkill.frontmatter.install).length > 0 && (
                    <div className="pt-2 border-t border-border/50 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Download className="h-3.5 w-3.5" />
                        {t.skills.install}
                      </div>
                      {Object.entries(selectedSkill.frontmatter.install).map(([method, command]) => (
                        <InstallButton key={method} method={method} command={command} skillName={selectedSkill.name} onInstalled={loadSkills} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="grid gap-4">
                  {selectedSkill.frontmatter.version && (
                    <InfoRow label={t.skills.version} value={selectedSkill.frontmatter.version} />
                  )}
                  <InfoRow label={t.skills.path} value={
                    <span className="flex items-center gap-1 font-mono text-xs">
                      <FolderOpen className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedSkill.path}</span>
                    </span>
                  } />
                  {selectedSkill.frontmatter.os && selectedSkill.frontmatter.os.length > 0 && (
                    <InfoRow label={t.skills.os} value={
                      <span className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3 shrink-0" />
                        {selectedSkill.frontmatter.os.map(os => (
                          <Badge key={os} variant="outline" className="text-xs">{os}</Badge>
                        ))}
                      </span>
                    } />
                  )}
                  {selectedSkill.frontmatter.dependencies && selectedSkill.frontmatter.dependencies.length > 0 && (
                    <InfoRow label={t.skills.dependencies} value={
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <Terminal className="h-3 w-3 shrink-0" />
                        {selectedSkill.frontmatter.dependencies.map(dep => (
                          <Badge key={dep} variant="outline" className="text-xs font-mono">{dep}</Badge>
                        ))}
                      </span>
                    } />
                  )}
                  {selectedSkill.frontmatter.env && selectedSkill.frontmatter.env.length > 0 && (
                    <InfoRow label={t.skills.envVars} value={
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <Key className="h-3 w-3 shrink-0" />
                        {selectedSkill.frontmatter.env.map(env => (
                          <Badge key={env} variant="outline" className="text-xs font-mono">{env}</Badge>
                        ))}
                      </span>
                    } />
                  )}
                  {selectedSkill.frontmatter.tools && selectedSkill.frontmatter.tools.length > 0 && (
                    <InfoRow label={t.skills.tools} value={
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <Wrench className="h-3 w-3 shrink-0" />
                        {selectedSkill.frontmatter.tools.map(tool => (
                          <Badge key={tool} variant="outline" className="text-xs">{tool}</Badge>
                        ))}
                      </span>
                    } />
                  )}
                </div>

                {/* Content */}
                {selectedSkill.content && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      {t.skills.content}
                    </h3>
                    <pre className="rounded-md border border-border bg-muted/30 p-4 text-sm overflow-x-auto whitespace-pre-wrap font-mono">
                      {selectedSkill.content}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Puzzle className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>{t.skills.selectSkill}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Marketplace tab */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Single search bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-testid="marketplace-search-input"
                  defaultValue={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t.skills.marketplaceSearchPlaceholder}
                  className="pl-9"
                />
              </div>
              {isSearching && (
                <>
                  <select
                    data-testid="marketplace-sort-select"
                    value={marketplaceSort}
                    onChange={(e) => setMarketplaceSort(e.target.value as MarketplaceSort)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="trending">{t.skills.marketplaceSortTrending}</option>
                    <option value="updated">{t.skills.marketplaceSortUpdated}</option>
                    <option value="downloads">{t.skills.marketplaceSortDownloads}</option>
                    <option value="stars">{t.skills.marketplaceSortStars}</option>
                    <option value="installsCurrent">{t.skills.marketplaceSortInstalls}</option>
                    <option value="installsAllTime">{t.skills.marketplaceSortInstallsAllTime}</option>
                  </select>
                  <Badge variant="outline" className="gap-1 shrink-0">
                    <Sparkles className="h-3 w-3" />
                    {marketplace.source === 'clawhub' ? t.skills.marketplaceSourceRemote : t.skills.marketplaceSourceFallback}
                  </Badge>
                </>
              )}
            </div>

            {/* Section header */}
            {!isSearching && (
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">{t.skills.recommended}</h3>
              </div>
            )}

            {/* Loading state */}
            {(recommendedLoading || marketplaceStatus === 'loading') && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Error state */}
            {marketplaceStatus === 'error' && (
              <div className="text-center text-muted-foreground text-sm py-12">
                <Store className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>{marketplaceError || t.skills.marketplaceLoadFailed}</p>
              </div>
            )}

            {/* Empty state */}
            {!recommendedLoading && marketplaceStatus !== 'loading' && marketplaceStatus !== 'error' && !hasMarketplaceItems && (
              <div className="text-center text-muted-foreground text-sm py-12">
                <Store className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>{isSearching ? t.skills.noMarketplaceSkills : t.skills.noSkills}</p>
              </div>
            )}

            {/* Results: recommended list or search results */}
            {!isSearching && !recommendedLoading && recommended.length > 0 && (
              <div className="grid gap-3">
                {recommended.map(skill => (
                  <MarketplaceCard
                    key={skill.slug}
                    skill={skill}
                    onChanged={() => {
                      loadRecommended()
                      loadSkills()
                    }}
                  />
                ))}
              </div>
            )}

            {isSearching && marketplaceStatus !== 'loading' && marketplace.items.length > 0 && (
              <div className="grid gap-3">
                {marketplace.items.map(skill => (
                  <MarketplaceCard
                    key={skill.slug}
                    skill={skill}
                    onChanged={() => {
                      loadMarketplace()
                      loadSkills()
                    }}
                  />
                ))}
              </div>
            )}

            {canLoadMore && (
              <div className="flex justify-center">
                <Button
                  data-testid="marketplace-load-more"
                  variant="secondary"
                  onClick={() => loadMarketplace({ append: true })}
                  disabled={marketplaceStatus === 'loading-more'}
                >
                  {marketplaceStatus === 'loading-more' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {t.skills.marketplaceLoadMore}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.skills.deleteSkill}</AlertDialogTitle>
            <AlertDialogDescription>{t.skills.confirmDeleteSkill}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!deleteTarget) return
                try {
                  await deleteSkill(deleteTarget)
                  setSelected(null)
                  loadSkills()
                } catch (error) {
                  console.error('Failed to delete skill:', error)
                }
                setDeleteTarget(null)
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

/** Marketplace card */
function MarketplaceCard({ skill, onChanged }: { skill: MarketplaceSkill; onChanged: () => void }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'idle' | 'installing' | 'updating' | 'uninstalling' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleInstall = async () => {
    setStatus('installing')
    setErrorMsg('')
    try {
      const result = await installRecommendedSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.installFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.installFailed)
    }
  }

  const handleUpdate = async () => {
    setStatus('updating')
    setErrorMsg('')
    try {
      const result = await updateMarketplaceSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.updateFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.updateFailed)
    }
  }

  const handleUninstall = async () => {
    setStatus('uninstalling')
    setErrorMsg('')
    try {
      const result = await uninstallRecommendedSkill(skill.slug)
      if (result.ok) {
        setStatus('idle')
        onChanged()
      } else {
        setStatus('error')
        setErrorMsg(result.error || t.skills.installFailed)
      }
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : t.skills.installFailed)
    }
  }

  return (
    <div
      data-testid={`marketplace-card-${skill.slug}`}
      className="rounded-xl border border-border p-4 transition-colors hover:bg-accent/20"
    >
      <div className="flex gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-sm">{skill.displayName}</div>
            {skill.installed && (
              <Badge data-testid={`marketplace-installed-badge-${skill.slug}`} variant="secondary">
                {t.skills.installed}
              </Badge>
            )}
            {skill.hasUpdate && (
              <Badge
                data-testid={`marketplace-update-badge-${skill.slug}`}
                variant="outline"
                className="text-amber-500 border-amber-500/40"
              >
                {t.skills.marketplaceUpdateAvailable}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{skill.summary}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {skill.latestVersion && (
              <span data-testid={`marketplace-latest-version-${skill.slug}`}>
                {t.skills.marketplaceVersionLabel}: {skill.latestVersion}
              </span>
            )}
            {skill.installedVersion && (
              <span data-testid={`marketplace-installed-version-${skill.slug}`}>
                {t.skills.marketplaceInstalledVersionLabel}: {skill.installedVersion}
              </span>
            )}
            {typeof skill.downloads === 'number' && (
              <span>{t.skills.marketplaceDownloadsLabel}: {skill.downloads}</span>
            )}
            {typeof skill.stars === 'number' && (
              <span>{t.skills.marketplaceStarsLabel}: {skill.stars}</span>
            )}
            {typeof skill.installsCurrent === 'number' && (
              <span>{t.skills.marketplaceInstallsLabel}: {skill.installsCurrent}</span>
            )}
            {skill.updatedAt && (
              <span>{t.skills.marketplaceUpdatedLabel}: {formatMarketplaceDate(skill.updatedAt)}</span>
            )}
          </div>

          {(skill.tags.length > 0 || skill.metadata?.os.length || skill.metadata?.systems.length) && (
            <div className="flex flex-wrap gap-2">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {skill.metadata?.os.map((os) => (
                <Badge key={`os-${os}`} variant="outline" className="text-xs">
                  {os}
                </Badge>
              ))}
              {skill.metadata?.systems.map((system) => (
                <Badge key={`sys-${system}`} variant="outline" className="text-xs">
                  {system}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-start gap-2">
          {skill.installed && skill.hasUpdate && (
            <Button
              data-testid={`marketplace-update-${skill.slug}`}
              size="sm"
              variant="secondary"
              className="text-xs"
              onClick={handleUpdate}
              disabled={status === 'updating'}
            >
              {status === 'updating' ? (
                <><RefreshCw className="h-3 w-3 animate-spin mr-1" />{t.skills.updating}</>
              ) : (
                <><RefreshCw className="h-3 w-3 mr-1" />{t.skills.update}</>
              )}
            </Button>
          )}
          {skill.installed ? (
            <Button
              data-testid={`marketplace-uninstall-${skill.slug}`}
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground hover:text-red-400"
              onClick={handleUninstall}
              disabled={status === 'uninstalling'}
            >
              {status === 'uninstalling' ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t.skills.uninstalling}</>
              ) : (
                <><Trash2 className="h-3 w-3 mr-1" />{t.skills.uninstall}</>
              )}
            </Button>
          ) : (
            <Button
              data-testid={`marketplace-install-${skill.slug}`}
              size="sm"
              variant="default"
              className="text-xs"
              onClick={handleInstall}
              disabled={status === 'installing'}
            >
              {status === 'installing' ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t.skills.installing}</>
              ) : (
                <><Download className="h-3 w-3 mr-1" />{t.skills.installFromMarket}</>
              )}
            </Button>
          )}
        </div>
      </div>
      {status === 'error' && errorMsg && (
        <div className="text-xs text-red-400 mt-3">{errorMsg}</div>
      )}
    </div>
  )
}

function formatMarketplaceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString()
}

/** Environment variable row */
function EnvConfigRow({ envName, configured, onSaved }: { envName: string; configured: boolean; onSaved: () => void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(!configured)
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const handleSave = async () => {
    if (!value.trim()) return
    setStatus('saving')
    try {
      await configureSkillEnv(envName, value.trim())
      setStatus('saved')
      setEditing(false)
      setValue('')
      onSaved()
    } catch {
      setStatus('error')
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Key className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <code className="text-xs font-mono shrink-0">{envName}</code>
        <span className="flex-1 text-xs text-muted-foreground font-mono">--------</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setEditing(true); setStatus('idle') }}
          className="h-7 px-2 text-xs"
        >
          {t.common.edit}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Key className={cn("h-3.5 w-3.5 shrink-0", configured ? "text-green-400" : "text-yellow-400")} />
      <code className="text-xs font-mono shrink-0">{envName}</code>
      <Input
        type="password"
        placeholder={t.skills.envPlaceholder}
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus('idle') }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
        className="h-7 text-xs flex-1"
        disabled={status === 'saving'}
        autoFocus
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={handleSave}
        disabled={!value.trim() || status === 'saving'}
        className="h-7 px-2 text-xs"
      >
        {status === 'saving' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        {status === 'saving' ? t.skills.savingEnv : t.skills.configureEnv}
      </Button>
      {configured && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setEditing(false); setValue(''); setStatus('idle') }}
          className="h-7 px-2 text-xs"
        >
          {t.common.cancel}
        </Button>
      )}
    </div>
  )
}

/** Install command row */
function InstallButton({ method, command, skillName, onInstalled }: { method: string; command: string; skillName: string; onInstalled: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<'idle' | 'installing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleCopy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleInstall = async () => {
    setStatus('installing')
    setErrorMsg('')
    try {
      const result = await installSkill(skillName, method)
      if (result.ok) {
        setStatus('success')
        onInstalled()
      } else {
        setStatus('error')
        setErrorMsg(result.stderr || `Exit code: ${result.exitCode}`)
      }
    } catch {
      setStatus('error')
      setErrorMsg('Request failed')
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs shrink-0">{method}</Badge>
        <code className="flex-1 text-xs font-mono bg-muted/50 px-2 py-1.5 rounded truncate">{command}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-md hover:bg-accent transition-colors"
          title="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleInstall}
          disabled={status === 'installing' || status === 'success'}
          className="h-7 px-2 text-xs"
        >
          {status === 'installing' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
          {status === 'success' && <Check className="h-3 w-3 text-green-400 mr-1" />}
          {status === 'success' ? t.skills.installSuccess : status === 'installing' ? t.skills.installing : t.skills.install}
        </Button>
      </div>
      {status === 'error' && errorMsg && (
        <pre className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap">{errorMsg}</pre>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm max-w-[65%] text-right">{value}</span>
    </div>
  )
}
