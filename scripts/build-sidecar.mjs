#!/usr/bin/env bun

/**
 * 构建 Bun sidecar 可执行文件
 *
 * 用法：
 *   bun scripts/build-sidecar.mjs          # 仅当前平台
 *   bun scripts/build-sidecar.mjs --all    # 所有平台
 */

import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, unlinkSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const binDir = resolve(root, 'src-tauri', 'bin')

// Bun 编译目标 → Tauri sidecar 文件名映射
const targets = {
  'bun-darwin-arm64': 'youclaw-server-aarch64-apple-darwin',
  'bun-darwin-x64': 'youclaw-server-x86_64-apple-darwin',
  'bun-linux-x64': 'youclaw-server-x86_64-unknown-linux-gnu',
  'bun-windows-x64': 'youclaw-server-x86_64-pc-windows-msvc.exe',
}

// 检测当前平台对应的 target
function getCurrentTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const os = process.platform === 'win32' ? 'windows' : process.platform
  return `bun-${os}-${arch}`
}

// 从环境变量生成 build-constants.ts，将值编译进 sidecar
function generateBuildConstants() {
  const envKeys = ['YOUCLAW_WEBSITE_URL', 'YOUCLAW_API_URL', 'YOUCLAW_BUILTIN_API_URL', 'YOUCLAW_BUILTIN_AUTH_TOKEN', 'MINIMAX_API_KEY', 'MINIMAX_API_HOST']
  const entries = {}
  for (const key of envKeys) {
    const val = process.env[key]
    if (val) {
      entries[key] = val
    }
  }

  const constPath = resolve(root, 'src/config/build-constants.ts')
  const code = `// 此文件由 build-sidecar.mjs 自动生成，请勿手动修改
export const BUILD_CONSTANTS: Record<string, string> = ${JSON.stringify(entries, null, 2)}
`
  writeFileSync(constPath, code, 'utf-8')
  console.log(`Generated build-constants.ts with keys: ${Object.keys(entries).join(', ') || '(none)'}`)
}

function build(bunTarget, outName) {
  const outPath = resolve(binDir, outName)
  console.log(`Building: ${bunTarget} → ${outName}`)

  try {
    execSync(
      `bun build --compile --target=${bunTarget} src/index.ts --outfile "${outPath}"`,
      { cwd: root, stdio: 'inherit' }
    )
    console.log(`  Done: ${outPath}`)
  } catch (err) {
    console.error(`  Failed to build ${bunTarget}:`, err.message)
    process.exit(1)
  }
}

// 确保输出目录存在
mkdirSync(binDir, { recursive: true })

// 生成编译时常量文件
generateBuildConstants()

const buildAll = process.argv.includes('--all')

if (buildAll) {
  console.log('Building sidecar for all platforms...\n')
  for (const [target, name] of Object.entries(targets)) {
    build(target, name)
  }
} else {
  const currentTarget = getCurrentTarget()
  const name = targets[currentTarget]

  if (!name) {
    console.error(`Unsupported platform: ${currentTarget}`)
    console.error('Supported targets:', Object.keys(targets).join(', '))
    process.exit(1)
  }

  console.log(`Building sidecar for current platform (${currentTarget})...\n`)
  build(currentTarget, name)
}

// Copy Bun runtime binary into resources for embedding in Tauri bundle
function copyBunRuntime() {
  const bunRuntimeDir = resolve(root, 'src-tauri', 'resources', 'bun-runtime')
  mkdirSync(bunRuntimeDir, { recursive: true })

  // Get current bun executable path
  const whichCmd = process.platform === 'win32' ? 'where bun' : 'which bun'
  const bunPath = execSync(whichCmd, { encoding: 'utf-8' }).trim().split('\n')[0]

  // Platform-specific naming
  const ext = process.platform === 'win32' ? '.exe' : ''
  const outPath = resolve(bunRuntimeDir, `bun${ext}`)

  copyFileSync(bunPath, outPath)
  chmodSync(outPath, 0o755)
  console.log(`Copied Bun runtime: ${bunPath} → ${outPath}`)
}

copyBunRuntime()

// Download MinGit for Windows (bundled so claude-agent-sdk works without system Git)
async function downloadMinGit() {
  if (process.platform !== 'win32') {
    console.log('Skipping MinGit download (not Windows)')
    return
  }

  const mingitDir = resolve(root, 'src-tauri', 'resources', 'mingit')
  const mingitBash = resolve(mingitDir, 'usr', 'bin', 'bash.exe')

  // Already extracted?
  const { existsSync } = await import('node:fs')
  if (existsSync(mingitBash)) {
    console.log('MinGit already present, skipping download')
    return
  }

  const version = '2.49.0'
  const zipName = `MinGit-${version}-64-bit.zip`
  const url = `https://github.com/git-for-windows/git/releases/download/v${version}.windows.1/${zipName}`
  const zipPath = resolve(root, zipName)

  console.log(`Downloading MinGit ${version}...`)
  execSync(`curl -fsSL -o "${zipPath}" "${url}"`, { stdio: 'inherit' })

  mkdirSync(mingitDir, { recursive: true })
  console.log(`Extracting MinGit to ${mingitDir}...`)
  execSync(`powershell -Command "Expand-Archive -Force '${zipPath}' '${mingitDir}'"`, { stdio: 'inherit' })

  // Cleanup zip
  try { unlinkSync(zipPath) } catch {}
  console.log('MinGit downloaded and extracted successfully')
}

await downloadMinGit()

// 清理 bun build --compile 产生的临时文件
for (const f of readdirSync(root)) {
  if (f.endsWith('.bun-build')) {
    try { unlinkSync(resolve(root, f)) } catch {}
  }
}

console.log('\nSidecar build complete!')
