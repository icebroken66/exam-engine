// Optional private acceptance evidence. Reads explicit copies only; no backend.
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const directory = path.resolve(process.argv[2] || '')
if (!process.argv[2] || !path.basename(directory).startsWith('acceptance-reader-')) throw new Error('Pass an explicit data/acceptance-reader-<unique-id> evidence folder with real-course.pdf and pptx-preview.pdf copies.')
const hash = f => createHash('sha256').update(readFileSync(f)).digest('hex')
mkdirSync(directory, { recursive: true })
const results = []
for (const channel of ['msedge', 'chrome']) {
  const browser = await chromium.launch({ channel })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const network = [], errors = []
  page.on('request', r => { if (r.url().includes('/api/') || !r.url().startsWith('http://127.0.0.1:7172')) network.push(r.url()) })
  page.on('pageerror', e => errors.push(e.message))
  const report = { channel, version: browser.version(), network, errors, files: [] }
  for (const [name, pages] of [['real-course.pdf', [1, 4, 8, 16, 35]], ['pptx-preview.pdf', [1, 2, 3, 4, 5]]]) {
    const file = path.join(directory, name), before = hash(file)
    await page.goto('http://127.0.0.1:7172/reader-lab.html')
    const start = performance.now()
    await page.getByLabel('打开本地 PDF', { exact: true }).setInputFiles(file)
    await page.locator('.rl-page[data-ready=true]').waitFor()
    const entry = { name, before, after: '', coldOpenMs: performance.now()-start, pages: [] }
    await page.getByLabel('缩放', { exact: true }).selectOption('0.5')
    await page.locator('.rl-page[data-ready=true]').waitFor()
    for (const n of pages) {
      const started = performance.now()
      await page.getByLabel('跳转页码').fill(String(n)); await page.getByRole('button', { name: '跳转', exact: true }).click()
      await page.locator(`.rl-page[data-page="${n}"][data-ready=true]`).waitFor()
      const nav = performance.now()-started
      await page.screenshot({ path: path.join(directory, `${channel}-${name}-${n}.png`) })
      entry.pages.push({ page: n, navigationWithAutomationMs: nav, text: await page.locator('.rl-page .rl-text-layer').innerText() })
    }
    entry.after = hash(file); if (entry.before !== entry.after) throw new Error('Source copy changed')
    report.files.push(entry)
  }
  results.push(report); await browser.close()
}
writeFileSync(path.join(directory, 'local-samples.json'), JSON.stringify(results,null,2)+'\n')
console.log(JSON.stringify(results.map(r => ({channel:r.channel,version:r.version,files:r.files.map(f=>({name:f.name,coldOpenMs:f.coldOpenMs,unchanged:f.before===f.after,pages:f.pages.map(p=>({page:p.page,ms:p.navigationWithAutomationMs}))})),errors:r.errors,network:r.network})),null,2))
