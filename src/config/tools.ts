/**
 * External tool download URLs — derived from app.config.ts
 */

import appConfig from '../../app.config.ts'

export const CDN_BASE = appConfig.toolsCdnBase

// Bun runtime
export const BUN_VERSION = appConfig.tools.bun.version
export const BUN_CDN_BASE = `${CDN_BASE}/bun`
export const BUN_GITHUB_BASE = `${appConfig.tools.bun.githubReleaseBase}/bun-v${BUN_VERSION}`

// Git for Windows
export const GIT_VERSION = appConfig.tools.git.version
export const GIT_CDN_URL = `${CDN_BASE}/git/${appConfig.tools.git.windowsFileName}`
