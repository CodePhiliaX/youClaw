#!/usr/bin/env bun

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const resourcesDir = resolve(root, 'src-tauri', 'resources')
const bunRuntimeDir = resolve(resourcesDir, 'bun-runtime')
const nodeRuntimeDir = resolve(resourcesDir, 'node-runtime')
const generatedConfigPath = resolve(root, 'src-tauri', 'tauri.diagnostic.generated.json')
const runtimeCacheDir = resolve(root, '.cache', 'youclaw-runtime')
const nodeVersion = process.env.YOUCLAW_NODE22_VERSION?.trim() || 'v22.22.1'

function log(message) {
  console.log(`[diagnostic-build] ${message}`)
}

function resolveExecutable(command, envKey) {
  const override = process.env[envKey]?.trim()
  if (override) {
    return override
  }

  const lookup = process.platform === 'win32' ? `where ${command}` : `which ${command}`
  const output = execSync(lookup, { cwd: root, encoding: 'utf-8' }).trim()
  const [first] = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!first) {
    throw new Error(`Unable to resolve ${command}`)
  }
  return first
}

function resolveBunExecutable() {
  const override = process.env.YOUCLAW_BUN_PATH?.trim()
  if (override) {
    return override
  }

  const execPath = process.execPath?.trim()
  if (execPath && existsSync(execPath)) {
    return execPath
  }

  return resolveExecutable('bun', 'YOUCLAW_BUN_PATH')
}

