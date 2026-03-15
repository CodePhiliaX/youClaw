import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import './setup-light.ts'
import { SecretsManager } from '../src/agent/secrets.ts'
import { createSecurityHook } from '../src/agent/security.ts'
import type { HookContext } from '../src/agent/hooks.ts'
import type { SecurityConfig } from '../src/agent/schema.ts'

// === SecretsManager Tests ===

describe('SecretsManager', () => {
  let secrets: SecretsManager
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  beforeEach(() => {
    secrets = new SecretsManager()
  })

  afterEach(() => {
    // restore environment variables
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    Object.keys(savedEnv).forEach((k) => delete savedEnv[k])
  })

  test('loadFromEnv correctly parses YOUCLAW_SECRET_<AGENTID>_<KEY>', () => {
    setEnv('YOUCLAW_SECRET_MYAGENT_API_TOKEN', 'sk-test-123')
    setEnv('YOUCLAW_SECRET_MYAGENT_DB_PASSWORD', 'pass-456')
    setEnv('YOUCLAW_SECRET_OTHER_KEY', 'other-val')

    secrets.loadFromEnv()

    expect(secrets.getSecretKeys('myagent')).toContain('api_token')
    expect(secrets.getSecretKeys('myagent')).toContain('db_password')
    expect(secrets.getSecretKeys('other')).toContain('key')
  })

  test('resolve replaces ${SECRET:key} references', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_TOKEN', 'my-secret-token')
    secrets.loadFromEnv()

    const result = secrets.resolve('agent1', 'Bearer ${SECRET:token}')
    expect(result).toBe('Bearer my-secret-token')
  })

  test('resolve returns empty string for non-existent secret', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_EXISTING', 'value')
    secrets.loadFromEnv()
    // agent1 has a secrets mapping, but nonexistent is not in it -> replaced with empty string
    const result = secrets.resolve('agent1', '${SECRET:nonexistent}')
    expect(result).toBe('')
  })

  test('resolve returns original template for non-existent agent', () => {
    secrets.loadFromEnv()
    const result = secrets.resolve('nonexistent', 'no change ${SECRET:key}')
    // no secrets for this agent, template returned as-is
    expect(result).toBe('no change ${SECRET:key}')
  })

  test('resolve is case-insensitive (normalized to lowercase)', () => {
    setEnv('YOUCLAW_SECRET_MYAGENT_API_KEY', 'test-key')
    secrets.loadFromEnv()

    expect(secrets.resolve('myagent', '${SECRET:api_key}')).toBe('test-key')
    expect(secrets.resolve('myagent', '${SECRET:API_KEY}')).toBe('test-key')
  })

  test('injectToMcpEnv replaces secrets in MCP server environment variables', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_SERVER_TOKEN', 'injected-token')
    secrets.loadFromEnv()

    const servers = {
      'my-server': {
        command: 'node',
        args: ['server.js'],
        env: {
          TOKEN: '${SECRET:server_token}',
          NORMAL: '${SOME_VAR}',
        },
      },
    }

    const result = secrets.injectToMcpEnv('agent1', servers)

    expect(result['my-server']!.env!.TOKEN).toBe('injected-token')
    // non-SECRET references remain unchanged
    expect(result['my-server']!.env!.NORMAL).toBe('${SOME_VAR}')
  })

  test('injectToMcpEnv returns original config when no secrets exist', () => {
    secrets.loadFromEnv()
    const servers = {
      'my-server': { command: 'node', env: { KEY: 'val' } },
    }
    const result = secrets.injectToMcpEnv('agent1', servers)
    expect(result).toEqual(servers)
  })

  test('injectToMcpEnv passes through servers without env directly', () => {
    setEnv('YOUCLAW_SECRET_AGENT1_KEY', 'val')
    secrets.loadFromEnv()

    const servers = {
      'no-env': { command: 'node' },
    }
    const result = secrets.injectToMcpEnv('agent1', servers)
    expect(result['no-env']).toEqual({ command: 'node' })
  })

  test('getSecretKeys does not expose values', () => {
    setEnv('YOUCLAW_SECRET_SAFE_TOKEN', 'sensitive-value')
    secrets.loadFromEnv()

    const keys = secrets.getSecretKeys('safe')
    expect(keys).toEqual(['token'])
    // keys do not contain actual values
    expect(keys.join('')).not.toContain('sensitive-value')
  })

  test('invalid naming format is ignored', () => {
    setEnv('YOUCLAW_SECRET_NOKEY', 'bad-format')
    secrets.loadFromEnv()

    // NOKEY has no underscore separating agentId and key, should be ignored
    expect(secrets.getSecretKeys('nokey')).toEqual([])
  })
})

