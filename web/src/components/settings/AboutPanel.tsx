import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { isTauri } from "@/api/transport"
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
  const [update, setUpdate] = useState<UpdateState>({
    status: "idle",
    message: "",
    progress: 0,
  })

  useEffect(() => {
    if (!isTauri) return

    // 通过 Tauri command 获取版本
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string>("get_version").then((v) => setVersion("v" + v))
    })
  }, [])

  const handleCheck = async () => {
    if (!isTauri) return
    setUpdate({ status: "checking", message: t.settings.checkingUpdates, progress: 0 })

    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const update = await check()

      if (update) {
        setUpdate({
          status: "available",
          message: `${t.settings.downloading} v${update.version}...`,
          progress: 0,
          newVersion: update.version,
        })

        let downloaded = 0
        let contentLength = 0

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              contentLength = event.data.contentLength ?? 0
              break
            case "Progress":
              downloaded += event.data.chunkLength
              const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0
              setUpdate((prev) => ({
                ...prev,
                status: "downloading",
                message: `${t.settings.downloading}... ${pct}%`,
                progress: pct,
              }))
              break
            case "Finished":
              setUpdate({
                status: "ready",
                message: t.settings.readyToInstall,
                progress: 100,
              })
              break
          }
        })
      } else {
        setUpdate({ status: "up-to-date", message: t.settings.upToDate, progress: 0 })
        setTimeout(() => {
          setUpdate({ status: "idle", message: "", progress: 0 })
        }, 3000)
      }
    } catch (err) {
      setUpdate({
        status: "error",
        message: `${t.settings.updateError}: ${err instanceof Error ? err.message : String(err)}`,
        progress: 0,
      })
    }
  }

  const handleRelaunch = async () => {
    if (!isTauri) return
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await relaunch()
    } catch {}
  }

  const isChecking = update.status === "checking"
  const showProgress = update.status === "available" || update.status === "downloading"
  const showInstall = update.status === "ready"

  return (
    <div className="flex flex-col items-center pt-8">
      <h2 className="text-2xl font-bold mb-1">{t.settings.appName}</h2>
      <p className="text-sm text-muted-foreground mb-8">
        {isTauri ? version : t.settings.webVersion}
      </p>

      {/* 更新功能仅在桌面模式显示 */}
      {isTauri && (
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
              <Button className="w-full" onClick={handleRelaunch}>
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
        </>
      )}

      {!isTauri && (
        <p className="text-sm text-muted-foreground">{t.settings.webModeHint}</p>
      )}
    </div>
  )
}
