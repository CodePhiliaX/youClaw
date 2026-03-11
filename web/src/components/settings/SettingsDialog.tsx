import { useState } from "react"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import { GeneralPanel } from "./GeneralPanel"
import { AboutPanel } from "./AboutPanel"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/i18n"

type Tab = "general" | "about"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useI18n()
  const [currentTab, setCurrentTab] = useState<Tab>("general")

  const tabs: { id: Tab; label: string }[] = [
    { id: "general", label: t.settings.general },
    { id: "about", label: t.settings.about },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[560px] max-h-[420px] p-0 flex overflow-hidden">
        {/* 关闭按钮 */}
        <DialogClose className="absolute right-3 top-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <X size={16} />
        </DialogClose>

        {/* 侧边栏 */}
        <div className="w-[160px] bg-muted/50 p-3 flex flex-col gap-1 border-r border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={cn(
                "text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                currentTab === tab.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 p-6 overflow-y-auto">
          {currentTab === "general" ? <GeneralPanel /> : <AboutPanel />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
