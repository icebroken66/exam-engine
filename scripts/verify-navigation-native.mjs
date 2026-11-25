import {chromium,expect} from '@playwright/test'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
const dir=path.resolve('data/acceptance-fev07/native'),base='http://127.0.0.1:7194';mkdirSync(dir,{recursive:true})
const bytes=readFileSync('tests/fixtures/reader/mixed.pdf'),sha256=createHash('sha256').update(bytes).digest('hex'),previewVersion='pdfjs-6.5.438-normalized-v1',results=[]
const b=(p,name)=>p.getByRole('button',{name,exact:true})
async function capture(p,file){const c=await p.context().newCDPSession(p),m=await c.send('Page.getLayoutMetrics'),r=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:m.visualViewport.clientWidth,height:m.visualViewport.clientHeight,scale:1}});writeFileSync(file,Buffer.from(r.data,'base64'));await c.detach()}
for(const channel of ['msedge','chrome']){let baseline
 for(const browserZoom of [1,1.25]){
  const profile=mkdtempSync(path.join(os.tmpdir(),'fev07-native-'));mkdirSync(path.join(profile,'Default'));writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{per_host_zoom_levels:{x:{'127.0.0.1':{zoom_level:Math.log(browserZoom)/Math.log(1.2),last_modified:'13370000000000000'}}}}}))
  const context=await chromium.launchPersistentContext(profile,{channel,headless:true,viewport:null,args:['--window-size=1440,1000']})
  try{
   let snapshot=null,revision=0
   const course={id:'c1',name:'课程总览与整笔擦除',school:'公开夹具',archived_at:null,exam_date:null},source={id:'s1',course_id:'c1',original_name:'mixed.pdf',relative_path:'讲义/mixed.pdf',extension:'.pdf',sha256,size_bytes:bytes.length,status:'failed',processing_stage:'failed',processing_note:'AI解析失败，原件可阅读',material_type:'courseware',material_confidence:1,origins:[]}
   await context.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname
    if(p==='/api/courses')return route.fulfill({json:[course,{...course,id:'c2',name:'空课程'}]})
    if(p==='/api/health')return route.fulfill({json:{status:'ok'}})
    if(p.endsWith('/sources'))return route.fulfill({json:p.includes('/c1/')?[source]:[]})
    if(p.endsWith('/completeness'))return route.fulfill({json:{total_sources:1,ready_sources:0,attention_sources:1,evidence_blocks:0,issues:[],complete:false}})
    if(p.endsWith('/reading-summaries'))return route.fulfill({json:{courseId:p.split('/')[3],items:[]}})
    if(p.endsWith('/learning-sessions/current'))return route.fulfill({json:null})
    if(p.endsWith('/reader')){if(route.request().method()==='PUT'){snapshot=route.request().postDataJSON().snapshot;revision++}return route.fulfill({json:{courseId:'c1',sourceId:'s1',courseName:course.name,name:source.original_name,sha256,previewVersion,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}],readOnly:false,snapshot,revision}})}
    if(p.endsWith('/file'))return route.fulfill({body:bytes,contentType:'application/pdf'})
    return route.fulfill({status:404,json:{detail:'隔离测试'}})
   })
   const page=await context.newPage(),cdp=await context.newCDPSession(page);await page.goto(base);const{windowId}=await cdp.send('Browser.getWindowForTarget')
   for(const [width,height]of [[1024,768],[1440,900],[1920,1080]]){
    for(let i=0;i<10;i++){const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));if(Math.abs(size.w-width)<=2&&Math.abs(size.h-height)<=2)break;const{bounds}=await cdp.send('Browser.getWindowBounds',{windowId});await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width:Math.round(bounds.width+(width-size.w)*browserZoom),height:Math.round(bounds.height+(height-size.h)*browserZoom)}});await page.waitForTimeout(100)}
    await page.goto('about:blank');await page.goto(base+'/#/courses/c1/overview');await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();const environment=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,scale:visualViewport.scale}));if(browserZoom===1)baseline=environment.dpr;expect(environment.dpr/baseline).toBeCloseTo(browserZoom,5);expect(environment.cssZoom).toBe('1');expect(environment.scale).toBe(1);expect(Math.abs(environment.width-width)).toBeLessThanOrEqual(2);expect(Math.abs(environment.height-height)).toBeLessThanOrEqual(2)
    const prefix=path.join(dir,channel+'-'+browserZoom+'-'+width);await capture(page,prefix+'-overview.png');await page.getByRole('treegrid').getByRole('row',{name:'mixed.pdf 讲义/mixed.pdf',exact:true}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('对齐参考');await b(page,'收起贴条').click();await b(page,'阅读').click()
    await b(page,'笔刷').click();let box=await page.locator('.rl-page').boundingBox();await page.mouse.move(box.x+.2*box.width,box.y+.6*box.height);await page.mouse.down();await page.mouse.move(box.x+.35*box.width,box.y+.6*box.height,{steps:3});await page.mouse.up();await b(page,'阅读').click();await capture(page,prefix+'-reader.png')
    const readings=[]
    for(const value of ['50','100','200','fit']){
     if(value==='fit')await b(page,'适应宽度').click();else{await page.getByLabel('缩放百分比',{exact:true}).fill(value);await page.getByLabel('缩放百分比',{exact:true}).press('Enter')}
     await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.locator('.rl-scroll').evaluate(el=>{el.scrollTop=0;el.scrollLeft=0})
     const error=await page.evaluate(()=>{const c=document.querySelector('.rl-page canvas').getBoundingClientRect(),note=document.querySelector('.rl-note').getBoundingClientRect();return Math.max(Math.abs(note.left-c.left-.15*c.width),Math.abs(note.top-c.top-.15*c.height))});expect(error).toBeLessThanOrEqual(4)
     console.log('ZOOM',channel,browserZoom,width,value);if(await b(page,'整笔橡皮擦').getAttribute('aria-pressed')!=='true')await b(page,'整笔橡皮擦').click();await page.locator('.rl-scroll').evaluate(el=>{const box=el.querySelector('.rl-page').getBoundingClientRect(),view=el.getBoundingClientRect();el.scrollLeft+=box.x+.275*box.width-view.x-view.width/2;el.scrollTop+=box.y+.6*box.height-view.y-view.height/2});box=await page.locator('.rl-page').boundingBox();await page.mouse.move(box.x+.15*box.width,box.y+.6*box.height);await page.mouse.down();await page.mouse.move(box.x+.4*box.width,box.y+.6*box.height);await page.mouse.up();await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await b(page,'撤销').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);readings.push({readerZoom:value,errorCssPx:error})
    }
    await b(page,'阅读').click();await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b(page,'AI 学习助手').click();await page.getByLabel('统一助手草稿').fill('独立助手草稿');if(width<1250)await expect(page.locator('.sidebar')).toBeHidden();else await expect(page.locator('.sidebar')).toBeVisible();expect(await page.evaluate(()=>{const center=document.querySelector('.main-canvas').getBoundingClientRect(),side=document.querySelector('.app-unified-assistant').getBoundingClientRect();return center.width>=650&&center.right<=side.left+1&&side.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth})).toBe(true);await capture(page,prefix+'-both-panels.png');await b(page,'关闭统一助手').click();await expect(page.locator('.sidebar')).toBeVisible();await b(page,'收起课程导航').click();await expect(page.locator('.sidebar')).toBeHidden();await capture(page,prefix+'-collapsed.png');await b(page,'展开课程导航').click();await expect(page.getByTestId('save-status')).toHaveText('已保存')
    await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});snapshot=null;revision=0;results.push({channel,version:context.browser().version(),browserZoom,width,height,environment,readings});writeFileSync(path.join(dir,'results.json'),JSON.stringify({method:'Native Chromium profile per-host browser zoom, CSS viewport measured; no CSS zoom or emulated DPR',results},null,2));console.log('PASS',channel,browserZoom,width)
   }
  }finally{await context.close()}
 }
}