function shellEscape(value) {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function powershellEscape(value) {
  return value.replace(/'/g, "''")
}

function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function getNode22Distribution() {
  const platform = process.platform
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) {
    throw new Error(`Unsupported architecture for Node 22 runtime: ${process.arch}`)
  }

  if (platform === 'win32') {
    const baseName = `node-${nodeVersion}-win-${arch}`
    return {
      archiveName: `${baseName}.zip`,
      binaryRelativePath: join(baseName, 'node.exe'),
    }
  }

  if (platform === 'darwin' || platform === 'linux') {
    const baseName = `node-${nodeVersion}-${platform}-${arch}`
    return {
      archiveName: `${baseName}.tar.gz`,
      binaryRelativePath: join(baseName, 'bin', 'node'),
    }
  }

  throw new Error(`Unsupported platform for Node 22 runtime download: ${platform}`)
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: ${url} -> HTTP ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  writeFileSync(destinationPath, Buffer.from(arrayBuffer))
}

function extractArchive(archivePath, destinationDir) {
  ensureDir(destinationDir)
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -NonInteractive -Command "& { Expand-Archive -LiteralPath '${powershellEscape(archivePath)}' -DestinationPath '${powershellEscape(destinationDir)}' -Force }"`,
        { cwd: root, stdio: 'inherit' },
      )
      return
    }

    execSync(`unzip -oq ${shellEscape(archivePath)} -d ${shellEscape(destinationDir)}`, {
      cwd: root,
      stdio: 'inherit',
    })
    return
  }

  execSync(`tar -xzf ${shellEscape(archivePath)} -C ${shellEscape(destinationDir)}`, {
    cwd: root,
    stdio: 'inherit',
  })
}

function readVersion(executablePath) {
  return execSync(`"${executablePath}" --version`, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true })
}

async function resolveNode22Executable() {
  const override = process.env.YOUCLAW_NODE22_PATH?.trim()
  if (override) {
    return override
  }

  const distribution = getNode22Distribution()
  const baseUrl = `https://nodejs.org/dist/${nodeVersion}`
  const cacheRoot = resolve(runtimeCacheDir, `node-${nodeVersion}-${process.platform}-${process.arch}`)
  const archivePath = resolve(cacheRoot, distribution.archiveName)
  const extractDir = resolve(cacheRoot, 'extracted')
  const executablePath = resolve(extractDir, distribution.binaryRelativePath)
  const shasumsPath = resolve(cacheRoot, 'SHASUMS256.txt')
  const forceDownload = process.env.YOUCLAW_FORCE_DOWNLOAD_NODE22 === '1'

  if (!forceDownload && existsSync(executablePath)) {
    const version = readVersion(executablePath)
    if (/^v22\./.test(version)) {
      log(`Using cached Node 22 runtime: ${executablePath} (${version})`)
      return executablePath
    }
  }

  ensureDir(cacheRoot)

  log(`Downloading Node 22 runtime from ${baseUrl}/${distribution.archiveName}`)
  await downloadFile(`${baseUrl}/${distribution.archiveName}`, archivePath)
  await downloadFile(`${baseUrl}/SHASUMS256.txt`, shasumsPath)

  const shasums = readFileSync(shasumsPath, 'utf-8')
  const expectedChecksum = shasums
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(`  ${distribution.archiveName}`))
    ?.split(/\s+/)[0]

  if (!expectedChecksum) {
    throw new Error(`Unable to find checksum for ${distribution.archiveName} in SHASUMS256.txt`)
  }

  const actualChecksum = sha256OfFile(archivePath)
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${distribution.archiveName}: expected ${expectedChecksum}, got ${actualChecksum}`)
  }

  rmSync(extractDir, { recursive: true, force: true })
  extractArchive(archivePath, extractDir)

  if (!existsSync(executablePath)) {
    throw new Error(`Extracted Node 22 runtime not found: ${executablePath}`)
  }

  const version = readVersion(executablePath)
  if (!/^v22\./.test(version)) {
    throw new Error(`Downloaded runtime is not Node 22.x: ${version} (${executablePath})`)
  }

  log(`Downloaded Node 22 runtime: ${executablePath} (${version})`)
  return executablePath
}

async function copyRuntime({ label, envKey, command, targetDir, targetName, expectedNodeMajor }) {
  const executablePath = expectedNodeMajor === 22
    ? await resolveNode22Executable()
    : command === 'bun'
      ? resolveBunExecutable()
      : resolveExecutable(command, envKey)
  const version = readVersion(executablePath)

  if (expectedNodeMajor) {
    const match = version.match(/^v(\d+)\./)
    const major = Number.parseInt(match?.[1] || '0', 10)
    if (major !== expectedNodeMajor) {
      throw new Error(`${label} must be Node ${expectedNodeMajor}.x, got ${version} (${executablePath})`)
    }
  }

  ensureDir(targetDir)
  const outputPath = resolve(targetDir, targetName)
  copyFileSync(executablePath, outputPath)
  const sizeKb = Math.round(statSync(outputPath).size / 1024)
  log(`Copied ${label}: ${executablePath} -> ${outputPath} (${version}, ${sizeKb} KB)`)
}

function generateConfig() {
  const config = {
    productName: 'YouClaw Diagnostics',
    identifier: 'com.youclaw.app.diagnostic',
    build: {
      beforeBuildCommand: 'cd web && bun run build',
      frontendDist: '../web/dist',
    },
    bundle: {
      createUpdaterArtifacts: false,
      externalBin: [],
      resources: [
        'resources/diagnostic/**/*',
        'resources/bun-runtime/*',
        'resources/node-runtime/*',
      ],
    },
  }

  writeFileSync(generatedConfigPath, JSON.stringify(config, null, 2), 'utf-8')
  log(`Generated ${generatedConfigPath}`)
}

async function main() {
  await copyRuntime({
    label: 'Bun runtime',
    envKey: 'YOUCLAW_BUN_PATH',
    command: 'bun',
    targetDir: bunRuntimeDir,
    targetName: process.platform === 'win32' ? 'bun.exe' : 'bun',
  })

  await copyRuntime({
    label: 'Node runtime',
    envKey: 'YOUCLAW_NODE22_PATH',
    command: 'node',
    targetDir: nodeRuntimeDir,
    targetName: process.platform === 'win32' ? 'node.exe' : 'node',
    expectedNodeMajor: 22,
  })

  generateConfig()

  const env = {
    ...process.env,
    VITE_YOUCLAW_DIAGNOSTIC: '1',
    YOUCLAW_DIAGNOSTIC_BUILD: '1',
  }

  try {
    execSync(`bun tauri build -c "${generatedConfigPath}"`, {
      cwd: root,
      env,
      stdio: 'inherit',
    })
  } finally {
    rmSync(generatedConfigPath, { force: true })
  }
}

await main()
