import { useEffect, useRef } from "react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { useChatContext } from "@/hooks/chatCtx";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/stores/app";
import { Bot, Globe, PlusIcon } from "lucide-react";

const MAX_FILES = 10;

// Attachment button that directly opens the file browser
function AddAttachmentButton() {
  const attachments = usePromptInputAttachments();
  const isFull = attachments.files.length >= MAX_FILES;
  return (
    <PromptInputButton
      size="sm"
      disabled={isFull}
      onClick={() => attachments.openFileDialog()}
    >
      <PlusIcon className="size-4" />
    </PromptInputButton>
  );
}

// Attachment previews in the input box (above textarea)
function AttachmentPreviews() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <PromptInputHeader>
      <Attachments variant="grid" className="p-2 ml-0 w-full">
        {attachments.files.map((file) => (
          <Attachment
            key={file.id}
            data={{ ...file, id: file.id }}
            onRemove={() => attachments.remove(file.id)}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

export function ChatInput() {
  const { t } = useI18n();
  const {
    chatId,
    send,
    chatStatus,
    stop,
    agentId,
    setAgentId,
    agents,
    browserProfiles,
    selectedProfileId,
    setSelectedProfileId,
  } = useChatContext();
  const modelReady = useAppStore((s) => s.modelReady);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chatStatus === "submitted" || chatStatus === "streaming") return;

    const frameId = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => cancelAnimationFrame(frameId);
  }, [chatId, chatStatus]);

  const handleSubmit = async (msg: PromptInputMessage) => {
    const text = msg.text.trim();
    if (!text && msg.files.length === 0) return;

    if (!modelReady) {
      alert(t.settings.modelNotConfigured);
      return;
    }

    // Build Attachment objects from file paths
    const attachments = msg.files
      .filter((f) => f.filePath)
      .map((f) => ({
        filename: f.filename,
        mediaType: f.mediaType,
        filePath: f.filePath!,
      }));

    send(
      text,
      selectedProfileId ?? undefined,
      attachments.length > 0 ? attachments : undefined,
    );
  };

  return (
    <div className="bg-background px-5 py-3">
      <PromptInput
        onSubmit={handleSubmit}
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        maxFiles={MAX_FILES}
        maxFileSize={10 * 1024 * 1024}
      >
        <AttachmentPreviews />
        <PromptInputTextarea
          ref={textareaRef}
          placeholder={t.chat.placeholder}
          data-testid="chat-input"
        />
        <PromptInputFooter>
          <PromptInputTools>
            <AddAttachmentButton />
            {agents.length > 1 && (
              <PromptInputSelect value={agentId} onValueChange={setAgentId}>
                <PromptInputSelectTrigger
                  className="h-7 text-xs gap-1"
                  data-testid="agent-selector"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {agents.map((a) => (
                    <PromptInputSelectItem
                      key={a.id}
                      value={a.id}
                      data-testid={`agent-option-${a.id}`}
                    >
                      {a.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            )}
            {browserProfiles.length > 0 && (
              <PromptInputSelect
                value={selectedProfileId ?? "__none__"}
                onValueChange={(v) =>
                  setSelectedProfileId(v === "__none__" ? null : v)
                }
              >
                <PromptInputSelectTrigger
                  className="h-7 text-xs gap-1"
                  data-testid="chat-browser-profile-trigger"
                >
                  <Globe className="h-3.5 w-3.5" />
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  <PromptInputSelectItem
                    value="__none__"
                    data-testid="chat-browser-profile-none"
                  >
                    {t.chat.noBrowserProfile}
                  </PromptInputSelectItem>
                  {browserProfiles.map((p) => (
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
