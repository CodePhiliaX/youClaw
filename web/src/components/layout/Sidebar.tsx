import { NavLink } from 'react-router-dom'
import { MessageSquare, Bot, CalendarClock, Brain, Puzzle, Globe, ScrollText, Settings } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useI18n } from '../../i18n'

export function Sidebar() {
  const { t } = useI18n()

  const navItems = [
    { to: '/', icon: MessageSquare, label: t.nav.chat },
    { to: '/agents', icon: Bot, label: t.nav.agents },
    { to: '/cron', icon: CalendarClock, label: t.nav.tasks },
    { to: '/memory', icon: Brain, label: t.nav.memory },
    { to: '/skills', icon: Puzzle, label: t.nav.skills },
    { to: '/browser', icon: Globe, label: t.nav.browser },
    { to: '/logs', icon: ScrollText, label: t.nav.logs },
    { to: '/system', icon: Settings, label: t.nav.system },
  ]
  return (
    <aside className="w-[220px] border-r border-border flex flex-col shrink-0">
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.disabled ? '#' : item.to}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
              isActive && !item.disabled ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              item.disabled && 'opacity-40 cursor-not-allowed'
            )}
            onClick={e => item.disabled && e.preventDefault()}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
