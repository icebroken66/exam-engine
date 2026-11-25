import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const dir=path.resolve(process.argv[2]||'data/acceptance-reader-zoom-'+Date.now())
mkdirSync(dir,{recursive:true})
const results=[]
for(const channel of ['msedge','chrome']){
  const browser=await chromium.launch({channel,headless:false,args:['--window-size=1600,1000']})
  try{
    const context=await browser.newContext({viewport:null}),page=await context.newPage()
    await page.goto('http://127.0.0.1:7172/reader-lab.html');await page.evaluate(c=>document.title='FE-V01 Zoom Acceptance '+c,channel)
    await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
    const base=await page.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,height:innerHeight}))
    await page.getByLabel('缩放',{exact:true}).selectOption('0.5');await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true'); const refs=[{x:.1,y:.1},{x:.4,y:.3},{x:.7,y:.55}]
    for(const r of refs){const p=await page.locator('.rl-page').boundingBox();await page.getByRole('button',{name:'笔刷',exact:true}).click();await page.mouse.move(p.x+p.width*r.x,p.y+p.height*r.y);await page.mouse.down();await page.mouse.move(p.x+p.width*(r.x+.07),p.y+p.height*(r.y+.03),{steps:6});await page.mouse.up();await page.getByRole('button',{name:'框选',exact:true}).click();await page.mouse.move(p.x+p.width*r.x,p.y+p.height*r.y);await page.mouse.down();await page.mouse.move(p.x+p.width*(r.x+.05),p.y+p.height*(r.y+.03));await page.mouse.up();await page.getByRole('button',{name:'添加贴条',exact:true}).click();await page.getByLabel('贴条内容').last().fill('125%验证');await page.getByRole('button',{name:'阅读',exact:true}).click()}
    const readings=[]
    async function measure(label){await expect.poll(()=>page.evaluate(()=>{const p=document.querySelector('.rl-page').getBoundingClientRect(),c=document.querySelector('.rl-page canvas').getBoundingClientRect();return Math.abs(p.width-c.width)})).toBeLessThan(1);const r=await page.evaluate(refs=>{const c=document.querySelector('.rl-page canvas').getBoundingClientRect(),m=document.querySelector('.rl-overlay').getScreenCTM(),errors=[];document.querySelectorAll('[data-annotation] polyline').forEach((el,i)=>{for(const k of [0,el.points.numberOfItems-1]){const a=el.points.getItem(k),p=new DOMPoint(a.x,a.y).matrixTransform(m);errors.push(Math.abs(p.x-(c.left+(refs[i].x+(k===0?0:.07))*c.width)),Math.abs(p.y-(c.top+(refs[i].y+(k===0?0:.03))*c.height)))}});document.querySelectorAll('.rl-note').forEach((el,i)=>{const p=el.getBoundingClientRect();errors.push(Math.abs(p.left-c.left-refs[i].x*c.width),Math.abs(p.top-c.top-refs[i].y*c.height))});return{dpr:devicePixelRatio,width:innerWidth,height:innerHeight,worstCssPx:Math.max(...errors),points:errors.length,overflow:document.documentElement.scrollWidth>innerWidth}},refs);expect(r.points).toBe(18);expect(r.worstCssPx).toBeLessThanOrEqual(4);expect(r.overflow).toBe(false);readings.push({label,...r})}
    await measure('browser-100');await page.screenshot({path:path.join(dir,channel+'-100.png')})
    writeFileSync(path.join(dir,'waiting.json'),JSON.stringify({channel,title:await page.title(),base,action:'Native browser Ctrl+Plus twice; waiting for actual DPR ratio 1.25'}))
    console.log('WAIT_NATIVE_ZOOM '+channel)
    await expect.poll(()=>page.evaluate(d=>devicePixelRatio/d,base.dpr),{timeout:180000}).toBe(1.25)
    for(let i=0;i<10;i++)for(const z of ['0.5','1','2','fit']){await page.getByLabel('缩放',{exact:true}).selectOption(z);await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await measure('browser-125-reader-'+z)}
    await page.getByRole('button',{name:'问 AI／上下文',exact:true}).click();await measure('browser-125-panel');await page.getByRole('button',{name:'关闭面板',exact:true}).click();await page.getByLabel('缩放',{exact:true}).selectOption('2');await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.locator('.rl-scroll').evaluate(el=>{el.scrollTop=180;el.scrollLeft=200});await measure('browser-125-scroll')
    await expect(page.getByTestId('save-status')).toHaveText('已保存');await page.reload();await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await measure('browser-125-reopen');await page.screenshot({path:path.join(dir,channel+'-125.png')})
    results.push({channel,version:browser.version(),base,readings});writeFileSync(path.join(dir,'zoom-results.json'),JSON.stringify(results,null,2))
  }finally{await browser.close()}
}
