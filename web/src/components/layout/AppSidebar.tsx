import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  MessageSquare, Bot, CalendarClock, Brain, Puzzle,
  Globe, ScrollText, Settings, PanelLeftClose, PanelLeft,
  SquarePen, Search, MoreHorizontal, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { useSidebar } from '@/hooks/useSidebar'
import { useChatContext } from '@/hooks/useChatContext'
import { groupChatsByDate } from '@/lib/chat-utils'
import { isElectron, getElectronAPI } from '@/api/transport'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface AppSidebarProps {
  onOpenSettings: () => void
}

export function AppSidebar({ onOpenSettings }: AppSidebarProps) {
  const { isCollapsed, toggle } = useSidebar()
  const { t, locale, setLocale } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const chatCtx = useChatContext()
  const isChatRoute = location.pathname === '/'
  const [platform, setPlatform] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (isElectron) setPlatform(getElectronAPI().getPlatform())
  }, [])

  const isMac = platform === 'darwin'

  const navItems = [
    { to: '/', icon: MessageSquare, label: t.nav.chat },
    { to: '/agents', icon: Bot, label: t.nav.agents },
    { to: '/cron', icon: CalendarClock, label: t.nav.tasks },
    { to: '/memory', icon: Brain, label: t.nav.memory },
    { to: '/skills', icon: Puzzle, label: t.nav.skills },
  ]

  const moreItems = [
    { to: '/browser', icon: Globe, label: t.nav.browser },
    { to: '/logs', icon: ScrollText, label: t.nav.logs },
    { to: '/system', icon: Settings, label: t.nav.system },
  ]

  const handleChatClick = (chatId: string) => {
    if (!isChatRoute) navigate('/')
    chatCtx.loadChat(chatId)
  }

  const handleNewChat = () => {
    if (!isChatRoute) navigate('/')
    chatCtx.newChat()
  }

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await chatCtx.deleteChat(deleteTarget)
      setDeleteTarget(null)
    }
  }

  const filteredChats = chatCtx.searchQuery
    ? chatCtx.chatList.filter(c => c.name.toLowerCase().includes(chatCtx.searchQuery.toLowerCase()))
    : chatCtx.chatList

  const chatGroups = groupChatsByDate(filteredChats, {
    today: t.chat.today,
    yesterday: t.chat.yesterday,
    older: t.chat.older,
  })

  // ── 收起状态 ────────────────────────────
  if (isCollapsed) {
    return (
      <aside
        className="w-[52px] shrink-0 flex flex-col items-center border-r border-border bg-muted/30 transition-all duration-200 ease-in-out"
        aria-expanded={false}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 交通灯空间 */}
        {isMac && <div className="h-7 shrink-0" />}

        {/* 顶部操作区 */}
        <div className="flex flex-col items-center gap-1.5 pt-2 pb-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={toggle}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.expand}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.newChat}
          >
            <SquarePen className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { toggle(); setSearchOpen(true) }}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.search}
          >
            <Search className="h-4 w-4" />
          </button>
        </div>

        {/* 分隔线 */}
        <div className="w-6 h-px bg-border mb-3" />

        {/* 页面导航 */}
        <nav className="flex flex-col items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
                isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              aria-label={item.label}
            >
              <item.icon className="h-4 w-4" />
            </NavLink>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t.sidebar.more}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right">
              {moreItems.map(item => (
                <DropdownMenuItem key={item.to} asChild>
                  <NavLink to={item.to} className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* 弹性空间 */}
        <div className="flex-1" />

        {/* 底部 */}
        <div className="flex flex-col items-center gap-1 pb-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            className="w-9 h-7 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {locale === 'en' ? '中' : 'EN'}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t.settings.title}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </aside>
    )
  }

  // ── 展开状态 ────────────────────────────
  return (
    <>
      <aside
        className="w-[260px] shrink-0 flex flex-col border-r border-border bg-muted/30 transition-all duration-200 ease-in-out"
        aria-expanded={true}
      >
        {/* macOS 交通灯空间 */}
        {isMac && <div className="h-7 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />}

        {/* 顶部操作栏 */}
        <div className="flex items-center gap-1.5 px-3 pt-2 pb-2">
          <button
            type="button"
            onClick={toggle}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.collapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.search}
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
            aria-label={t.sidebar.newChat}
          >
            <SquarePen className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索框（展开时内联） */}
        {searchOpen && (
          <div className="px-3 pb-2">
            <input
              type="text"
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t.sidebar.search}
              value={chatCtx.searchQuery}
              onChange={e => chatCtx.setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {/* 页面导航 */}
        <nav className="px-2 pb-2 space-y-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors w-full"
              >
                <MoreHorizontal className="h-4 w-4" />
                {t.sidebar.more}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right">
              {moreItems.map(item => (
                <DropdownMenuItem key={item.to} asChild>
                  <NavLink to={item.to} className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* 会话列表（仅 Chat 路由） */}
        {isChatRoute && (
          <>
            <div className="h-px bg-border mx-3" />
            <div className="flex-1 overflow-y-auto px-2 py-2" role="listbox">
              {chatGroups.length === 0 && (
                <p className="text-xs text-muted-foreground px-2.5 py-4 text-center">{t.chat.noConversations}</p>
              )}
              {chatGroups.map(group => (
                <div key={group.label}>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2.5 pt-3 pb-1">
                    {group.label}
                  </div>
                  {group.items.map(chat => (
                    <div
                      key={chat.chat_id}
                      role="option"
                      aria-selected={chatCtx.chatId === chat.chat_id}
                      className={cn(
                        'group flex items-center rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
                        chatCtx.chatId === chat.chat_id ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                      onClick={() => handleChatClick(chat.chat_id)}
                    >
                      <span className="text-xs truncate flex-1">{chat.name}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center hover:bg-accent transition-all shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={e => { e.stopPropagation(); setDeleteTarget(chat.chat_id) }}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            {t.common.delete}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {/* 非 Chat 路由时填充空间 */}
        {!isChatRoute && <div className="flex-1" />}

        {/* 底部 */}
        <div className="border-t border-border px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Settings className="h-4 w-4" />
            {t.settings.title}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            className="px-2 py-0.5 rounded border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {locale === 'en' ? '中' : 'EN'}
          </button>
        </div>
      </aside>

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.chat.deleteChat}</AlertDialogTitle>
            <AlertDialogDescription>{t.chat.confirmDelete}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
