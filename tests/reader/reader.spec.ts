import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const fixtures = path.resolve('tests/fixtures/reader')
const btn = (p: Page, name: string) => p.getByRole('button', { name, exact: true })
const ready = (p: Page, n = 1) => expect(p.getByTestId('reader-page')).toHaveAttribute('data-ready', 'true').then(() => expect(p.getByTestId('reader-page')).toHaveAttribute('data-page', String(n)))
async function open(p: Page, file = 'mixed.pdf') { await p.getByLabel('打开本地 PDF', { exact: true }).setInputFiles(path.join(fixtures, file)); await ready(p) }
async function region(p: Page, x = .2, y = .32, w = .25, h = .1) {
  await btn(p, '框选').click(); const b = (await p.getByTestId('reader-page').boundingBox())!
  await p.mouse.move(b.x + b.width*x, b.y + b.height*y); await p.mouse.down(); await p.mouse.move(b.x + b.width*(x+w), b.y + b.height*(y+h), { steps: 6 }); await p.mouse.up()
}
async function ink(p: Page, x = .2, y = .5) {
  await btn(p, '笔刷').click(); const b = (await p.getByTestId('reader-page').boundingBox())!
  await p.mouse.move(b.x+b.width*x,b.y+b.height*y); await p.mouse.down(); await p.mouse.move(b.x+b.width*(x+.1),b.y+b.height*(y+.02), { steps: 8 }); await p.mouse.up()
}
async function saved(p: Page) { await expect(p.getByTestId('save-status')).toHaveText('已保存') }
async function snapshot(p: Page) {
  return p.evaluate(async () => { const db = await new Promise<IDBDatabase>((res,rej) => { const r = indexedDB.open('fe-v01-reader',1); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) }); const all = await new Promise<any[]>((res,rej)=>{ const r=db.transaction('snapshots').objectStore('snapshots').getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) }); db.close(); return all })
}
test.beforeEach(async ({ page }) => { await page.goto('/reader-lab.html') })
test('A03-A06 A08 A10-A13 annotation, history, persistence and context return', async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (['/api/', 'openai', 'anthropic'].some(s => r.url().includes(s))) requests.push(r.url()) })
  await open(page)
  await region(page); await btn(page,'高亮选区').click(); await ink(page)
  await btn(page,'添加贴条').click(); await page.getByLabel('贴条内容').fill('这是批注草稿'); await btn(page,'阅读').click()
  await expect(page.locator('[data-annotation]')).toHaveCount(3)
  await btn(page,'撤销').click(); await expect(page.getByLabel('贴条内容')).toHaveValue('')
  await btn(page,'重做').click(); await expect(page.getByLabel('贴条内容')).toHaveValue('这是批注草稿')
  const handle = page.getByLabel('拖动贴条'); const before = (await handle.boundingBox())!
  await handle.hover(); await page.mouse.down(); await page.mouse.move(before.x+40,before.y+25,{steps:5}); await page.mouse.up()
  await btn(page,'撤销').click(); await btn(page,'重做').click()
  await btn(page,'隐藏批注').click(); await expect(page.locator('[data-annotation]')).toHaveCount(0); await btn(page,'显示批注').click(); await expect(page.locator('[data-annotation]')).toHaveCount(3)
  await btn(page,'问 AI／上下文').click(); await page.getByLabel('问题草稿').fill('请解释这段公式')
  await btn(page,'固定引用：定位第 2 页').click(); await ready(page,2); await expect(page.locator('.rl-indication')).toHaveCount(1)
  await btn(page,'返回原位置').click(); await ready(page); await expect(page.getByLabel('问题草稿')).toHaveValue('请解释这段公式')
  await page.getByText('异常引用验证夹具',{exact:true}).click()
  for (const name of ['无效页号引用','版本不匹配引用','区域缺失引用']) { await btn(page,name).click(); await expect(page.getByRole('alert')).toContainText('未跳转'); await expect(page.getByTestId('reader-page')).toHaveAttribute('data-page','1') }
  await saved(page); const state = await snapshot(page); expect(state[0].annotations).toHaveLength(3); expect(state[0].reader.context.page).toBe(1)
  await page.screenshot({path:info.outputPath('annotations-and-context.png')})
  await page.getByLabel('夹具：存储写失败').check(); await page.getByLabel('问题草稿').fill('失败期间问题仍保留'); await expect(page.getByTestId('save-status')).toHaveText('保存失败'); expect((await snapshot(page))[0].reader.draft).toBe('请解释这段公式')
  const download = page.waitForEvent('download'); await btn(page,'导出验证 JSON').click(); const file = await download; expect(file.suggestedFilename()).toBe('fe-v01-reader-export.json')
  await page.getByLabel('夹具：存储写失败').uncheck(); await btn(page,'重试保存').click(); await saved(page)
  await page.reload(); await expect(page.getByText(/刷新后请重新选择原文件/)).toBeVisible(); await open(page); await expect(page.locator('[data-annotation]')).toHaveCount(3); await expect(page.getByLabel('问题草稿')).toHaveValue('失败期间问题仍保留')
  await expect(page.getByLabel('贴条内容')).toHaveValue('这是批注草稿'); expect(requests).toEqual([]); expect(errors).toEqual([])
})
test('A03 A05 text selection and image-only fallback', async ({page}, info) => {
  await open(page); await btn(page,'选字').click()
  const spans = page.locator('.rl-page .rl-text-layer span')
  const first = spans.filter({hasText:'跨行中文第一行'}), last = spans.filter({hasText:'跨行中文第二行'})
  const a=(await first.boundingBox())!, b=(await last.boundingBox())!
  await page.mouse.move(a.x+1,a.y+a.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width-1,b.y+b.height/2,{steps:10}); await page.mouse.up()
  await btn(page,'问 AI／上下文').click(); await expect(page.locator('blockquote')).toContainText('跨行中文第一行'); await expect(page.locator('blockquote')).toContainText('跨行中文第二行')
  await btn(page,'高亮选区').click(); await expect(page.locator('[data-annotation] rect')).toHaveCount(2)
  await btn(page,'关闭面板').click(); await btn(page,'下一页').click(); await ready(page,2); await btn(page,'下一页').click(); await ready(page,3); await expect(page.getByText('本页没有可用文字层，请使用框选。')).toBeVisible()
  await region(page); await btn(page,'问 AI／上下文').click(); await expect(page.locator('blockquote')).toContainText('未执行 OCR')
  await page.screenshot({path:info.outputPath('image-fallback.png')})
})
test('A07 A15 actual DOM alignment across scaling, resizing, panel, reopen', async ({page},info) => {
  await open(page)
  const refs=[{x:.08,y:.08,w:.1,h:.06},{x:.4,y:.3,w:.15,h:.08},{x:.72,y:.55,w:.12,h:.1}]
  for (const r of refs) {await region(page,r.x,r.y,r.w,r.h);await btn(page,'高亮选区').click()}
  let worst=0
  async function measure() {
    // ResizeObserver and PDF.js settle asynchronously; measure the completed frame.
    await expect.poll(() => page.evaluate(() => { const p=document.querySelector('.rl-page')!.getBoundingClientRect(), c=document.querySelector('.rl-page canvas')!.getBoundingClientRect(); return Math.abs(p.width-c.width)+Math.abs(p.height-c.height) })).toBeLessThan(1)
    const result = await page.evaluate(() => {
      const p=document.querySelector('.rl-page')!.getBoundingClientRect(), canvas=document.querySelector('.rl-page canvas')!.getBoundingClientRect()
      const svg=document.querySelector('.rl-overlay')!.getBoundingClientRect()
      const cornerError=Math.max(Math.abs(p.left-canvas.left),Math.abs(p.top-canvas.top),Math.abs(p.right-canvas.right),Math.abs(p.bottom-canvas.bottom),Math.abs(p.left-svg.left),Math.abs(p.top-svg.top),Math.abs(p.right-svg.right),Math.abs(p.bottom-svg.bottom))
      const boxes=Array.from(document.querySelectorAll('[data-annotation] rect')).map(el=>{const b=el.getBoundingClientRect();return {x:b.left-p.left,y:b.top-p.top,width:b.width,height:b.height}})
      return {p:{width:p.width,height:p.height},boxes,cornerError,overflow:document.documentElement.scrollWidth>innerWidth}
    })
    expect(result.overflow).toBe(false); worst=Math.max(worst,result.cornerError)
    result.boxes.forEach((b,i)=>{const r=refs[i];worst=Math.max(worst,Math.abs(b.x-r.x*result.p.width),Math.abs(b.y-r.y*result.p.height),Math.abs(b.x+b.width-(r.x+r.w)*result.p.width),Math.abs(b.y+b.height-(r.y+r.h)*result.p.height))})
    expect(worst).toBeLessThanOrEqual(4)
  }
  for(let i=0;i<10;i++){for(const z of ['0.5','2','1','fit']){await page.getByLabel('缩放',{exact:true}).selectOption(z);await ready(page);await measure()}}
  await btn(page,'问 AI／上下文').click();await measure();await btn(page,'关闭面板').click();await measure()
  await page.locator('.rl-scroll').evaluate(el=>{el.scrollTop=120;el.scrollLeft=70});await measure()
  await btn(page,'下一页').click();await ready(page,2);await expect(page.locator('[data-annotation]')).toHaveCount(0);await btn(page,'上一页').click();await ready(page);await measure()
  await saved(page);await page.reload();await open(page);await measure()
  const original=page.viewportSize()!;await page.setViewportSize({width:Math.max(1024,original.width-160),height:768});await measure();await page.setViewportSize(original)
  await page.screenshot({path:info.outputPath('alignment.png')}); await info.attach('alignment-measurement',{body:JSON.stringify({method:'actual canvas, overlay and annotation DOM corner measurements against three independently mouse-selected reference regions; 10 roundtrips',worstCssPx:worst,browser:info.project.use.channel,viewport:original}),contentType:'application/json'})
})
test('A09 A14 file identity, unknown storage, corrupt file recovery', async ({page}) => {
  await open(page);await btn(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('原版本');await btn(page,'阅读').click();await saved(page)
  const old=(await snapshot(page))[0]
  await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles({name:'mixed.pdf',mimeType:'application/pdf',buffer:readFileSync(path.join(fixtures,'same-name-v2.pdf'))});await ready(page);await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await open(page);await expect(page.getByLabel('贴条内容')).toHaveValue('原版本')
  await page.evaluate(async s=>{const db=await new Promise<IDBDatabase>(res=>{const r=indexedDB.open('fe-v01-reader',1);r.onsuccess=()=>res(r.result)});await new Promise<void>(res=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({...s,schema:99},`${s.document.id}:${s.document.previewVersion}`);tx.oncomplete=()=>res()});db.close()},old)
  await page.reload();await open(page);await expect(page.getByRole('alert')).toContainText('未知保存格式');await btn(page,'添加贴条').click();await expect(page.getByTestId('save-status')).toHaveText('保存失败');expect((await snapshot(page))[0].schema).toBe(99)
  await page.reload();await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.join(fixtures,'corrupt.pdf'));await expect(page.getByRole('heading',{name:'课件读取失败'})).toBeVisible();await open(page,'representative-12p.pdf');await expect(page.getByRole('button',{name:'打开第 12 页',exact:true})).toBeVisible()
})
test('A16 density: 20 strokes, 10 highlights and 10 notes survive reopening', async ({page},info)=>{
  await open(page);const started=Date.now()
  for(let i=0;i<20;i++)await ink(page,.1+(i%5)*.12,.1+Math.floor(i/5)*.08)
  for(let i=0;i<10;i++){await region(page,.1+(i%5)*.12,.45+Math.floor(i/5)*.08,.08,.04);await btn(page,'高亮选区').click()}
  for(let i=0;i<10;i++){await btn(page,'添加贴条').click();await page.getByLabel('贴条内容').last().fill(`贴条 ${i}`);await btn(page,'阅读').click()}
  await expect(page.locator('[data-annotation]')).toHaveCount(40);await saved(page);await page.reload();await open(page);await expect(page.locator('[data-annotation]')).toHaveCount(40)
  await info.attach('density',{body:JSON.stringify({annotations:40,interactionAndReloadMs:Date.now()-started,performanceSla:'not assessed by total scripted wall time'}),contentType:'application/json'})
})
test('R1 A01 A15 page navigation, bounds and keyboard focus',async({page})=>{
  await open(page,'representative-12p.pdf')
  await expect(btn(page,'上一页')).toBeDisabled()
  for(let i=2;i<=12;i++){await btn(page,'下一页').click();await ready(page,i)}
  await expect(btn(page,'下一页')).toBeDisabled()
  await page.getByLabel('跳转页码').fill('0');await page.getByLabel('跳转页码').press('Enter');await expect(page.getByRole('alert')).toContainText('整数页码')
  await page.getByLabel('跳转页码').fill('1');await page.getByLabel('跳转页码').press('Enter');await ready(page)
  await btn(page,'问 AI／上下文').click();await expect(page.getByLabel('问题草稿')).toBeFocused();await btn(page,'关闭面板').click();await expect(btn(page,'问 AI／上下文')).toBeFocused()
})
