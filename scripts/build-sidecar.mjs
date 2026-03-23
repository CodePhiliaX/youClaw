#!/usr/bin/env bun

/**
 * Build a runtime-check sidecar executable for the current platform.
 *
 * Supported runtimes:
 * - bun    : Bun compiled executable
 * - node22 : Node 22 SEA executable
 *
 * Set YOUCLAW_SIDECAR_RUNTIME=bun|node22 to switch implementation.
 */

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const binDir = resolve(root, 'src-tauri', 'bin')
const buildDir = resolve(root, '.sidecar-build')
const nodeBin = process.env.YOUCLAW_NODE_BIN || 'node'
const sidecarRuntime = process.env.YOUCLAW_SIDECAR_RUNTIME || 'node22'
const seaFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

const outputNames = {
  darwin: {
    arm64: 'youclaw-server-aarch64-apple-darwin',
    x64: 'youclaw-server-x86_64-apple-darwin',
  },
  linux: {
    x64: 'youclaw-server-x86_64-unknown-linux-gnu',
  },
  win32: {
    x64: 'youclaw-server-x86_64-pc-windows-msvc.exe',
  },
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  })

  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stderr?.trim() || ''}`.trim(),
    )
  }

  return result.stdout.trim()
}

function getOutputName() {
  const osTargets = outputNames[process.platform]
  if (!osTargets) {
    return null
  }
  return osTargets[process.arch] ?? null
}

function ensureNode22() {
  const version = capture(nodeBin, ['--version'])
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '', 10)
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node 22+ is required, got ${version}`)
  }
  return version
}

function findPostject() {
  const candidates = process.platform === 'win32'
    ? [
        resolve(root, 'node_modules', '.bin', 'postject.cmd'),
        resolve(root, 'node_modules', '.bin', 'postject.exe'),
      ]
    : [
        resolve(root, 'node_modules', '.bin', 'postject'),
      ]

  const match = candidates.find((candidate) => existsSync(candidate))
  if (!match) {
    throw new Error('Missing postject. Run `bun install` before building the Node 22 sidecar.')
  }
  return match
}

function generateBuildConstants() {
  const envKeys = ['YOUCLAW_WEBSITE_URL', 'YOUCLAW_API_URL', 'YOUCLAW_BUILTIN_API_URL', 'YOUCLAW_BUILTIN_AUTH_TOKEN']
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

function maybeRemoveMacSignature(binaryPath) {
  if (process.platform !== 'darwin') {
    return
  }

  spawnSync('codesign', ['--remove-signature', binaryPath], {
    cwd: root,
    stdio: 'ignore',
  })
}

function buildBunCompile() {
  const outName = getOutputName()
  if (!outName) {
    throw new Error(`Unsupported platform/arch: ${process.platform}/${process.arch}`)
  }

  if (process.argv.includes('--all')) {
    throw new Error('Runtime-check Bun sidecar build only supports the current platform.')
  }

  const outPath = resolve(binDir, outName)

  console.log(`Building Bun sidecar for ${process.platform}/${process.arch}...\n`)

  mkdirSync(binDir, { recursive: true })
  run('bun', ['build', '--compile', 'src/index.ts', '--outfile', outPath])

  console.log(`\nDone: ${outPath}`)
}

function buildNodeSea() {
  const outName = getOutputName()
  if (!outName) {
    throw new Error(`Unsupported platform/arch: ${process.platform}/${process.arch}`)
  }

  if (process.argv.includes('--all')) {
    throw new Error('Node 22 sidecar build only supports the current platform in this verification branch.')
  }

  const nodeVersion = ensureNode22()
  const nodeExecPath = capture(nodeBin, ['-p', 'process.execPath'])
  const postjectBin = findPostject()
  const outPath = resolve(binDir, outName)
  const bundlePath = resolve(buildDir, 'sidecar.cjs')
  const blobPath = resolve(buildDir, 'sidecar.blob')
  const configPath = resolve(buildDir, 'sea-config.json')

  console.log(`Building Node 22 sidecar for ${process.platform}/${process.arch} (${nodeVersion})...\n`)

  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  run('bun', ['build', '--target=node', '--format=cjs', 'src/index.ts', '--outfile', bundlePath])

  writeFileSync(configPath, JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
  }, null, 2))

  run(nodeBin, [`--experimental-sea-config=${configPath}`])

  copyFileSync(nodeExecPath, outPath)
  chmodSync(outPath, 0o755)
  maybeRemoveMacSignature(outPath)

  const postjectArgs = [
    outPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    seaFuse,
  ]

  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA')
  }

  run(postjectBin, postjectArgs)

  console.log(`\nDone: ${outPath}`)
}

generateBuildConstants()

if (sidecarRuntime === 'bun') {
  buildBunCompile()
} else if (sidecarRuntime === 'node22') {
  buildNodeSea()
} else {
  throw new Error(`Unsupported YOUCLAW_SIDECAR_RUNTIME: ${sidecarRuntime}`)
}

for (const f of readdirSync(root)) {
  if (f.endsWith('.bun-build')) {
    try {
      unlinkSync(resolve(root, f))
    } catch {
      // Ignore cleanup failures.
    }
  }
}

rmSync(buildDir, { recursive: true, force: true })

console.log('\nSidecar build complete!')
