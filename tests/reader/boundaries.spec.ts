import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
const fixtures = path.resolve('tests/fixtures/reader')
const b = (p:Page,name:string) => p.getByRole('button',{name,exact:true})
async function ready(p:Page,n=1){await expect(p.locator('.rl-page')).toHaveAttribute('data-page',String(n));await expect(p.locator('.rl-page')).toHaveAttribute('data-ready','true')}
async function saved(p:Page){await expect(p.getByTestId('save-status')).toHaveText('已保存')}
async function open(p:Page,n=1){await p.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.join(fixtures,'mixed.pdf'));await ready(p,n)}
async function records(p:Page){return p.evaluate(async()=>{const db=await new Promise<IDBDatabase>((res,rej)=>{const r=indexedDB.open('fe-v01-reader',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const data=await new Promise<any[]>(res=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>res(r.result)});db.close();return data})}
async function box(p:Page,x=.2,y=.3){await b(p,'框选').click();const r=(await p.locator('.rl-page').boundingBox())!;await p.mouse.move(r.x+r.width*x,r.y+r.height*y);await p.mouse.down();await p.mouse.move(r.x+r.width*(x+.15),r.y+r.height*(y+.08),{steps:5});await p.mouse.up()}
async function stroke(p:Page){await b(p,'笔刷').click();const r=(await p.locator('.rl-page').boundingBox())!;await p.mouse.move(r.x+r.width*.15,r.y+r.height*.5);await p.mouse.down();await p.mouse.move(r.x+r.width*.3,r.y+r.height*.53,{steps:8});await p.mouse.up()}
test.beforeEach(async({page})=>{await page.goto('/reader-lab.html')})
test('A03 A06 complete creation deletion history and single line text',async({page})=>{
  await open(page);await stroke(page);await expect(page.locator('[data-annotation]')).toHaveCount(1)
  await b(page,'撤销').click();await expect(page.locator('[data-annotation]')).toHaveCount(0);await b(page,'重做').click()
  await b(page,'阅读').click();const line=page.locator('[data-annotation] polyline');const pos=(await line.boundingBox())!;await page.mouse.click(pos.x+pos.width/2,pos.y+pos.height/2)
  await b(page,'删除选中').click();await expect(page.locator('[data-annotation]')).toHaveCount(0);await b(page,'撤销').click();await b(page,'重做').click();await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await box(page);await b(page,'高亮选区').click();await b(page,'撤销').click();await expect(page.locator('[data-annotation]')).toHaveCount(0);await b(page,'重做').click();await b(page,'阅读').click();await page.locator('[data-annotation] rect').click();await b(page,'删除选中').click();await b(page,'撤销').click();await expect(page.locator('[data-annotation]')).toHaveCount(1);await b(page,'重做').click()
  await b(page,'添加贴条').click();await b(page,'撤销').click();await expect(page.getByLabel('贴条内容')).toHaveCount(0);await b(page,'重做').click();await page.getByLabel('贴条内容').fill('完整历史');await b(page,'阅读').click();await b(page,'撤销').click();await expect(page.getByLabel('贴条内容')).toHaveValue('');await b(page,'重做').click();await expect(page.getByLabel('贴条内容')).toHaveValue('完整历史')
  const note=page.locator('.rl-note'), before=await note.boundingBox();await page.getByLabel('拖动贴条').focus();await page.keyboard.press('ArrowRight');await expect.poll(async()=>Math.round((await note.boundingBox())!.x-before!.x)).toBeGreaterThan(0);await b(page,'撤销').click();expect(Math.abs((await note.boundingBox())!.x-before!.x)).toBeLessThan(1);await b(page,'重做').click()
  await b(page,'删除贴条').click();await expect(page.getByLabel('贴条内容')).toHaveCount(0);await expect(b(page,'添加贴条')).toBeFocused();await b(page,'撤销').click();await expect(page.getByLabel('贴条内容')).toHaveValue('完整历史');await b(page,'重做').click()
  await b(page,'选字').click();const span=page.locator('.rl-page .rl-text-layer span').filter({hasText:'单行中文选择'}), r=(await span.boundingBox())!;await page.mouse.move(r.x+1,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width-1,r.y+r.height/2,{steps:8});await page.mouse.up();await b(page,'问 AI／上下文').click();await expect(page.locator('blockquote')).toContainText('单行中文选择');await expect(page.locator('blockquote')).not.toContainText('跨行中文');await b(page,'取消选区').click();await expect(page.locator('.rl-selection')).toHaveCount(0)
})
test('A05 actual blur, escape, leave and pointer cancel stop a stroke',async({page,context})=>{
  test.skip(!process.env.READER_HEADED, 'Real window/tab focus requires headed browsers; executed in dedicated headed run.')
  await open(page);await b(page,'笔刷').click();const r=(await page.locator('.rl-page').boundingBox())!;const x=r.x+r.width*.2,y=r.y+r.height*.3
  const other=await context.newPage();await other.goto('about:blank');for(const target of [page,other]){const cdp=await context.newCDPSession(target);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false})}await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true)
  for(const why of ['blur','escape','leave','cancel']){
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y+15,{steps:4});await expect(page.locator('.rl-overlay>polyline')).toHaveCount(1)
    if(why==='blur'){await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(false);await page.bringToFront()}
    if(why==='escape')await page.keyboard.press('Escape')
    if(why==='leave')await page.mouse.move(r.x-10,y)
    if(why==='cancel')await page.locator('.rl-overlay').dispatchEvent('pointercancel')
    await page.mouse.up();await page.mouse.move(x+40,y+30);await expect(page.locator('.rl-overlay>polyline')).toHaveCount(0);await expect(page.locator('[data-annotation]')).toHaveCount(0)
  }
  await b(page,'阅读').click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+10);await page.mouse.up();await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await other.close()
})
test('A08 A11 A12 A13 deep return, context replacement and nonfirst page recovery',async({page})=>{
  await open(page);await page.getByLabel('缩放',{exact:true}).selectOption('2');await ready(page)
  await page.locator('.rl-scroll').evaluate(el=>{el.scrollLeft=200;el.scrollTop=150});await box(page,.2,.3);await b(page,'问 AI／上下文').click();await page.getByLabel('问题草稿').fill('固定草稿')
  const origin=await page.locator('.rl-scroll').evaluate(el=>({x:el.scrollLeft,y:el.scrollTop}));await saved(page);const state=(await records(page))[0].reader
  await b(page,'固定引用：定位第 2 页').click();await ready(page,2);await expect(page.locator('pre')).toContainText('0.');await page.getByLabel('缩放',{exact:true}).selectOption('0.5');await ready(page,2)
  await b(page,'返回原位置').click();await ready(page);await expect(page.getByLabel('缩放',{exact:true})).toHaveValue('2');await expect(page.getByLabel('问题草稿')).toHaveValue('固定草稿');await expect.poll(()=>page.locator('.rl-scroll').evaluate(el=>({x:Math.round(el.scrollLeft),y:Math.round(el.scrollTop)}))).toEqual({x:Math.round(origin.x),y:Math.round(origin.y)})
  await saved(page);expect((await records(page))[0].reader.selection).toEqual(state.selection)
  await b(page,'下一页').click();await ready(page,2);await saved(page);expect((await records(page))[0].reader.context).toEqual(state.context)
  await box(page,.2,.2);await expect(page.locator('.rl-selectionbar')).toContainText('选区第 2 页');await expect(page.getByRole('alert').filter({hasText:'上下文已明确替换'})).toHaveCount(0);await saved(page);expect((await records(page))[0].reader.context.page).toBe(2);await expect(page.getByLabel('问题草稿')).toHaveValue('固定草稿')
  await page.getByText('异常引用验证夹具',{exact:true}).click();await b(page,'仅页码引用').click();await ready(page);await expect(page.getByRole('alert')).toContainText('页级定位');await expect(page.locator('.rl-indication')).toHaveCount(0);await b(page,'返回原位置').click();await ready(page,2)
  await b(page,'移除上下文').click();await expect(page.getByText('无关联选区，可选字或框选后替换上下文。')).toBeVisible();await saved(page);await page.reload();await open(page,2);await expect(page.getByLabel('问题草稿')).toHaveValue('固定草稿');await expect(page.getByLabel('缩放',{exact:true})).toHaveValue('2')
})
test('A09 A14 preview isolation and file read failure preserve stored data',async({page})=>{
  await open(page);await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('保留旧预览');await b(page,'阅读').click();await saved(page);const original=(await records(page))[0]
  await page.evaluate(async s=>{const db=await new Promise<IDBDatabase>(res=>{const r=indexedDB.open('fe-v01-reader',1);r.onsuccess=()=>res(r.result)});await new Promise<void>(res=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');store.delete(s.document.id+':'+s.document.previewVersion);const old=structuredClone(s);old.document.previewVersion='old-preview-fixture';for(const a of old.annotations)a.anchor.previewVersion='old-preview-fixture';store.put(old,s.document.id+':old-preview-fixture');tx.oncomplete=()=>res()});db.close()},original)
  await page.reload();await open(page);await expect(page.locator('[data-annotation]')).toHaveCount(0);expect((await records(page))[0].annotations[0].text).toBe('保留旧预览')
  await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('当前预览');await b(page,'阅读').click();await saved(page);expect(await records(page)).toHaveLength(2)
  await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles({name:'unsupported.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('fixture')});await expect(page.getByRole('alert')).toContainText('只打开 PDF')
  await page.evaluate(()=>{File.prototype.arrayBuffer=async()=>{throw new DOMException('验证夹具：读取拒绝','NotReadableError')}})
  await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.join(fixtures,'mixed.pdf'));await expect(page.getByRole('alert')).toContainText('NotReadableError');expect(await records(page)).toHaveLength(2)
  await page.reload();await open(page);await expect(page.getByLabel('贴条内容')).toHaveValue('当前预览')
})
