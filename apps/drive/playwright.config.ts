import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', fullyParallel: true, timeout: 30_000,
  reporter: 'list', outputDir: './test-results',
  use: { baseURL: 'http://127.0.0.1:4176', channel: 'chrome', headless: true, viewport: { width: 1120, height: 760 }, trace: 'retain-on-failure' },
  webServer: { command: 'bun run dev --port 4176 --strictPort', url: 'http://127.0.0.1:4176', reuseExistingServer: !process.env.CI },
})
