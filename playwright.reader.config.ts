import { defineConfig } from '@playwright/test'
const port = Number(process.env.READER_PORT || 7172)
const run = process.env.READER_RUN || `local-${Date.now()}`
const evidence = `data/acceptance-reader-${run}`
export default defineConfig({
  testDir: './tests/reader', timeout: 60000, fullyParallel: false, workers: 1,
  outputDir: `${evidence}/browser`, reporter: [['list'], ['json', { outputFile: `${evidence}/playwright.json` }]],
  use: { baseURL: 'http://127.0.0.1:' + port, trace: 'retain-on-failure', headless: !process.env.READER_HEADED },
  projects: ['msedge', 'chrome'].flatMap(channel => [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }].map(viewport => ({ name: `${channel}-${viewport.width}`, use: { channel, viewport } }))),
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port ' + port + ' --strictPort', url: 'http://127.0.0.1:' + port + '/reader-lab.html', reuseExistingServer: false },
})
