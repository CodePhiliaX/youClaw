/**
 * YouClaw Application Configuration
 *
 * Single source of truth for all app-level constants.
 * Both backend (src/) and frontend (web/src/) import from this file.
 */

const appConfig = {
  // ── App Info ──
  name: 'YouClaw',
  identifier: 'com.youclaw.app',
  github: 'https://github.com/CodePhiliaX/youClaw',
  supportEmail: 'support@chat2db-ai.com',

  // ── Server Defaults ──
  defaultPort: 62601,
  defaultDataDir: './data',
  defaultModel: 'minimax/MiniMax-M2.7-highspeed',
  defaultLogLevel: 'info' as const,

  // ── CDN ──
  cdnBase: 'https://cdn.chat2db-ai.com/youclaw',
  toolsCdnBase: 'https://cdn.chat2db-ai.com/youclaw/tools',

  // ── External Tool Downloads ──
  tools: {
    bun: {
      version: '1.2.15',
      githubReleaseBase: 'https://github.com/oven-sh/bun/releases/download',
    },
    git: {
      version: '2.53.0.2',
      windowsFileName: 'Git-2.53.0.2-64-bit.exe.zip',
    },
  },
} as const

export default appConfig
