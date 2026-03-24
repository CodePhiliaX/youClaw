import { Hono } from 'hono'
import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod/v4'
import { which, resetShellEnvCache, getShellEnv } from '../utils/shell-env.ts'
import { getLogger } from '../logger/index.ts'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

/**
 * Read live PATH from Windows registry (not inherited process.env).
 * System PATH: HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path
 * User PATH:   HKCU\Environment\Path
 * Combines both, then searches for git.exe in each directory.
 */
function findGitFromRegistry(): string | null {
  const paths: string[] = []

  // Read system PATH from registry
  try {
    const sysOut = execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
      { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const m = sysOut.match(/Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i)
    if (m?.[1]) {
      // Expand %SystemRoot% etc. by resolving env vars
      let expanded = m[1].trim()
      expanded = expanded.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`)
      paths.push(...expanded.split(';').filter(Boolean))
    }
  } catch { /* ignore */ }

  // Read user PATH from registry
  try {
    const userOut = execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const m = userOut.match(/Path\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i)
    if (m?.[1]) {
      let expanded = m[1].trim()
      expanded = expanded.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || `%${key}%`)
      paths.push(...expanded.split(';').filter(Boolean))
    }
  } catch { /* ignore */ }

  // Search for git.exe in each path entry
  for (const dir of paths) {
    const gitExe = resolve(dir, 'git.exe')
    if (existsSync(gitExe)) return gitExe
  }

  return null
}

/**
 * Detect a tool by trying a list of commands and retrieving its version.
 * Resets the shell env cache first so newly installed tools are picked up.
 */
function checkTool(commands: string[], versionFlag = '--version'): { path: string | null; version: string | null } {
  resetShellEnvCache()
  for (const cmd of commands) {
    const p = which(cmd)
    if (p) {
      let version: string | null = null
      try {
        version = execSync(`"${p}" ${versionFlag}`, {
          timeout: 5000,
          encoding: 'utf-8',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
      } catch { /* ignore version detection failure */ }
      return { path: p, version }
    }
  }
  return { path: null, version: null }
}

/**
 * Detect Git, with special handling for Windows (registry lookup).
 */
function checkGit(): { path: string | null; version: string | null } {
  let gitPath: string | null = null

  if (process.platform === 'win32') {
    // Windows: try registry first, then fall back to which
    gitPath = findGitFromRegistry() ?? which('git')
  } else {
    // macOS/Linux: refresh cache and use which
    resetShellEnvCache()
    gitPath = which('git')
  }

  if (!gitPath) return { path: null, version: null }

  let version: string | null = null
  try {
    version = execSync(`"${gitPath}" --version`, {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch { /* ignore */ }

  return { path: gitPath, version }
}

/**
 * Check if a Node.js version string satisfies the minimum requirement (>=18).
 */
function isNodeVersionSufficient(version: string): boolean {
  const major = parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10)
  return major >= 18
}

// GET /api/git-check — check if git is available (backward compatible)
health.get('/git-check', (c) => {
  const result = checkGit()
  return c.json({ available: result.path !== null, path: result.path })
})

// GET /api/env-check — check all environment dependencies
health.get('/env-check', (c) => {
  const platform = process.platform
  const isWindows = platform === 'win32'

  const dependencies: Array<{
    name: string
    available: boolean
    path: string | null
    version: string | null
    required: boolean
  }> = []

  // 1. Git (required on all platforms)
  const git = checkGit()
  dependencies.push({
    name: 'git',
    available: git.path !== null,
    path: git.path,
    version: git.version,
    required: true,
  })

  // 2. Bun (required on all platforms)
  const bun = checkTool(['bun'])
  dependencies.push({
    name: 'bun',
    available: bun.path !== null,
    path: bun.path,
    version: bun.version,
    required: true,
  })

  // 3. Node.js (optional — fallback runtime on Windows if Bun compat is insufficient)
  const node = checkTool(['node'])
  let nodeAvailable = node.path !== null
  if (isWindows && nodeAvailable && node.version) {
    if (!isNodeVersionSufficient(node.version)) {
      nodeAvailable = false
    }
  }
  dependencies.push({
    name: 'node',
    available: nodeAvailable,
    path: node.path,
    version: node.version,
    required: false,
  })

  // 4. Python (optional, all platforms)
  const pythonCmds = isWindows ? ['python3', 'python', 'py'] : ['python3', 'python']
  const python = checkTool(pythonCmds)
  dependencies.push({
    name: 'python',
    available: python.path !== null,
    path: python.path,
    version: python.version,
    required: false,
  })

  // 5. uv (optional, all platforms)
  const uv = checkTool(['uv'])
  dependencies.push({
    name: 'uv',
    available: uv.path !== null,
    path: uv.path,
    version: uv.version,
    required: false,
  })

  return c.json({ platform, dependencies })
})

// POST /api/install-tool — install a system tool (bun, git, node)
const installToolSchema = z.object({
  tool: z.enum(['bun', 'git', 'node']),
})

const BUN_CDN_BASE = 'https://cdn.chat2db-ai.com/youclaw/tools/bun'
const BUN_GITHUB_BASE = 'https://github.com/oven-sh/bun/releases/download/bun-v1.2.15'

/**
 * Get the Bun zip filename for the current platform.
 */
function getBunZipTarget(): string | null {
  const arch = process.arch // 'arm64' | 'x64'
  if (process.platform === 'darwin') {
    return arch === 'arm64' ? 'bun-darwin-aarch64.zip' : 'bun-darwin-x64.zip'
  }
  if (process.platform === 'win32') {
    return 'bun-windows-x64.zip'
  }
  if (process.platform === 'linux') {
    return arch === 'arm64' ? 'bun-linux-aarch64.zip' : 'bun-linux-x64.zip'
  }
  return null
}

/**
 * Download Bun from CDN (with GitHub fallback), extract to ~/.bun/bin/.
 * Pure JS implementation using Bun built-in fetch + unzip.
 */
async function installBun(): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const zipName = getBunZipTarget()
  if (!zipName) {
    const msg = `Unsupported platform: ${process.platform} ${process.arch}`
    getLogger().error({ category: 'install' }, `[install-bun] ${msg}`)
    return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
  }

  const cdnUrl = `${BUN_CDN_BASE}/${zipName}`
  const githubUrl = `${BUN_GITHUB_BASE}/${zipName}`

  // Download zip: try CDN first, fallback to GitHub
  let zipBuffer: ArrayBuffer | null = null
  let downloadSource = ''
  for (const url of [cdnUrl, githubUrl]) {
    try {
      getLogger().info({ category: 'install' }, `[install-bun] Downloading from ${url}...`)
      const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (resp.ok) {
        zipBuffer = await resp.arrayBuffer()
        downloadSource = url
        getLogger().info({ category: 'install' }, `[install-bun] Downloaded ${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)}MB from ${url}`)
        break
      }
      getLogger().warn({ category: 'install' }, `[install-bun] HTTP ${resp.status} from ${url}, trying next...`)
    } catch (err: any) {
      getLogger().warn({ category: 'install' }, `[install-bun] Failed to download from ${url}: ${err.message}`)
    }
  }

  if (!zipBuffer) {
    const msg = 'Failed to download Bun from CDN and GitHub'
    getLogger().error({ category: 'install' }, `[install-bun] ${msg}`)
    return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
  }

  // Determine install directory
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const ext = process.platform === 'win32' ? '.exe' : ''
  const bunDir = resolve(home, '.bun', 'bin')
  const bunPath = resolve(bunDir, `bun${ext}`)

  try {
    mkdirSync(bunDir, { recursive: true })

    // Write zip to temp file and extract
    const ts = Date.now()
    const tmpExtractDir = resolve(tmpdir(), `bun-extract-${ts}`)
    const tmpZip = resolve(tmpdir(), `bun-install-${ts}.zip`)
    writeFileSync(tmpZip, Buffer.from(zipBuffer))
    getLogger().info({ category: 'install' }, `[install-bun] Zip written to ${tmpZip}, extracting...`)

    // Extract into a dedicated temp directory to avoid conflicts
    mkdirSync(tmpExtractDir, { recursive: true })
    const folderName = zipName.replace('.zip', '')
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtractDir}'"`,
        { timeout: 60_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
    } else {
      execSync(`unzip -o "${tmpZip}" -d "${tmpExtractDir}"`, {
        timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
      })
    }

    // Copy binary to ~/.bun/bin/
    const extractedBun = resolve(tmpExtractDir, folderName, `bun${ext}`)
    if (!existsSync(extractedBun)) {
      const msg = `Extracted binary not found at ${extractedBun}`
      getLogger().error({ category: 'install' }, `[install-bun] ${msg}`)
      return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
    }

    const { copyFileSync } = await import('node:fs')
    copyFileSync(extractedBun, bunPath)
    if (process.platform !== 'win32') {
      chmodSync(bunPath, 0o755)
    }
    getLogger().info({ category: 'install' }, `[install-bun] Binary installed to ${bunPath}`)

    // Clean up temp files
    try {
      const { rmSync } = await import('node:fs')
      rmSync(tmpZip, { force: true })
      rmSync(tmpExtractDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }

    resetShellEnvCache()

    const msg = `Bun installed to ${bunPath} (from ${downloadSource})`
    getLogger().info({ category: 'install' }, `[install-bun] ${msg}`)
    return { ok: true, stdout: msg, stderr: '', exitCode: 0 }
  } catch (err: any) {
    const msg = err.message ?? String(err)
    getLogger().error({ category: 'install' }, `[install-bun] Install failed: ${msg}`)
    return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
  }
}

const GIT_CDN_URL = 'https://cdn.chat2db-ai.com/youclaw/tools/git/Git-2.53.0.2-64-bit.exe.zip'

/**
 * Download Git installer from CDN, extract, and run silent install on Windows.
 * Downloads .exe.zip → extracts .exe → runs with /VERYSILENT /NORESTART.
 */
async function installGitWindows(): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const logger = getLogger()

  // Download zip
  logger.info({ category: 'install' }, `[install-git] Downloading from ${GIT_CDN_URL}...`)
  let zipBuffer: ArrayBuffer | null = null
  try {
    const resp = await fetch(GIT_CDN_URL, { signal: AbortSignal.timeout(180_000) })
    if (!resp.ok) {
      const msg = `HTTP ${resp.status} from ${GIT_CDN_URL}`
      logger.error({ category: 'install' }, `[install-git] ${msg}`)
      return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
    }
    zipBuffer = await resp.arrayBuffer()
    logger.info({ category: 'install' }, `[install-git] Downloaded ${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`)
  } catch (err: any) {
    const msg = `Download failed: ${err.message}`
    logger.error({ category: 'install' }, `[install-git] ${msg}`)
    return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
  }

  try {
    // Write zip to temp
    const ts = Date.now()
    const tmpZip = resolve(tmpdir(), `git-install-${ts}.zip`)
    const tmpExtractDir = resolve(tmpdir(), `git-extract-${ts}`)
    writeFileSync(tmpZip, Buffer.from(zipBuffer))
    logger.info({ category: 'install' }, `[install-git] Zip saved to ${tmpZip}, extracting...`)

    // Extract
    mkdirSync(tmpExtractDir, { recursive: true })
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpZip}' -DestinationPath '${tmpExtractDir}'"`,
      { timeout: 60_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    // Find the .exe inside extracted directory
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(tmpExtractDir)
    const exeFile = files.find(f => f.endsWith('.exe'))
    if (!exeFile) {
      const msg = `No .exe found in extracted zip (files: ${files.join(', ')})`
      logger.error({ category: 'install' }, `[install-git] ${msg}`)
      return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
    }

    const exePath = resolve(tmpExtractDir, exeFile)
    logger.info({ category: 'install' }, `[install-git] Running silent install: ${exePath}`)

    // Run silent install (will trigger UAC)
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    try {
      stdout = execSync(`"${exePath}" /VERYSILENT /NORESTART /SP-`, {
        encoding: 'utf-8',
        timeout: 300_000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err: any) {
      stdout = err.stdout ?? ''
      stderr = err.stderr ?? ''
      exitCode = err.status ?? 1
    }

    // Clean up temp files
    try {
      const { rmSync } = await import('node:fs')
      rmSync(tmpZip, { force: true })
      rmSync(tmpExtractDir, { recursive: true, force: true })
    } catch { /* ignore */ }

    resetShellEnvCache()

    if (exitCode === 0) {
      logger.info({ category: 'install' }, `[install-git] Git installed successfully`)
    } else {
      logger.error({ category: 'install', exitCode, stderr }, `[install-git] Install failed`)
    }

    return { ok: exitCode === 0, stdout, stderr, exitCode }
  } catch (err: any) {
    const msg = err.message ?? String(err)
    logger.error({ category: 'install' }, `[install-git] ${msg}`)
    return { ok: false, stdout: '', stderr: msg, exitCode: 1 }
  }
}

health.post('/install-tool', async (c) => {
  const body = await c.req.json()
  const parsed = installToolSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid parameters' }, 400)
  }

  const { tool } = parsed.data
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'

  // Bun: download from CDN and extract
  if (tool === 'bun') {
    const result = await installBun()
    return c.json(result)
  }

  // Git on Windows: download from CDN and run silent install
  if (tool === 'git' && isWindows) {
    const result = await installGitWindows()
    return c.json(result)
  }

  // Git on macOS / Node.js on Windows: use platform commands
  let command: string | null = null
  switch (tool) {
    case 'git':
      if (isMac) {
        command = 'xcode-select --install'
      }
      break
    case 'node':
      if (isWindows) {
        command = 'winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --disable-interactivity'
      }
      break
  }

  if (!command) {
    const msg = `No install method available for "${tool}" on ${process.platform}`
    getLogger().warn({ category: 'install' }, `[install-${tool}] ${msg}`)
    return c.json({ error: msg }, 400)
  }

  const logger = getLogger()
  logger.info({ category: 'install', tool, command }, `[install-${tool}] Starting installation...`)

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      timeout: 300_000,
      windowsHide: true,
      env: getShellEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    logger.info({ category: 'install', tool, exitCode: 0 }, `[install-${tool}] Command completed successfully`)
  } catch (err: any) {
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
    exitCode = err.status ?? 1
    // xcode-select --install returns non-zero if CLT is already installed or dialog is shown
    if (tool === 'git' && isMac) {
      exitCode = 0
      logger.info({ category: 'install', tool }, `[install-${tool}] xcode-select dialog triggered`)
    } else {
      logger.error({ category: 'install', tool, exitCode, stderr }, `[install-${tool}] Command failed`)
    }
  }

  resetShellEnvCache()

  logger.info({ category: 'install', tool, ok: exitCode === 0 }, `[install-${tool}] Done (exitCode=${exitCode})`)
  return c.json({ ok: exitCode === 0, stdout, stderr, exitCode })
})

export { health }