// === Security Hook Tests ===

function createHookContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    agentId: 'test-agent',
    chatId: 'web:chat-1',
    phase: 'pre_tool_use',
    payload: { tool: 'Read', input: {} },
    ...overrides,
  }
}

describe('createSecurityHook', () => {
  test('tool allowlist: permits tools in the list', async () => {
    const hook = createSecurityHook({ allowedTools: ['Read', 'Grep'] })

    const readCtx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const readResult = await hook(readCtx)
    expect(readResult.abort).toBeUndefined()
  })

  test('tool allowlist: blocks tools not in the list', async () => {
    const hook = createSecurityHook({ allowedTools: ['Read', 'Grep'] })

    const bashCtx = createHookContext({ payload: { tool: 'Bash', input: {} } })
    const bashResult = await hook(bashCtx)
    expect(bashResult.abort).toBe(true)
    expect(bashResult.abortReason).toContain('Bash')
  })

  test('tool denylist: blocks tools in the list', async () => {
    const hook = createSecurityHook({ disallowedTools: ['Bash', 'Write'] })

    const bashCtx = createHookContext({ payload: { tool: 'Bash', input: {} } })
    const bashResult = await hook(bashCtx)
    expect(bashResult.abort).toBe(true)

    const readCtx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const readResult = await hook(readCtx)
    expect(readResult.abort).toBeUndefined()
  })

  test('file path: deniedPaths blocks access', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        deniedPaths: ['/etc/', '/root/'],
      },
    })

    const deniedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/etc/passwd' } },
    })
    const deniedResult = await hook(deniedCtx)
    expect(deniedResult.abort).toBe(true)
  })

  test('file path: allowedPaths restriction', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        allowedPaths: ['/tmp/safe/', '/home/user/projects/'],
      },
    })

    const allowedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/tmp/safe/file.txt' } },
    })
    const allowedResult = await hook(allowedCtx)
    expect(allowedResult.abort).toBeUndefined()

    const deniedCtx = createHookContext({
      payload: { tool: 'Read', input: { file_path: '/var/log/syslog' } },
    })
    const deniedResult = await hook(deniedCtx)
    expect(deniedResult.abort).toBe(true)
  })

  test('non-file tools skip path checks', async () => {
    const hook = createSecurityHook({
      fileAccess: {
        allowedPaths: ['/tmp/'],
      },
    })

    // WebSearch is not a file operation tool, path check is skipped
    const ctx = createHookContext({
      payload: { tool: 'WebSearch', input: { query: 'test' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBeUndefined()
  })

  test('no security config allows everything', async () => {
    const hook = createSecurityHook({})

    const ctx = createHookContext({ payload: { tool: 'Bash', input: { command: 'rm -rf /' } } })
    const result = await hook(ctx)
    expect(result.abort).toBeUndefined()
  })

  test('Edit tool file path extraction', async () => {
    const hook = createSecurityHook({
      fileAccess: { deniedPaths: ['/etc/'] },
    })

    const ctx = createHookContext({
      payload: { tool: 'Edit', input: { file_path: '/etc/hosts', old_string: 'a', new_string: 'b' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBe(true)
  })

  test('Glob tool path extraction', async () => {
    const hook = createSecurityHook({
      fileAccess: { deniedPaths: ['/etc/'] },
    })

    const ctx = createHookContext({
      payload: { tool: 'Glob', input: { path: '/etc/nginx/', pattern: '*.conf' } },
    })
    const result = await hook(ctx)
    expect(result.abort).toBe(true)
  })

  test('allowlist and denylist configured together, allowlist checked first', async () => {
    const hook = createSecurityHook({
      allowedTools: ['Read'],
      disallowedTools: ['Read'], // conflicting config
    })

    // allowedTools checked first -> Read is in allowlist -> passes allowlist
    // then denylist checked -> Read is in denylist -> blocked
    const ctx = createHookContext({ payload: { tool: 'Read', input: {} } })
    const result = await hook(ctx)
    // Read passes allowlist but is also in denylist -> blocked
    expect(result.abort).toBe(true)
  })
})
