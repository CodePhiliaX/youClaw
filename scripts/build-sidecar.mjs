#!/usr/bin/env node

/**
 * 构建 Bun sidecar 可执行文件
 *
 * 用法：
 *   node scripts/build-sidecar.mjs          # 仅当前平台
 *   node scripts/build-sidecar.mjs --all    # 所有平台
 */

import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
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

console.log('\nSidecar build complete!')
