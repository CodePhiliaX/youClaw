import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { getLogger } from '../logger/index.ts'
import { BUILD_CONSTANTS } from '../config/build-constants.ts'
import { getAuthToken } from '../routes/auth.ts'

const VLM_HOST = BUILD_CONSTANTS['YOUCLAW_API_URL'] || 'https://readmex.com'
const VLM_ENDPOINT = '/v1/coding_plan/vlm'

/**
 * Convert local file or URL to base64 data URL
 */
function processImageSource(source: string): string {
  // Strip leading @ if present
  if (source.startsWith('@')) source = source.slice(1)

  // Already base64
  if (source.startsWith('data:')) return source

  // HTTP URL — pass through (server handles download)
  if (source.startsWith('http://') || source.startsWith('https://')) return source

  // Local file
  if (!existsSync(source)) throw new Error(`Image file not found: ${source}`)
  const data = readFileSync(source)
  const ext = extname(source).toLowerCase()
  const format = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg'
  return `data:image/${format};base64,${data.toString('base64')}`
}

/**
 * Call VLM API to analyze an image
 */
async function callVlmApi(prompt: string, imageUrl: string): Promise<string> {
  const logger = getLogger()
  const authToken = getAuthToken()
  if (!authToken) throw new Error('Not logged in: auth token required for image analysis')

  const url = `${VLM_HOST}${VLM_ENDPOINT}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'MM-API-Source': 'YouClaw',
    },
    body: JSON.stringify({ prompt, image_url: imageUrl }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    logger.error({ status: resp.status, body: text }, 'VLM API request failed')
    throw new Error(`VLM API error: ${resp.status} ${resp.statusText}`)
  }

  const data = await resp.json() as { content?: string; base_resp?: { status_code: number; status_msg: string } }
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`VLM API error: ${data.base_resp.status_code} ${data.base_resp.status_msg}`)
  }
  return data.content || ''
}

/**
 * Create the built-in MCP server with image analysis tool.
 * Runs in-process — no external Python/uvx dependency.
 */
export function createBuiltinMcpServer() {
  return createSdkMcpServer({
    name: 'minimax',
    version: '1.0.0',
    tools: [
      tool(
        'understand_image',
        `You MUST use this tool whenever you need to analyze, describe, or extract information from an image.

An LLM-powered vision tool that analyzes image content from local files or URLs.
Only JPEG, PNG, and WebP formats are supported.

Args:
  prompt: A text prompt describing what you want to analyze or extract from the image.
  image_source: The image location — a local file path or HTTP URL.
    If it starts with @, the @ will be stripped automatically.`,
        {
          prompt: z.string().describe('What to analyze or extract from the image'),
          image_source: z.string().describe('Local file path or HTTP/HTTPS URL of the image'),
        },
        async (args) => {
          const logger = getLogger()
          try {
            const imageUrl = processImageSource(args.image_source)
            const content = await callVlmApi(args.prompt, imageUrl)
            if (!content) {
              return { content: [{ type: 'text' as const, text: 'No content returned from image analysis' }] }
            }
            return { content: [{ type: 'text' as const, text: content }] }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.error({ error: msg, image_source: args.image_source }, 'understand_image failed')
            return { content: [{ type: 'text' as const, text: `Failed to analyze image: ${msg}` }], isError: true }
          }
        },
      ),
    ],
  })
}
