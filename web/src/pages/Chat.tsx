import { useState, useEffect, useRef, useCallback } from 'react'
import { useChat, type Message } from '../hooks/useChat'
import { getChats, getAgents, deleteChat as deleteChatApi } from '../api/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Send,
  Plus,
  MessageSquare,
  Loader2,
  Search,
  Trash2,
  MoreHorizontal,
  Bot,
  User,
  Sparkles,
  Copy,
  Check,
  Square,
  Wrench,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { ScrollArea } from '../components/ui/scroll-area'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { Badge } from '../components/ui/badge'
import { Separator } from '../components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'

type ChatItem = { chat_id: string; name: string; agent_id: string; channel: string; last_message_time: string }
type Agent = { id: string; name: string }

// 按日期分组对话
function groupChatsByDate(chats: ChatItem[], t: any): { label: string; items: ChatItem[] }[] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000

  const today: ChatItem[] = []
  const yesterday: ChatItem[] = []
  const older: ChatItem[] = []

  for (const chat of chats) {
    const time = new Date(chat.last_message_time).getTime()
    if (time >= todayStart) today.push(chat)
    else if (time >= yesterdayStart) yesterday.push(chat)
    else older.push(chat)
  }

  const groups: { label: string; items: ChatItem[] }[] = []
  if (today.length) groups.push({ label: t.chat.today, items: today })
  if (yesterday.length) groups.push({ label: t.chat.yesterday, items: yesterday })
  if (older.length) groups.push({ label: t.chat.older, items: older })
  return groups
}

