import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n"
import { getTauriInvoke, updateCachedBaseUrl, savePreferredPort } from "@/api/transport"

interface PortConflictDialogProps {
  open: boolean
  onResolved: () => void
}

export function PortConflictDialog({ open, onResolved }: PortConflictDialogProps) {
  const { t } = useI18n()
  const [port, setPort] = useState("62602")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const handleRetry = async () => {
    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setError(t.settings.portHint)
      return
    }

    setSaving(true)
    setError("")
    try {
      const invoke = getTauriInvoke()
      await savePreferredPort(portNum)
      await invoke('restart_sidecar')
      updateCachedBaseUrl(`http://localhost:${portNum}`)
      onResolved()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="w-[90vw] max-w-md p-6" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t.settings.portConflictTitle}</DialogTitle>
          <DialogDescription>{t.settings.portConflictHint}</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <Input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => { setPort(e.target.value); setError("") }}
            className="rounded-xl"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleRetry} disabled={saving} className="rounded-xl">
            {saving ? t.settings.portRestarting : t.settings.portRestartNow}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
