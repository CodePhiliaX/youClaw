import { useI18n } from "@/i18n";
import { useChatContext } from "@/hooks/useChatContext";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Bot } from "lucide-react";

export function ChatInput() {
  const { t } = useI18n();
  const { send, chatStatus, stop, agentId, setAgentId, agents } =
    useChatContext();

  const handleSubmit = (msg: PromptInputMessage) => {
    const text = msg.text.trim();
    if (!text) return;
    send(text);
  };

  return (
    <div className="bg-background">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            placeholder={t.chat.placeholder}
            data-testid="chat-input"
          />
          <PromptInputFooter>
            <PromptInputTools>
              {agents.length > 1 && (
                <PromptInputSelect value={agentId} onValueChange={setAgentId}>
                  <PromptInputSelectTrigger className="h-7 text-xs gap-1">
                    <Bot className="h-3.5 w-3.5" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {agents.map((a) => (
                      <PromptInputSelectItem key={a.id} value={a.id}>
                        {a.name}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              )}
            </PromptInputTools>
            <PromptInputSubmit
              status={chatStatus}
              onStop={stop}
              data-testid="chat-send"
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
