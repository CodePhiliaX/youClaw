import { useEffect, useState } from 'react'
import { emit } from '@tauri-apps/api/event'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useI18n } from '@/i18n'
import { useAppStore, type CloseAction } from '@/stores/app'

interface CloseConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CloseConfirmDialog({ open, onOpenChange }: CloseConfirmDialogProps) {
  const { t } = useI18n()
  const setCloseAction = useAppStore((s) => s.setCloseAction)
  const [selectedAction, setSelectedAction] = useState<Exclude<CloseAction, ''>>('minimize')

  useEffect(() => {
    if (open) {
      setSelectedAction('minimize')
    }
  }, [open])

  const handleConfirm = async () => {
    await setCloseAction(selectedAction)
    onOpenChange(false)
    await emit(selectedAction === 'minimize' ? 'close-action-minimize' : 'close-action-quit')
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.closeDialog.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.closeDialog.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          value={selectedAction}
          onValueChange={(value) => setSelectedAction(value as Exclude<CloseAction, ''>)}
          className="gap-3"
        >
          <label
            htmlFor="close-action-minimize"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 px-4 py-3 transition-colors hover:bg-muted/30"
          >
            <RadioGroupItem id="close-action-minimize" value="minimize" />
            <span className="text-sm text-foreground">{t.closeDialog.minimize}</span>
          </label>
          <label
            htmlFor="close-action-quit"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 px-4 py-3 transition-colors hover:bg-muted/30"
          >
            <RadioGroupItem id="close-action-quit" value="quit" />
            <span className="text-sm text-foreground">{t.closeDialog.quit}</span>
          </label>
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => void handleConfirm()}>
            {t.common.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
