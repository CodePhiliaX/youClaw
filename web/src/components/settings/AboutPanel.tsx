import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { isElectron, getElectronAPI } from "@/api/transport"
import { useI18n } from "@/i18n"

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error"

interface UpdateState {
  status: UpdateStatus
  message: string
  progress: number
  newVersion?: string
}

export function AboutPanel() {
  const { t } = useI18n()
  const [version, setVersion] = useState("")
  const [allowPrerelease, setAllowPrerelease] = useState(false)
  const [update, setUpdate] = useState<UpdateState>({
    status: "idle",
    message: "",
    progress: 0,
  })

  useEffect(() => {
    if (!isElectron) return

    const api = getElectronAPI()
    api.getVersion().then((v) => setVersion("v" + v))
    api.getAllowPrerelease().then(setAllowPrerelease)

    const cleanup = api.onUpdateStatus((status, data) => {
      switch (status) {
        case "checking":
          setUpdate({ status: "checking", message: t.settings.checkingUpdates, progress: 0 })
          break
        case "available":
          setUpdate({ status: "available", message: `${t.settings.downloading} v${data}...`, progress: 0, newVersion: data as string })
          break
        case "downloading":
          setUpdate((prev) => ({
            ...prev,
            status: "downloading",
            message: `${t.settings.downloading}... ${Math.round(data as number)}%`,
            progress: Math.round(data as number),
          }))
          break
        case "ready":
          setUpdate({ status: "ready", message: `v${data} ${t.settings.readyToInstall}`, progress: 100, newVersion: data as string })
          break
        case "up-to-date":
          setUpdate({ status: "up-to-date", message: t.settings.upToDate, progress: 0 })
          setTimeout(() => {
            setUpdate({ status: "idle", message: "", progress: 0 })
          }, 3000)
          break
        case "error":
          setUpdate({ status: "error", message: `${t.settings.updateError}: ${data}`, progress: 0 })
          break
      }
    })

    return cleanup
  }, [t])

  const handleCheck = () => {
    if (!isElectron) return
    setUpdate({ status: "checking", message: t.settings.checkingUpdates, progress: 0 })
    getElectronAPI().checkForUpdates()
  }

  const handleInstall = () => {
    if (!isElectron) return
    getElectronAPI().installUpdate()
  }

  const isChecking = update.status === "checking"
  const showProgress = update.status === "available" || update.status === "downloading"
  const showInstall = update.status === "ready"

  return (
    <div className="flex flex-col items-center pt-8">
      <h2 className="text-2xl font-bold mb-1">{t.settings.appName}</h2>
      <p className="text-sm text-muted-foreground mb-8">
        {isElectron ? version : t.settings.webVersion}
      </p>

      {/* 更新功能仅在 Electron 模式显示 */}
      {isElectron && (
        <>
          <div className="w-full max-w-xs">
            {!showInstall && (
              <Button
                className="w-full"
                onClick={handleCheck}
                disabled={isChecking}
              >
                {t.settings.checkForUpdates}
              </Button>
            )}
            {showInstall && (
              <Button className="w-full" onClick={handleInstall}>
                {t.settings.restartAndUpdate}
              </Button>
            )}
            {showProgress && (
              <Progress className="mt-3" value={update.progress} />
            )}
            <p className="mt-3 text-sm text-muted-foreground min-h-[1.2em] text-center">
              {update.message}
            </p>
          </div>
          <label className="flex items-center gap-3 mt-8 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-accent">
            <input
              type="checkbox"
              checked={allowPrerelease}
              onChange={(e) => {
                const value = e.target.checked
                setAllowPrerelease(value)
                getElectronAPI().setAllowPrerelease(value)
              }}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <div>
              <p className="text-sm font-medium">{t.settings.betaUpdates}</p>
              <p className="text-xs text-muted-foreground">{t.settings.betaUpdatesDesc}</p>
            </div>
          </label>
        </>
      )}

      {!isElectron && (
        <p className="text-sm text-muted-foreground">{t.settings.webModeHint}</p>
      )}
    </div>
  )
}
