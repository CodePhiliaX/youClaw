import type { MouseEventHandler } from "react"
import { isTauri } from "@/api/transport"

/**
 * Returns an onMouseDown handler that initiates window dragging via Tauri API.
 * Attach to any element to make it a drag handle — no extra DOM needed.
 * Only left-click on non-interactive areas triggers drag. No-op in web mode.
 */
export function useDragRegion(): { onMouseDown: MouseEventHandler } {
  const onMouseDown: MouseEventHandler = (e) => {
    if (!isTauri || e.button !== 0) return
    // Skip if clicking on interactive elements
    const interactive = (e.target as HTMLElement).closest(
      "button, a, input, select, textarea, [role=button], [data-no-drag]"
    )
    if (interactive) return
    e.preventDefault()
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().startDragging()
    })
  }
  return { onMouseDown }
}
