import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv } from './env.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// bun build --compile 后 __dirname 在虚拟 FS 下
// macOS/Linux: /$bunfs/root/  Windows: B:\~BUN\root
const isBunCompiled = __dirname.includes('/$bunfs/') || __dirname.includes('~BUN')

// 开发模式：项目根目录
export const ROOT_DIR = isBunCompiled
  ? process.cwd()
  : resolve(__dirname, '../..')

export function getPaths() {
  const env = getEnv()

  // DATA_DIR：可写数据目录（数据库、日志、浏览器 profile 等）
  const dataDir = isBunCompiled && process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : resolve(ROOT_DIR, env.DATA_DIR)

  // RESOURCES_DIR：Tauri bundle 的只读资源目录（agents/skills/prompts 模板）
  // 开发模式下直接用项目根目录
  const resourcesDir = process.env.RESOURCES_DIR
    ? resolve(process.env.RESOURCES_DIR)
    : ROOT_DIR

  // agents 目录需要可写（创建新 agent、写 memory 等），放在 DATA_DIR 下
  // 首次启动时由 AgentManager 从 resourcesDir 复制默认模板
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
