/**
 * External tool download URLs — derived from app.config.ts
 */

import appConfig from '../../../app.config.ts'

export const CDN_BASE = appConfig.toolsCdnBase

// Git for Windows (manual download link)
export const GIT_DOWNLOAD_URL = `${CDN_BASE}/git/${appConfig.tools.git.windowsFileName}`
