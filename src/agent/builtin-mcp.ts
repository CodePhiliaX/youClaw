import { Type } from '@mariozechner/pi-ai'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readFileSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import { getLogger } from '../logger/index.ts'
import { BUILD_CONSTANTS } from '../config/build-constants.ts'
import { getAuthToken } from '../routes/auth.ts'

const VLM_HOST = BUILD_CONSTANTS['YOUCLAW_API_URL'] || 'https://readmex.com'
const VLM_ENDPOINT = '/v1/coding_plan/vlm'

const UnderstandImageParams = Type.Object({
  prompt: Type.String({ description: 'What to analyze or extract from the image' }),
  image_source: Type.String({ description: 'Local file path or HTTP/HTTPS URL of the image' }),
})

/**
 * Convert local file or URL to base64 data URL
 */
function processImageSource(source: string): string {
  if (source.startsWith('@')) source = source.slice(1)
  if (source.startsWith('data:')) return source
  if (source.startsWith('http://') || source.startsWith('https://')) return source

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
 * Built-in image analysis tool exposed with the legacy MCP-style name so
 * existing prompts and tests do not need to change.
 */
export function createBuiltinImageTool(): ToolDefinition {
  return {
    name: 'mcp__minimax__understand_image',
    label: 'mcp__minimax__understand_image',
    description: `You MUST use this tool whenever you need to analyze, describe, or extract information from an image.

An LLM-powered vision tool that analyzes image content from local files or URLs.
Only JPEG, PNG, and WebP formats are supported.`,
    parameters: UnderstandImageParams,
    async execute(_toolCallId, params: { prompt: string; image_source: string }) {
      const logger = getLogger()
      try {
        const imageUrl = processImageSource(params.image_source)
        const content = await callVlmApi(params.prompt, imageUrl)
        return {
          content: [{ type: 'text', text: content || 'No content returned from image analysis' }],
          details: { imageSource: params.image_source },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ error: msg, image_source: params.image_source }, 'understand_image failed')
        throw new Error(`Failed to analyze image: ${msg}`)
      }
    },
  }
}
