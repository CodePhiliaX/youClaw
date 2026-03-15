import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'

export function useSidebar() {
  const isCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggle = useAppStore((s) => s.toggleSidebar)
  const collapse = useAppStore((s) => s.collapseSidebar)
  const expand = useAppStore((s) => s.expandSidebar)

  // Keyboard shortcut Cmd/Ctrl+Shift+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        useAppStore.getState().toggleSidebar()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return { isCollapsed, toggle, collapse, expand }
}
