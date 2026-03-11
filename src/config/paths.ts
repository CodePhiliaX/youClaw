import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv } from './env.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isCompiledBuild = __dirname.replace(/\\/g, '/').includes('/dist/src/')
export const ROOT_DIR = resolve(__dirname, isCompiledBuild ? '../../..' : '../..')

const UNPACKED_ROOT = ROOT_DIR.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')

export function getPaths() {
  const env = getEnv()
  const dataDir = resolve(ROOT_DIR, env.DATA_DIR)

  return {
    root: ROOT_DIR,
    data: dataDir,
    db: resolve(dataDir, 'youclaw.db'),
    agents: resolve(UNPACKED_ROOT, 'agents'),
    skills: resolve(UNPACKED_ROOT, 'skills'),
    prompts: resolve(UNPACKED_ROOT, 'prompts'),
    browserProfiles: resolve(dataDir, 'browser-profiles'),
    logs: resolve(dataDir, 'logs'),
  }
}
