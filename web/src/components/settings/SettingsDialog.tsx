import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import { GeneralPanel } from "./GeneralPanel"
import { MarketplacePanel } from "./MarketplacePanel"
import { ModelsPanel } from "./ModelsPanel"
import { AccountPanel } from "./AccountPanel"
import { AboutPanel } from "./AboutPanel"
import { InvitationPanel } from "./InvitationPanel"
import { EnvironmentPanel } from "./EnvironmentPanel"
import { Channels } from "@/pages/Channels"
import { BrowserProfiles } from "@/pages/BrowserProfiles"
import { X, User, Palette, Cpu, Radio, Globe, Info, UserPlus, Store, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"

type Tab = "account" | "general" | "marketplace" | "models" | "channels" | "browser" | "environment" | "invitation" | "about"

export type SettingsTab = Tab

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: Tab
}

export function SettingsDialog({ open, onOpenChange, initialTab }: SettingsDialogProps) {
  const { t } = useI18n()
  const cloudEnabled = useAppStore((s) => s.cloudEnabled)
  const [currentTab, setCurrentTab] = useState<Tab>(initialTab ?? (cloudEnabled ? "account" : "general"))

  // Sync with initialTab when dialog opens
  useEffect(() => {
    if (open && initialTab) {
      setCurrentTab(initialTab)
    }
  }, [open, initialTab])

  const allTabs: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }>; cloud?: boolean }[] = [
    { id: "account", label: t.account.title, icon: User, cloud: true },
    { id: "general", label: t.settings.general, icon: Palette },
    { id: "models", label: t.settings.models, icon: Cpu },
    { id: "marketplace", label: t.settings.marketplaceConfig, icon: Store },
    { id: "channels", label: t.nav.channels, icon: Radio },
    { id: "browser", label: t.nav.browser, icon: Globe },
    { id: "environment", label: t.settings.environment, icon: Terminal },
    { id: "invitation", label: t.invitation.title, icon: UserPlus, cloud: true },
    { id: "about", label: t.settings.about, icon: Info },
  ]

  // Hide cloud-dependent tabs in offline mode
  const tabs = allTabs.filter((tab) => !tab.cloud || cloudEnabled)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-5xl h-[85vh] p-0 flex overflow-hidden bg-background rounded-2xl">
        {/* Close button */}
        <DialogClose className="absolute right-4 top-4 z-10 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <X size={16} />
        </DialogClose>

        {/* Sidebar */}
        <div className="w-[200px] bg-muted/50 border-r border-border p-4 flex flex-col shrink-0">
          <h3 className="text-base font-semibold px-3 mb-4">{t.settings.title}</h3>
          <div className="flex-1 space-y-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  currentTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <tab.icon size={16} />
                <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className={cn(
          "flex-1 overflow-hidden",
          currentTab === "account" || currentTab === "general" || currentTab === "marketplace" || currentTab === "models" || currentTab === "environment" || currentTab === "invitation" || currentTab === "about"
            ? "p-8 overflow-y-auto"
            : ""
        )}>
          {currentTab === "account" && <AccountPanel />}
          {currentTab === "general" && <GeneralPanel />}
          {currentTab === "marketplace" && <MarketplacePanel />}
          {currentTab === "models" && <ModelsPanel />}
          {currentTab === "channels" && <Channels />}
          {currentTab === "browser" && <BrowserProfiles />}
          {currentTab === "environment" && <EnvironmentPanel />}
          {currentTab === "invitation" && <InvitationPanel />}
          {currentTab === "about" && <AboutPanel />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
