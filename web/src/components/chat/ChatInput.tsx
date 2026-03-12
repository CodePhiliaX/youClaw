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
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Bot, Globe } from "lucide-react";

export function ChatInput() {
  const { t } = useI18n();
  const {
    send, chatStatus, stop, agentId, setAgentId, agents,
    browserProfiles, selectedProfileId, setSelectedProfileId,
  } = useChatContext();

  const handleSubmit = async (msg: PromptInputMessage) => {
    const text = msg.text.trim();
    if (!text && msg.files.length === 0) return;

    // 将 data URL 转为 Attachment 对象
    const attachments = msg.files
      .map((f) => {
        const match = f.url.match(/^data:([^;]+);base64,(.+)$/s);
        if (!match) return null;
        const [, mediaType, data] = match;
        const padding = (data.match(/=+$/) || [''])[0].length;
        const size = Math.floor(data.length * 3 / 4) - padding;
        return { filename: f.filename, mediaType, data, size };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    send(text, selectedProfileId ?? undefined, attachments.length > 0 ? attachments : undefined);
  };

  return (
    <div className="bg-background px-4 py-3">
      <PromptInput
        onSubmit={handleSubmit}
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
        maxFiles={5}
        maxFileSize={10 * 1024 * 1024}
      >
          <PromptInputTextarea
            placeholder={t.chat.placeholder}
            data-testid="chat-input"
          />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
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
              {browserProfiles.length > 0 && (
                <PromptInputSelect
                  value={selectedProfileId ?? '__none__'}
                  onValueChange={v => setSelectedProfileId(v === '__none__' ? null : v)}
                >
                  <PromptInputSelectTrigger className="h-7 text-xs gap-1">
                    <Globe className="h-3.5 w-3.5" />
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    <PromptInputSelectItem value="__none__">
                      {t.chat.noBrowserProfile}
                    </PromptInputSelectItem>
                    {browserProfiles.map(p => (
                      <PromptInputSelectItem key={p.id} value={p.id}>
                        {p.name}
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
  );
}
