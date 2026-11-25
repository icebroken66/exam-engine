import {test,expect,type Page} from '@playwright/test'
import path from 'node:path'
const b=(p:Page,n:string)=>p.getByRole('button',{name:n,exact:true})
async function ready(p:Page){await expect(p.locator('.rl-page')).toHaveAttribute('data-ready','true');await expect.poll(()=>p.evaluate(()=>{const a=document.querySelector('.rl-page')!.getBoundingClientRect(),c=document.querySelector('.rl-page canvas')!.getBoundingClientRect();return Math.abs(a.width-c.width)+Math.abs(a.height-c.height)})).toBeLessThan(1)}
async function open(p:Page){await p.goto('/reader-workbench.html');await p.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await ready(p)}
async function fit(p:Page){await expect.poll(()=>p.evaluate(()=>{const c=document.querySelector('.rl-page')!.getBoundingClientRect(),v=document.querySelector('.rl-scroll')!.getBoundingClientRect();return c.width<=v.width&&c.height<=v.height&&c.top>=v.top-1&&c.bottom<=v.bottom+1})).toBe(true)}
test('D3 arbitrary zoom, cursor focal wheel zoom, fit, recovery and panel sizing',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await fit(page);await page.screenshot({path:info.outputPath('d3-default.png')})
  const percent=page.getByLabel('缩放百分比',{exact:true});await percent.fill('137');await percent.press('Enter');await ready(page);await expect(percent).toHaveValue('137')
  await b(page,'AI 学习助手').click();await expect(percent).toHaveValue('137');await b(page,'关闭面板').click();await expect(percent).toHaveValue('137')
  const range=page.getByLabel('连续缩放',{exact:true});await range.fill('263');await ready(page);await expect(percent).toHaveValue('263')
  await page.locator('.rl-scroll').evaluate(el=>{el.scrollLeft=200;el.scrollTop=180});const v=(await page.locator('.rl-scroll').boundingBox())!;const focal={x:v.x+v.width*.6,y:v.y+v.height*.6}
  const before=await page.locator('.rl-page').boundingBox();await page.mouse.move(focal.x,focal.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');await expect(percent).not.toHaveValue('263');await ready(page);const after=(await page.locator('.rl-page').boundingBox())!
  expect(Math.abs((focal.x-before!.x)/before!.width-(focal.x-after.x)/after.width)*after.width).toBeLessThanOrEqual(4);expect(Math.abs((focal.y-before!.y)/before!.height-(focal.y-after.y)/after.height)*after.height).toBeLessThanOrEqual(4)
  await expect(page.getByTestId('save-status')).toHaveText('已保存');const saved=await percent.inputValue();await page.reload();await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await ready(page);await expect(percent).toHaveValue(saved)
  await b(page,'适应整页').click();await ready(page);await fit(page);await b(page,'下一页').click();await ready(page);await fit(page);await b(page,'AI 学习助手').click();await ready(page);await fit(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
  await page.screenshot({path:info.outputPath('d3-assistant.png')});expect(errors).toEqual([])
})
test('D3 focus and true Fullscreen API fill space and restore view',async({page},info)=>{
  await open(page);const normal=(await page.locator('.rl-scroll').boundingBox())!;await page.getByLabel('缩放百分比').fill('137');await page.getByLabel('缩放百分比').press('Enter');await ready(page)
  await b(page,'专注阅读').click();await expect(page.locator('.wb-shell')).toHaveAttribute('data-focus','true');await ready(page);await fit(page);const focused=(await page.locator('.rl-scroll').boundingBox())!;expect(focused.height).toBeGreaterThan(normal.height+100);expect(focused.width).toBeGreaterThan(normal.width+100);await page.screenshot({path:info.outputPath('d3-focus.png')})
  await page.keyboard.press('Escape');await expect(page.locator('.wb-shell')).toHaveAttribute('data-focus','false');await ready(page);await expect(page.getByLabel('缩放百分比')).toHaveValue('137');await expect(page.getByRole('complementary',{name:'资料导航'})).toBeVisible()
  await b(page,'全屏阅读').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await ready(page);await fit(page);await page.screenshot({path:info.outputPath('d3-fullscreen.png')});await page.evaluate(()=>document.exitFullscreen());await expect(page.locator('.wb-shell')).toHaveAttribute('data-focus','false');await ready(page);await expect(page.getByLabel('缩放百分比')).toHaveValue('137')
})
