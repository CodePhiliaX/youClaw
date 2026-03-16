import { Minus, Square, X } from 'lucide-react'
import { useDragRegion } from '@/hooks/useDragRegion'

/**
 * Windows custom title bar: drag region + minimize/maximize/close
 */
export function WindowsTitleBar() {
  const drag = useDragRegion()

  const handleMinimize = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().minimize()
    })
  }

  const handleToggleMaximize = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().toggleMaximize()
    })
  }

  const handleClose = () => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().close()
    })
  }

  const btnBase =
    'inline-flex items-center justify-center w-[46px] h-full transition-colors duration-150 text-foreground/70 hover:text-foreground'

  // Stop mousedown propagation so drag handler on parent doesn't interfere
  const stopDrag = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      className="h-9 shrink-0 flex items-center select-none border-b border-[var(--subtle-border)]"
      {...drag}
    >
      <div className="flex-1" />
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
    </div>
  )
}
