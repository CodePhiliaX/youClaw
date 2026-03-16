import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useChat } from "./useChat";
import {
  getChats,
  getAgents,
  deleteChat as deleteChatApi,
  updateChat as updateChatApi,
  getBrowserProfiles,
  type BrowserProfileDTO,
} from "../api/client";
import { getItem, setItem } from "@/lib/storage";
import { ChatContext } from "./chatCtx";
import type { ChatItem } from "@/lib/chat-utils";

const LAST_AGENT_KEY = "last-agent-id";

type Agent = { id: string; name: string };

export function ChatProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentId] = useState("default");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chatList, setChatList] = useState<ChatItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [browserProfiles, setBrowserProfiles] = useState<BrowserProfileDTO[]>(
    [],
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [ready, setReady] = useState(false);

  const chat = useChat(agentId);

  // Async load last agentId on startup
  useEffect(() => {
    getItem(LAST_AGENT_KEY).then((saved) => {
      if (saved) setAgentId(saved);
      setReady(true);
    });
  }, []);

  // Load agents
  const refreshAgents = useCallback(() => {
    getAgents()
      .then((list) => {
        const sorted = list
          .map((a) => ({ id: a.id, name: a.name }))
          .sort((a, b) => {
            if (a.id === "default") return -1;
            if (b.id === "default") return 1;
            return a.name.localeCompare(b.name);
          });
        setAgents(sorted);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  // Load browser profiles
  useEffect(() => {
    getBrowserProfiles()
      .then(setBrowserProfiles)
      .catch(() => {});
  }, []);

  // Load chat list
  const refreshChats = useCallback(() => {
    getChats()
      .then(setChatList)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshChats();
  }, [chat.chatId, chat.messages.length, refreshChats]);

  // Persist agentId
  useEffect(() => {
    if (ready) setItem(LAST_AGENT_KEY, agentId);
  }, [agentId, ready]);

  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  });

  const deleteChat = useCallback(
    async (chatIdToDelete: string) => {
      await deleteChatApi(chatIdToDelete);
      if (chatRef.current.chatId === chatIdToDelete) chatRef.current.newChat();
      refreshChats();
    },
    [refreshChats],
  );

  const updateChat = useCallback(
    async (
      chatIdToUpdate: string,
      data: { name?: string; avatar?: string },
    ) => {
      await updateChatApi(chatIdToUpdate, data);
      refreshChats();
    },
    [refreshChats],
  );

  return (
    <ChatContext.Provider
      value={{
        ...chat,
        chatList,
        refreshChats,
        searchQuery,
        setSearchQuery,
        deleteChat,
        updateChat,
        agentId,
        setAgentId,
        agents,
        refreshAgents,
        browserProfiles,
        selectedProfileId,
        setSelectedProfileId,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
