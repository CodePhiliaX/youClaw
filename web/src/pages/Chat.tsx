import { useState, useRef, useEffect } from "react";
import { Plus, Search, X, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useChatContext } from "@/hooks/chatCtx";
import { groupChatsByDate, chatAvatar } from "@/lib/chat-utils";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function Chat() {
  const { t } = useI18n();
  const chatCtx = useChatContext();
  const { chatId, messages } = chatCtx;
  const isNewChat = !chatId && messages.length === 0;
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      chatCtx.setSearchQuery("");
    }
  }, [searchOpen]);

  const filteredChats = chatCtx.searchQuery
    ? chatCtx.chatList.filter((c) =>
        c.name.toLowerCase().includes(chatCtx.searchQuery.toLowerCase()),
      )
    : chatCtx.chatList;

  const chatGroups = groupChatsByDate(filteredChats, {
    today: t.chat.today,
    yesterday: t.chat.yesterday,
    older: t.chat.older,
  });

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await chatCtx.deleteChat(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex h-full">
      {/* 左侧：对话列表 */}
      <div className="w-[260px] border-r border-[var(--subtle-border)] flex flex-col shrink-0">
        <div className="p-3 border-b border-[var(--subtle-border)] flex items-center justify-between">
          <h2 className="font-semibold text-sm">{t.nav.chat}</h2>
          <div className="flex items-center gap-0.5">
            <button
              data-testid="chat-search-toggle"
              onClick={() => setSearchOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-all duration-200 ease-[var(--ease-soft)]",
                searchOpen
                  ? "text-foreground bg-[var(--surface-hover)]"
                  : "text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground",
              )}
              title={t.sidebar.search}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
            <button
              data-testid="chat-new"
              onClick={() => chatCtx.newChat()}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-accent-foreground transition-all duration-200 ease-[var(--ease-soft)]"
              title={t.sidebar.newChat}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 搜索（展开/收起） */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-[var(--ease-soft)]",
            searchOpen ? "max-h-12 opacity-100" : "max-h-0 opacity-0",
          )}
        >
          <div className="px-3 py-2">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                data-testid="chat-search"
                className="w-full bg-[var(--surface-raised)] border border-[var(--subtle-border)] rounded-xl px-3 py-1.5 pr-7 text-sm transition-all duration-200 ease-[var(--ease-soft)] focus:outline-none focus:border-primary/40 focus:shadow-[0_0_0_3px_oklch(0.55_0.2_25/0.1)]"
                placeholder={t.sidebar.search}
                value={chatCtx.searchQuery}
                onChange={(e) => chatCtx.setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchOpen(false);
                }}
              />
              {chatCtx.searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => chatCtx.setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5" role="listbox">
          {chatGroups.length === 0 && (
            <p className="text-xs text-muted-foreground px-2.5 py-4 text-center">
              {t.chat.noConversations}
            </p>
          )}
          {chatGroups.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2.5 pt-3 pb-1">
                {group.label}
              </div>
              {group.items.map((chat) => (
                <div
                  key={chat.chat_id}
                  role="option"
                  data-testid="chat-item"
                  aria-selected={chatCtx.chatId === chat.chat_id}
                  className={cn(
                    "group flex items-start rounded-[10px] px-2.5 py-2.5 cursor-pointer gap-2.5",
                    "transition-all duration-200 ease-[var(--ease-soft)]",
                    chatCtx.chatId === chat.chat_id
                      ? "bg-primary/8 text-foreground"
                      : "text-muted-foreground hover:bg-[var(--surface-hover)]",
                  )}
                  onClick={() => chatCtx.loadChat(chat.chat_id)}
                >
                  <div
                    className="w-9 h-9 rounded-[10px] shrink-0 mt-0.5"
                    style={{ background: chatAvatar(chat.chat_id) }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium truncate flex-1 text-foreground">{chat.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(chat.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {chat.last_message || '\u00A0'}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="chat-item-menu"
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-md flex items-center justify-center hover:bg-accent transition-all duration-200 shrink-0 mt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        data-testid="chat-item-delete"
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(chat.chat_id);
                        }}
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
      </div>

      {/* 右侧：聊天内容 */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {isNewChat ? <ChatWelcome /> : <ChatMessages />}

        {/* ChatInput 始终渲染，通过位置动画从居中移到底部 */}
        <div
          className={
            isNewChat
              ? "absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 transition-all duration-500 ease-[var(--ease-soft)]"
              : "relative px-0 transition-all duration-500 ease-[var(--ease-soft)]"
          }
        >
          <div className="max-w-3xl mx-auto">
            {/* 欢迎提示文字，发送后淡出 */}
            <div
              className={
                isNewChat
                  ? "text-center space-y-4 mb-8 opacity-100 transition-all duration-500 ease-[var(--ease-soft)]"
                  : "text-center space-y-4 mb-0 opacity-0 h-0 overflow-hidden transition-all duration-500 ease-[var(--ease-soft)]"
              }
            >
              <img src="/icon.svg" alt="YouClaw" className="h-24 w-24 mb-3 mx-auto" />
              <h1 className="text-2xl font-semibold tracking-tight">
                {t.chat.welcome}
              </h1>
              <p className="text-sm text-muted-foreground/70 max-w-md mx-auto leading-relaxed">
                {t.chat.startHint}
              </p>
            </div>
            <ChatInput />
          </div>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.chat.deleteChat}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.chat.confirmDelete}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
