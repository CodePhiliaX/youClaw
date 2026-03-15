import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv } from './env.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// After bun build --compile, __dirname is under a virtual FS
// macOS/Linux: /$bunfs/root/  Windows: B:\~BUN\root
const isBunCompiled = __dirname.includes('/$bunfs/') || __dirname.includes('~BUN')

// Dev mode: project root directory
export const ROOT_DIR = isBunCompiled
  ? process.cwd()
  : resolve(__dirname, '../..')

export function getPaths() {
  const env = getEnv()

  // DATA_DIR: writable data directory (database, logs, browser profiles, etc.)
  const dataDir = isBunCompiled && process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : resolve(ROOT_DIR, env.DATA_DIR)

  // RESOURCES_DIR: read-only resource directory from Tauri bundle (agents/skills/prompts templates)
  // In dev mode, falls back to project root
  const resourcesDir = process.env.RESOURCES_DIR
    ? resolve(process.env.RESOURCES_DIR)
    : ROOT_DIR

  // agents directory must be writable (creating agents, writing memory, etc.), stored under DATA_DIR
  // On first launch, AgentManager copies default templates from resourcesDir
  const agentsDir = isBunCompiled
    ? resolve(dataDir, 'agents')
    : resolve(ROOT_DIR, 'agents')

  return {
    root: ROOT_DIR,
    data: dataDir,
    db: resolve(dataDir, 'youclaw.db'),
    agents: agentsDir,
    skills: resolve(resourcesDir, isBunCompiled ? '_up_/skills' : 'skills'),
    prompts: resolve(resourcesDir, isBunCompiled ? '_up_/prompts' : 'prompts'),
    browserProfiles: resolve(dataDir, 'browser-profiles'),
    logs: resolve(dataDir, 'logs'),
  }
}
