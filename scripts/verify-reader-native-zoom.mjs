import {chromium,expect} from '@playwright/test'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir=path.resolve(process.argv[2]||'data/acceptance-reader-native-zoom-'+Date.now()),base=process.env.READER_URL||'http://127.0.0.1:7189'
mkdirSync(dir,{recursive:true})
const results=[],refs=[{x:.12,y:.12},{x:.42,y:.35},{x:.7,y:.6}]
const button=(p,name)=>p.getByRole('button',{name,exact:true})
async function ready(p){await expect(p.locator('.rl-page')).toHaveAttribute('data-ready','true');await expect.poll(()=>p.evaluate(()=>{const a=document.querySelector('.rl-page').getBoundingClientRect(),c=document.querySelector('.rl-page canvas').getBoundingClientRect();return Math.abs(a.width-c.width)+Math.abs(a.height-c.height)})).toBeLessThan(1)}
async function zoom(p,workbench,z){if(workbench){if(z==='fit'||z==='page')await button(p,z==='fit'?'适应宽度':'适应整页').click();else{await p.getByLabel('缩放百分比',{exact:true}).fill(String(Number(z)*100));await p.getByLabel('缩放百分比',{exact:true}).press('Enter')}}else await p.getByLabel('缩放',{exact:true}).selectOption(z);await ready(p)}
async function mode(p,name){if(await button(p,name).getAttribute('aria-pressed')!=='true')await button(p,name).click();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
for(const channel of ['msedge','chrome']){let baselineDpr
 for(const nativeZoom of [1,1.25]){
  const profile=mkdtempSync(path.join(os.tmpdir(),'reader-native-zoom-'));mkdirSync(path.join(profile,'Default'))
  writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{per_host_zoom_levels:{x:{'127.0.0.1':{zoom_level:Math.log(nativeZoom)/Math.log(1.2),last_modified:'13370000000000000'}}}}}))
  const context=await chromium.launchPersistentContext(profile,{channel,headless:process.env.READER_NATIVE_HEADLESS==='1',viewport:null,args:['--window-size=1440,1000']})
  try{const p=await context.newPage(),cdp=await context.newCDPSession(p);await p.goto(base+'/reader-workbench.html');const {windowId}=await cdp.send('Browser.getWindowForTarget');
   for(const [width,height] of [[1024,768],[1440,900],[1920,1080]]){
    for(let i=0;i<10;i++){const s=await p.evaluate(()=>({w:innerWidth,h:innerHeight}));if(Math.abs(s.w-width)<=2&&Math.abs(s.h-height)<=2)break;const {bounds}=await cdp.send('Browser.getWindowBounds',{windowId});await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width:Math.round(bounds.width+(width-s.w)*nativeZoom),height:Math.round(bounds.height+(height-s.h)*nativeZoom)}});await p.waitForTimeout(150)}
    for(const workbench of [false,true]){
     await p.goto('about:blank');await cdp.send('Storage.clearDataForOrigin',{origin:base,storageTypes:'indexeddb'});await p.goto(base+(workbench?'/reader-workbench.html':'/reader-lab.html'));
     const environment=await p.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,height:innerHeight,cssZoom:getComputedStyle(document.documentElement).zoom,visualScale:visualViewport.scale}));if(nativeZoom===1)baselineDpr=environment.dpr;expect(environment.dpr/baselineDpr).toBeCloseTo(nativeZoom,5);expect(environment.cssZoom).toBe('1');expect(environment.visualScale).toBe(1);expect(Math.abs(environment.width-width)).toBeLessThanOrEqual(2);expect(Math.abs(environment.height-height)).toBeLessThanOrEqual(2);
     await p.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await ready(p);await zoom(p,workbench,'0.5');
     // Reusing an origin is safe: explicitly clear only this test document through the real UI.
     const old=await p.locator('.rl-note').count();if(old)throw Error('Test profile unexpectedly contains notes; use separate identities')
     for(const r of refs){await mode(p,'笔刷');let box=await p.locator('.rl-page').boundingBox();await p.mouse.move(box.x+r.x*box.width,box.y+r.y*box.height);await p.mouse.down();await p.mouse.move(box.x+(r.x+.08)*box.width,box.y+(r.y+.04)*box.height,{steps:6});await p.mouse.up();await mode(p,'框选');box=await p.locator('.rl-page').boundingBox();await p.mouse.move(box.x+r.x*box.width,box.y+r.y*box.height);await p.mouse.down();await p.mouse.move(box.x+(r.x+.05)*box.width,box.y+(r.y+.03)*box.height);await p.mouse.up();await button(p,'高亮选区').click();await button(p,'添加贴条').click();await p.getByLabel('贴条内容').last().fill('原生缩放验收');await button(p,'收起贴条').last().click();await mode(p,'阅读')}
     const readings=[];async function measure(label){await ready(p);const data=await p.evaluate(refs=>{const c=document.querySelector('.rl-page canvas').getBoundingClientRect(),m=document.querySelector('.rl-overlay').getScreenCTM(),errors=[];document.querySelectorAll('[data-annotation] polyline').forEach((el,i)=>{for(const k of [0,el.points.numberOfItems-1]){const a=el.points.getItem(k),q=new DOMPoint(a.x,a.y).matrixTransform(m);errors.push(Math.abs(q.x-c.left-(refs[i].x+(k===0?0:.08))*c.width),Math.abs(q.y-c.top-(refs[i].y+(k===0?0:.04))*c.height))}});document.querySelectorAll('[data-annotation] rect').forEach((el,i)=>{const q=el.getBoundingClientRect(),r=refs[i];errors.push(Math.abs(q.left-c.left-r.x*c.width),Math.abs(q.top-c.top-r.y*c.height),Math.abs(q.right-c.left-(r.x+.05)*c.width),Math.abs(q.bottom-c.top-(r.y+.03)*c.height))});document.querySelectorAll('.rl-note').forEach((el,i)=>{const q=el.getBoundingClientRect();errors.push(Math.abs(q.left-c.left-refs[i].x*c.width),Math.abs(q.top-c.top-refs[i].y*c.height))});return{points:errors.length,worstCssPx:Math.max(...errors),overflow:document.documentElement.scrollWidth>innerWidth,highlights:document.querySelectorAll('[data-annotation] rect').length}},refs);expect(data.points).toBe(30);expect(data.highlights).toBe(3);expect(data.worstCssPx).toBeLessThanOrEqual(4);expect(data.overflow).toBe(false);readings.push({label,...data})}
     for(let i=0;i<10;i++)for(const z of ['0.5','1','2','fit',...(workbench?['page']:[])]){await zoom(p,workbench,z);await measure('round-'+i+'-'+z)}
     await button(p,workbench?'AI 学习助手':'问 AI／上下文').click();await measure('assistant');await button(p,'关闭面板').click();await zoom(p,workbench,'2');await p.locator('.rl-scroll').evaluate(el=>{el.scrollTop=180;el.scrollLeft=200});await measure('scroll');await button(p,'下一页').click();await ready(p);await button(p,'上一页').click();await measure('return');await expect(p.getByTestId('save-status')).toHaveText('已保存');await p.reload();await p.getByLabel('打开本地 PDF',{exact:true}).setInputFiles(path.resolve('tests/fixtures/reader/mixed.pdf'));await measure('reopen');await zoom(p,workbench,'fit');await p.screenshot({path:path.join(dir,channel+'-'+nativeZoom+'-'+width+'-'+(workbench?'workbench':'lab')+'.png')});
     results.push({channel,version:context.browser().version(),nativeZoom,target:{width,height},environment,workbench,readings});writeFileSync(path.join(dir,'results.json'),JSON.stringify({method:'Chromium native per-host browser zoom in isolated temporary user profiles; no DPR/CSS/page-scale emulation',results},null,2));console.log('PASS',channel,nativeZoom,width,workbench?'workbench':'lab');

    }
   }
  }finally{await context.close()}
 }
}










