import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv } from './env.ts'

// 项目根目录
// 从 src/config/ 运行时向上 2 级，从 dist/src/config/ 运行时向上 3 级
const __dirname = dirname(fileURLToPath(import.meta.url))
const isCompiledBuild = __dirname.replace(/\\/g, '/').includes('/dist/src/')
export const ROOT_DIR = resolve(__dirname, isCompiledBuild ? '../../..' : '../..')

export function getPaths() {
  const env = getEnv()
  const dataDir = resolve(ROOT_DIR, env.DATA_DIR)

  return {
    root: ROOT_DIR,
    data: dataDir,
    db: resolve(dataDir, 'youclaw.db'),
    agents: resolve(ROOT_DIR, 'agents'),
    skills: resolve(ROOT_DIR, 'skills'),
    prompts: resolve(ROOT_DIR, 'prompts'),
  }
}
