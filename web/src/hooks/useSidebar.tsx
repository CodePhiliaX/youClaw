import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react'

const STORAGE_KEY = 'youclaw-sidebar-collapsed'

interface SidebarContextType {
  isCollapsed: boolean
  toggle: () => void
  collapse: () => void
  expand: () => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(isCollapsed)) } catch {}
  }, [isCollapsed])

  // 键盘快捷键 Cmd/Ctrl+Shift+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        setIsCollapsed(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const toggle = useCallback(() => setIsCollapsed(prev => !prev), [])
  const collapse = useCallback(() => setIsCollapsed(true), [])
  const expand = useCallback(() => setIsCollapsed(false), [])

  return (
    <SidebarContext.Provider value={{ isCollapsed, toggle, collapse, expand }}>
      {children}
    </SidebarContext.Provider>
  )
}
