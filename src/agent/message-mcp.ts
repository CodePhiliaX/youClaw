import { Type } from '@mariozechner/pi-ai'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { sendToChat } from '../channel/outbound-service.ts'
import { getLogger } from '../logger/index.ts'

const SendToCurrentChatParams = Type.Object({
  text: Type.Optional(Type.String({ description: 'Optional text message or caption to send' })),
  media: Type.Optional(Type.String({ description: 'Optional absolute local path, file:// URL, or HTTP/HTTPS URL of the media/file to send' })),
})

export function createMessageTool(chatId: string): ToolDefinition {
  return {
    name: 'mcp__message__send_to_current_chat',
    label: 'mcp__message__send_to_current_chat',
    description: `Send a message back to the current conversation.

Use this tool when the user explicitly asks you to send text, images, or files back through the current chat channel.`,
    parameters: SendToCurrentChatParams,
    async execute(_toolCallId, args: { text?: string; media?: string }) {
      const text = args.text?.trim() ?? ''
      const media = args.media?.trim()

      if (!text && !media) {
        throw new Error('send_to_current_chat requires either text or media.')
      }

      try {
        const result = await sendToChat({
          chatId,
          text,
          mediaUrl: media,
        })
        return {
          content: [{
            type: 'text',
            text: result.mode === 'media'
              ? 'Message and media were sent to the current chat.'
              : 'Message was sent to the current chat.',
          }],
          details: { mode: result.mode, media },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        getLogger().error({ chatId, error: msg, media }, 'send_to_current_chat failed')
        throw new Error(`Failed to send to current chat: ${msg}`)
      }
    },
  }
}
