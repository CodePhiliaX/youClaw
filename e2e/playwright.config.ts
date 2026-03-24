import { defineConfig } from '@playwright/test'

const E2E_BACKEND_PORT = 62601

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `PORT=${E2E_BACKEND_PORT} bun run dev`,
      port: E2E_BACKEND_PORT,
      reuseExistingServer: true,
      cwd: '..',
    },
    {
      command: `PORT=${E2E_BACKEND_PORT} bun run dev`,
      port: 5173,
      reuseExistingServer: true,
      cwd: '../web',
    },
  ],
})
