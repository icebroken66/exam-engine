import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:7171',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:web -- --host 127.0.0.1 --port 7171 --strictPort',
    url: 'http://127.0.0.1:7171',
    reuseExistingServer: false,
  },
})
