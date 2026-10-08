import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 30000,
  reporter: 'list', outputDir: '../../artifacts/moss.audit/browser-results',
  use: { baseURL: 'http://127.0.0.1:4183', channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: { width: 1200, height: 800 }, trace: 'retain-on-failure' },
  webServer: { command: 'bun run dev --port 4183 --strictPort', url: 'http://127.0.0.1:4183', reuseExistingServer: !process.env.CI },
})
