import type { ReactNode, RefObject } from 'react'
import type { ManagedSkill, Skill } from '@/api/client'
import { SkillDetailView } from '@/components/skills/SkillDetailView'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidePanel } from '@/components/layout/SidePanel'
import { useI18n } from '@/i18n'
import { useDragRegion } from '@/hooks/useDragRegion'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  Github,
  Link2,
  Plus,
  Puzzle,
} from 'lucide-react'
import {
  SkillListItem,
} from './shared'
import type { InstalledSkillListItem } from './skills-view-types'

interface InstalledSkillsViewProps {
  listRef: RefObject<HTMLDivElement | null>
  builtinSkillItems: InstalledSkillListItem[]
  externalSkillItems: InstalledSkillListItem[]
  customSkillItems: InstalledSkillListItem[]
  selected: string | null
  setSelected: (value: string | null) => void
  selectedSkill?: Skill
  selectedManagedSkill?: ManagedSkill | null
  onCreateSkill: () => void
  onImportSkill: (provider: 'raw-url' | 'github') => void
  onEditSkill: (skillName: string) => void
  onDeleteSkill: (skillName: string) => void
  onToggleSkill: (skillName: string, enabled: boolean) => Promise<void>
  onReloadSkills: () => void
  workspaceContent?: ReactNode
}

export function InstalledSkillsView({
  listRef,
  builtinSkillItems,
  externalSkillItems,
  customSkillItems,
  selected,
  setSelected,
  selectedSkill,
  selectedManagedSkill,
  onCreateSkill,
  onImportSkill,
  onEditSkill,
  onDeleteSkill,
  onToggleSkill,
  onReloadSkills,
  workspaceContent,
}: InstalledSkillsViewProps) {
  const { t } = useI18n()
  const drag = useDragRegion()

  return (
    <div className="flex flex-1 min-h-0">
      <SidePanel>
        <div className="h-12 shrink-0 px-3 border-b border-border flex items-center justify-between gap-2" {...drag}>
          <h2 className="font-semibold text-sm">{t.skills.title}</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
                {t.skills.newSkill}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
              <DropdownMenuItem className="cursor-pointer" onSelect={onCreateSkill}>
                <Plus className="h-4 w-4" />
                {t.skills.customSkill}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onSelect={() => onImportSkill('raw-url')}>
                <Link2 className="h-4 w-4" />
                {t.skills.importFromRawUrl}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onSelect={() => onImportSkill('github')}>
                <Github className="h-4 w-4" />
                {t.skills.importFromGitHub}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2"
        >
          {externalSkillItems.length === 0 && customSkillItems.length === 0 && builtinSkillItems.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">{t.skills.noSkills}</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.skills.groupBuiltin}</div>
                {builtinSkillItems.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">{t.skills.noSkills}</div>
                ) : (
                  builtinSkillItems.map((item) => (
                    <SkillListItem key={`${item.kind}-${item.name}`} item={item} selected={selected} setSelected={setSelected} onEditSkill={onEditSkill} t={t} />
                  ))
                )}
              </div>

              <div className="space-y-2">
                <div className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.skills.groupUser}</div>
                <div className="space-y-1">
                  <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{t.skills.groupExternal}</div>
                  {externalSkillItems.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t.skills.noExternalSkills}</div>
                  ) : (
                    externalSkillItems.map((item) => (
                      <SkillListItem key={`${item.kind}-${item.name}`} item={item} selected={selected} setSelected={setSelected} onEditSkill={onEditSkill} t={t} />
                    ))
                  )}
                </div>
                <div className="space-y-1">
                  <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">{t.skills.groupCustom}</div>
                  {customSkillItems.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t.skills.noCustomSkills}</div>
                  ) : (
                    customSkillItems.map((item) => (
                      <SkillListItem key={`${item.kind}-${item.name}`} item={item} selected={selected} setSelected={setSelected} onEditSkill={onEditSkill} t={t} />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </SidePanel>

      <div className="flex-1 min-h-0 overflow-hidden">
        {workspaceContent ?? (
          <div className="h-full overflow-y-auto p-6">
            {selectedSkill ? (
              <SkillDetailView
                skill={selectedSkill}
                managedSkill={selectedManagedSkill}
                onEditSkill={onEditSkill}
                onDeleteSkill={onDeleteSkill}
                onReloadSkills={onReloadSkills}
                onToggleSkill={onToggleSkill}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Puzzle className="mx-auto mb-4 h-12 w-12 opacity-20" />
                  <p>{t.skills.selectSkill}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
