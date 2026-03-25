import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import './setup.ts'
import { createExternalMcpToolRuntime } from '../src/agent/mcp-tools.ts'

const tempDirs: string[] = []

function createFakeMcpServer(): string {
  const dir = join(process.cwd(), '.tmp-mcp-tests', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  const filePath = join(dir, 'server.mjs')
  writeFileSync(filePath, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'fake-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'echo',
    description: 'Echo text back',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{
    type: 'text',
    text: 'echo:' + String(request.params.arguments?.text ?? ''),
  }],
  isError: false,
}))

const transport = new StdioServerTransport()
await server.connect(transport)
process.stdin.resume()
`)
  return filePath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('createExternalMcpToolRuntime', () => {
  test('loads stdio MCP tools and executes them', async () => {
    const serverPath = createFakeMcpServer()
    const runtime = await createExternalMcpToolRuntime({
      servers: {
        fake: {
          command: 'node',
          args: [serverPath],
          cwd: process.cwd(),
        },
      },
    })

    expect(runtime.tools.map((tool) => tool.name)).toEqual(['echo'])
    try {
      const result = await runtime.tools[0]!.execute('tool-1', { text: 'hello' } as never, undefined, undefined, {} as never)
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'echo:hello' })
    } finally {
      await runtime.dispose()
    }
  })

  test('skips MCP tools that conflict with reserved names', async () => {
    const serverPath = createFakeMcpServer()
    const runtime = await createExternalMcpToolRuntime({
      servers: {
        fake: {
          command: 'node',
          args: [serverPath],
          cwd: process.cwd(),
        },
      },
      reservedToolNames: ['echo'],
    })

    try {
      expect(runtime.tools).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })
})
