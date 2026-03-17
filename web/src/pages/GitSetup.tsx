import { useEffect, useState } from "react"
import { useI18n } from "@/i18n"
import { useAppStore } from "@/stores/app"
import { Download, Loader2, CheckCircle2, AlertTriangle, Minus, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isTauri } from "@/api/transport"
import { useDragRegion } from "@/hooks/useDragRegion"
import logoUrl from "@/assets/logo.png"

const GIT_DOWNLOAD_URL = "https://cdn.chat2db-ai.com/youclaw/website/Git-2.53.0.2-64-bit.exe.zip"

export function GitSetup() {
  const { t } = useI18n()
  const recheckGit = useAppStore((s) => s.recheckGit)
  const gitAvailable = useAppStore((s) => s.gitAvailable)
  const [detected, setDetected] = useState(false)
  const [platform, setPlatform] = useState("")
  const drag = useDragRegion()

  useEffect(() => {
    if (!isTauri) return
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_platform").then(setPlatform)
    })
  }, [])

  // Poll for git availability every 3 seconds
  useEffect(() => {
    if (gitAvailable) return

    const interval = setInterval(async () => {
      const available = await recheckGit()
      if (available) {
        setDetected(true)
        clearInterval(interval)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [gitAvailable, recheckGit])

  const isWin = platform === "windows"

  const handleDownload = () => {
    if (isTauri) {
      import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
        openUrl(GIT_DOWNLOAD_URL)
      })
    } else {
      window.open(GIT_DOWNLOAD_URL, "_blank")
    }
  }

  const steps = [
    t.gitSetup.step1,
    t.gitSetup.step2,
    t.gitSetup.step3,
    t.gitSetup.step4,
  ]

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-background to-muted/30">
      {/* Windows: titlebar with controls */}
      {isWin && (
        <div className="h-9 shrink-0 flex items-center select-none border-b border-border/50" {...drag}>
          <div className="flex-1" />
          <GitSetupWindowControls />
        </div>
      )}

      <div className="flex-1 flex items-center justify-center overflow-auto p-8" {...(isWin ? {} : drag)}>
        <div className="w-full max-w-lg space-y-8">
          {/* Logo & Title */}
          <div className="text-center">
            <div className="inline-block transition-transform hover:scale-105 duration-300">
              <img
                src={logoUrl}
                alt="YouClaw Logo"
                className="w-20 h-20 p-2 mx-auto rounded-2xl shadow-lg border border-border/50 bg-white"
              />
            </div>
            <h1 className="mt-5 text-2xl font-bold text-foreground tracking-tight">YouClaw</h1>
          </div>

          {/* Warning Card */}
          <div className="bg-card rounded-2xl shadow-lg border border-border/50 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="bg-amber-500/10 p-2.5 rounded-xl text-amber-500 shrink-0 mt-0.5">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t.gitSetup.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {t.gitSetup.description}
                </p>
              </div>
            </div>

            {/* Download Button */}
            <Button
              size="lg"
              onClick={handleDownload}
              className="w-full gap-2 py-6 text-sm font-semibold rounded-xl shadow-lg shadow-primary/20 active:scale-[0.98] transition-all duration-200"
            >
              <Download size={18} />
              {t.gitSetup.downloadButton}
            </Button>

            {/* Steps */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-medium text-foreground">{t.gitSetup.steps}</h3>
              <ol className="space-y-2">
                {steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Detection Status */}
            <div className="flex items-center justify-center gap-2 pt-2 border-t border-border/50">
              {detected ? (
                <>
                  <CheckCircle2 size={16} className="text-green-500" />
                  <span className="text-sm font-medium text-green-600 dark:text-green-400">
                    {t.gitSetup.detected}
                  </span>
                </>
              ) : (
                <>
                  <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t.gitSetup.detecting}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GitSetupWindowControls() {
  const btnBase =
    'inline-flex items-center justify-center w-[46px] h-full transition-colors duration-150 text-foreground/70 hover:text-foreground'

  const handleMinimize = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().minimize())
  }
  const handleToggleMaximize = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
  }
  const handleClose = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())
  }

  const stopDrag = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="flex h-full shrink-0">
      <button type="button" onClick={handleMinimize} onMouseDown={stopDrag} className={`${btnBase} hover:bg-muted`} aria-label="Minimize">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={handleToggleMaximize} onMouseDown={stopDrag} className={`${btnBase} hover:bg-muted`} aria-label="Maximize">
        <Square className="h-3 w-3" />
      </button>
      <button type="button" onClick={handleClose} onMouseDown={stopDrag} className={`${btnBase} hover:bg-destructive hover:text-destructive-foreground`} aria-label="Close">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
