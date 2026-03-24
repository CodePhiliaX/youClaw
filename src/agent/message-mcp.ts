import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { sendToChat } from '../channel/outbound-service.ts'
import { getLogger } from '../logger/index.ts'

export function createMessageMcpServer(chatId: string) {
  return createSdkMcpServer({
    name: 'message',
    version: '1.0.0',
    tools: [
      tool(
        'send_to_current_chat',
        `Send a message back to the current conversation.

Use this tool when the user explicitly asks you to send text, images, or files back through the current chat channel.

Args:
  text: Optional text caption or message body to send.
  media: Optional absolute local file path, file:// URL, or HTTP/HTTPS URL for an image/file to send.

Notes:
  - If media is provided, the current channel must support media delivery.
  - For generated local files, prefer absolute paths such as /tmp/example.zip.
  - At least one of text or media must be provided.`,
        {
          text: z.string().optional().describe('Optional text message or caption to send'),
          media: z.string().optional().describe('Optional absolute local path, file:// URL, or HTTP/HTTPS URL of the media/file to send'),
        },
        async (args) => {
          const text = args.text?.trim() ?? ''
          const media = args.media?.trim()

          if (!text && !media) {
            return {
              content: [{ type: 'text' as const, text: 'send_to_current_chat requires either text or media.' }],
              isError: true,
            }
          }

          try {
            const result = await sendToChat({
              chatId,
              text,
              mediaUrl: media,
            })
            return {
              content: [{
                type: 'text' as const,
                text: result.mode === 'media'
                  ? 'Message and media were sent to the current chat.'
                  : 'Message was sent to the current chat.',
              }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            getLogger().error({ chatId, error: msg, media }, 'send_to_current_chat failed')
            return {
              content: [{ type: 'text' as const, text: `Failed to send to current chat: ${msg}` }],
              isError: true,
            }
          }
        },
      ),
    ],
  })
}
