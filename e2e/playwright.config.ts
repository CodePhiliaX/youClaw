import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
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
      command: 'bun run dev',
      port: 3000,
      reuseExistingServer: true,
      cwd: '..',
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: true,
      cwd: '../web',
    },
  ],
})
