import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', fullyParallel: true, timeout: 30000,
  reporter: 'list', outputDir: '../../artifacts/moss.devtools/browser-results',
  use: { baseURL: 'http://127.0.0.1:4178', channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: { width: 1080, height: 740 }, trace: 'retain-on-failure' },
  webServer: { command: 'bun run dev --port 4178 --strictPort', url: 'http://127.0.0.1:4178', reuseExistingServer: !process.env.CI },
})