export function Chat() {
  const { t } = useI18n()
  const [agentId, setAgentId] = useState('default')
  const [agents, setAgents] = useState<Agent[]>([])
  const { chatId, messages, streamingText, isProcessing, send, loadChat, newChat } = useChat(agentId)
  const [input, setInput] = useState('')
  const [chatList, setChatList] = useState<ChatItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 加载 agents
  useEffect(() => {
    getAgents()
      .then((list) => setAgents(list.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {})
  }, [])

  // 加载聊天列表
  const refreshChats = useCallback(() => {
    getChats().then(setChatList).catch(() => {})
  }, [])

  useEffect(() => { refreshChats() }, [chatId, refreshChats])

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // 自动调节 textarea 高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isProcessing) return
    setInput('')
    send(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleDeleteChat = async (chatIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t.chat.confirmDelete)) return
    try {
      await deleteChatApi(chatIdToDelete)
      if (chatId === chatIdToDelete) newChat()
      refreshChats()
    } catch {}
  }

  const handleNewChat = () => {
    newChat()
    textareaRef.current?.focus()
  }

  // 过滤聊天列表
  const filteredChats = chatList.filter((chat) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return chat.name?.toLowerCase().includes(q) || chat.chat_id.toLowerCase().includes(q)
  })

  const chatGroups = groupChatsByDate(filteredChats, t)

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  // 当前是否为新对话（右面板显示欢迎页）
  const isNewChat = !chatId && messages.length === 0

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* 左面板 — 对话列表 */}
        <div className="w-72 flex-shrink-0 border-r border-border flex flex-col bg-[var(--card)]/30 overflow-hidden">
          {/* 顶部操作栏 */}
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">{t.nav.chat}</h2>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {chatList.length}
                </Badge>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNewChat}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.chat.newChat}</TooltipContent>
              </Tooltip>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.chat.search}
                className="h-8 pl-8 text-xs bg-[var(--background)]"
              />
            </div>
          </div>

          <Separator />

          {/* 聊天列表 */}
          <ScrollArea className="flex-1">
            {chatGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-3 opacity-20" />
                <p className="text-xs">{t.chat.noConversations}</p>
              </div>
            ) : (
              <div className="p-1.5">
                {chatGroups.map((group) => (
                  <div key={group.label} className="mb-2">
                    <div className="px-2 py-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </span>
                    </div>
                    {group.items.map((chat) => (
                      <div
                        key={chat.chat_id}
                        onClick={() => loadChat(chat.chat_id)}
                        className={cn(
                          'group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors',
                          chatId === chat.chat_id
                            ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                            : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50 hover:text-[var(--foreground)]'
                        )}
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <p className="text-sm truncate">{chat.name || chat.chat_id}</p>
                          <p className="text-[10px] opacity-60 truncate">{agentName(chat.agent_id)}</p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--background)] transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              className="text-red-400 focus:text-red-400"
                              onClick={(e) => handleDeleteChat(chat.chat_id, e as any)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t.chat.deleteChat}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 右面板 — 消息区或新建 */}
        <div className="flex-1 flex flex-col min-w-0">
          {isNewChat ? (
            /* 新建对话 — 居中欢迎页 */
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              <div className="max-w-xl w-full space-y-6">
                {/* 欢迎区域 */}
                <div className="text-center space-y-3">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--primary)]/10 to-[var(--primary)]/5 mb-2">
                    <Sparkles className="h-7 w-7 text-[var(--primary)] opacity-80" />
                  </div>
                  <h1 className="text-2xl font-semibold">{t.chat.startConversation}</h1>
                  <p className="text-sm text-[var(--muted-foreground)]">{t.chat.startHint}</p>
                </div>

                {/* Agent 选择器 */}
                {agents.length > 1 && (
                  <div className="flex justify-center gap-2">
                    {agents.map((agent) => (
                      <Button
                        key={agent.id}
                        variant={agentId === agent.id ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAgentId(agent.id)}
                        className="gap-1.5"
                      >
                        <Bot className="h-3.5 w-3.5" />
                        {agent.name}
                      </Button>
                    ))}
                  </div>
                )}

                {/* 输入框 */}
                <div className="relative">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t.chat.placeholder}
                    rows={3}
                    className="pr-14 resize-none bg-[var(--card)] text-sm rounded-xl shadow-sm"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        className="absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg"
                        onClick={handleSend}
                        disabled={!input.trim() || isProcessing}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send (Enter)</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          ) : (
            /* 已有对话 — 消息列表 + 底部输入 */
            <>
              {/* 消息列表 */}
              <ScrollArea className="flex-1">
                <div className="max-w-3xl mx-auto px-4 py-6 space-y-1">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} t={t} />
                  ))}

                  {/* 流式输出 */}
                  {streamingText && (
                    <div className="flex gap-3 py-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
                          AI
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">{t.chat.assistant}</div>
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:rounded-xl prose-pre:bg-[var(--secondary)] prose-code:before:content-none prose-code:after:content-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                          <span className="inline-block w-1.5 h-4 bg-[var(--primary)]/60 animate-pulse ml-0.5 rounded-sm" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 处理中指示器 */}
                  {isProcessing && !streamingText && (
                    <div className="flex gap-3 py-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-gradient-to-br from-violet-500/20 to-purple-500/20 text-[10px] font-semibold">
                          AI
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex items-center gap-2 text-[var(--muted-foreground)] text-sm pt-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.chat.thinking}
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* 底部输入框 */}
              <div className="border-t border-border bg-[var(--background)]">
                <div className="max-w-3xl mx-auto px-4 py-3">
                  <div className="relative flex items-end gap-2">
                    <Textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t.chat.placeholder}
                      rows={1}
                      className="resize-none bg-[var(--card)] text-sm rounded-xl pr-14 min-h-[42px]"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          className="absolute right-2 bottom-1.5 h-8 w-8 rounded-lg"
                          onClick={handleSend}
                          disabled={!input.trim() || isProcessing}
                        >
                          {isProcessing ? (
                            <Square className="h-3.5 w-3.5" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isProcessing ? t.chat.stopGenerating : 'Send (Enter)'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

// 消息气泡
function MessageBubble({ message, t }: { message: Message; t: any }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('group flex gap-3 py-3', isUser && 'flex-row-reverse')}>
      <Avatar className="h-8 w-8 mt-0.5">
        <AvatarFallback
          className={cn(
            'text-[10px] font-semibold',
            isUser
              ? 'bg-blue-500/20 text-blue-500'
              : 'bg-gradient-to-br from-violet-500/20 to-purple-500/20'
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        <div className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5">
          {isUser ? t.chat.you : t.chat.assistant}
          <span className="ml-2 text-[10px] opacity-60">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {isUser ? (
          <div className="inline-block bg-[var(--primary)] text-[var(--primary-foreground)] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%]">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
        ) : (
          <div className="relative">
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:rounded-xl prose-pre:bg-[var(--secondary)] prose-code:before:content-none prose-code:after:content-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  pre: ({ children, ...props }) => (
                    <div className="relative group/code">
                      <pre {...props}>{children}</pre>
                      <button
                        onClick={() => {
                          // 从 pre > code 中提取文本
                          const el = (props as any).node
                          const text = message.content
                          handleCopy(text)
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-[var(--background)]/80 opacity-0 group-hover/code:opacity-100 transition-opacity"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ),
                }}
              >{message.content}</ReactMarkdown>
            </div>
            {/* 消息操作 */}
            <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleCopy(message.content)}
                    className="p-1 rounded hover:bg-[var(--accent)] text-[var(--muted-foreground)] transition-colors"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{copied ? t.chat.copied : t.chat.copyCode}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
