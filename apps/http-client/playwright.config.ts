import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: 'list', outputDir: '../../artifacts/moss.http-client/browser-results',
  use: { baseURL: 'http://127.0.0.1:4179', channel: process.env.CI ? undefined : 'chrome', headless: true, viewport: { width: 1080, height: 740 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'bun run build && node scripts/browser-server.mjs', url: 'http://127.0.0.1:4181/info', reuseExistingServer: false, timeout: 60000 },
    { command: 'bun x vite preview --host 127.0.0.1 --port 4179 --strictPort', url: 'http://127.0.0.1:4179', reuseExistingServer: false },
  ],
})
