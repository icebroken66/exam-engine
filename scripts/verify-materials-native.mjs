import {chromium,expect} from '@playwright/test'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
const dir=path.resolve('data/acceptance-reader-fev06-native'),base='http://127.0.0.1:7199'
mkdirSync(dir,{recursive:true})
const pdf=readFileSync('tests/fixtures/reader/mixed.pdf'),hash=createHash('sha256').update(pdf).digest('hex'),previewVersion='pdfjs-6.5.438-normalized-v1',results=[]
async function capture(p,file){const cdp=await p.context().newCDPSession(p),m=await cdp.send('Page.getLayoutMetrics');const raw=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:m.visualViewport.clientWidth,height:m.visualViewport.clientHeight,scale:1}});writeFileSync(file,Buffer.from(raw.data,'base64'));await cdp.detach()}
const b=(p,name)=>p.getByRole('button',{name,exact:true})
for(const channel of ['msedge','chrome']){let baseline
 for(const zoom of [1,1.25]){
  const profile=mkdtempSync(path.join(os.tmpdir(),'fev06-native-'));mkdirSync(path.join(profile,'Default'))
  writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{per_host_zoom_levels:{x:{'127.0.0.1':{zoom_level:Math.log(zoom)/Math.log(1.2),last_modified:'13370000000000000'}}}}}))
  const context=await chromium.launchPersistentContext(profile,{channel,headless:true,viewport:null,args:['--window-size=1440,1000']})
  try{
   let snapshot=null,revision=0,conflict=false
   const courses=[{id:'c1',name:'数据库基础',school:'样板学校',archived_at:null,exam_date:null},{id:'c2',name:'空课程',school:'样板学校',archived_at:null,exam_date:null}]
   const source={id:'s1',original_name:'讲义.pdf',relative_path:'讲义/讲义.pdf',extension:'.pdf',size_bytes:pdf.length,status:'failed',processing_stage:'failed',processing_note:'AI 解析失败样本',processing_duration_seconds:0,material_type:'courseware',material_confidence:1,sha256:hash,origins:[]}
   await context.route('**/api/**',async r=>{const url=new URL(r.request().url()),p=url.pathname
    if(p==='/api/courses')return r.fulfill({json:courses})
    if(p==='/api/health')return r.fulfill({json:{status:'ok'}})
    if(p.endsWith('/sources'))return r.fulfill({json:p.includes('/c1/')?[source]:[]})
    if(p.endsWith('/completeness'))return r.fulfill({json:{total_sources:1,ready_sources:0,evidence_blocks:0,attention_sources:1,complete:false,issues:[]}})
    if(p.endsWith('/reading-summaries'))return r.fulfill({json:{courseId:p.split('/')[3],items:[]}})
    if(p.endsWith('/reader')){if(r.request().method()==='PUT'){snapshot=r.request().postDataJSON().snapshot;revision++}return r.fulfill({json:{courseId:'c1',courseName:'数据库基础',sourceId:'s1',sha256:hash,name:'讲义.pdf',previewVersion,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}],snapshot,revision,readOnly:false}})}
    if(p.endsWith('/file'))return r.fulfill({body:pdf,contentType:'application/pdf'})
    if(p.endsWith('/assistant')){if(r.request().method()==='PUT'){if(conflict)return r.fulfill({status:409,json:{detail:'其他窗口已更新服务端会话'}});return r.fulfill({json:{revision:1,snapshot:r.request().postDataJSON().snapshot}})}return r.fulfill({json:{revision:0,snapshot:null,readOnly:false}})}
    return r.fulfill({status:404,json:{detail:'隔离验收'}})
   })
   const page=await context.newPage(),cdp=await context.newCDPSession(page);await page.goto(base)
   const {windowId}=await cdp.send('Browser.getWindowForTarget')
   for(const [width,height] of [[1024,768],[1440,900],[1920,1080]]){
    for(let n=0;n<10;n++){const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));if(Math.abs(size.w-width)<=2&&Math.abs(size.h-height)<=2)break;const {bounds}=await cdp.send('Browser.getWindowBounds',{windowId});await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width:Math.round(bounds.width+(width-size.w)*zoom),height:Math.round(bounds.height+(height-size.h)*zoom)}});await page.waitForTimeout(100)}
    await page.goto('about:blank');await page.goto(base+'/#/courses/c1/materials');const environment=await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,scale:visualViewport.scale}));if(zoom===1)baseline=environment.dpr;expect(environment.dpr/baseline).toBeCloseTo(zoom,5);expect(environment.cssZoom).toBe('1');expect(environment.scale).toBe(1);expect(Math.abs(environment.w-width)).toBeLessThanOrEqual(2);expect(Math.abs(environment.h-height)).toBeLessThanOrEqual(2)
    const prefix=path.join(dir,channel+'-'+zoom+'-'+width)
    await expect(page.getByRole('link',{name:'阅读 讲义.pdf',exact:true})).toBeVisible();await capture(page,prefix+'-materials.png')
    await page.getByLabel('按文件名搜索',{exact:true}).fill('讲义');await page.getByRole('link',{name:'讲义.pdf',exact:true}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
    await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b(page,'添加贴条').click();await page.getByLabel('贴条内容').last().fill('原生缩放验证');await b(page,'阅读').click();await b(page,'收起贴条').last().click()
    async function measure(){await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');return page.evaluate(()=>{const note=document.querySelector('.rl-note').getBoundingClientRect(),canvas=document.querySelector('.rl-page canvas').getBoundingClientRect();return Math.max(Math.abs(note.left-canvas.left-.15*canvas.width),Math.abs(note.top-canvas.top-.15*canvas.height))})}
    let worst=await measure();await b(page,'AI 学习助手').click();worst=Math.max(worst,await measure());await page.getByLabel('统一助手草稿').fill('原生缩放下的草稿');await capture(page,prefix+'-assistant.png');await b(page,'关闭统一助手').click();await capture(page,prefix+'-reader.png');expect(worst).toBeLessThanOrEqual(4)
    await page.getByRole('link',{name:'返回课程资料',exact:true}).click();await expect(page.getByLabel('按文件名搜索',{exact:true})).toHaveValue('讲义');await page.getByRole('button',{name:/空课程/}).click();await expect(page.getByRole('button',{name:/选择多份资料/})).toBeVisible();await capture(page,prefix+'-empty.png')
    await page.getByRole('button',{name:/数据库基础/}).click();await b(page,'AI 学习助手').click();await page.getByText('会话与存储',{exact:true}).click();if(await b(page,'打开服务端助手会话').isVisible()){page.once('dialog',d=>d.accept());await b(page,'打开服务端助手会话').click()}
    await expect(page.getByLabel('服务端助手草稿')).toBeEnabled();conflict=true;await page.getByLabel('服务端助手草稿').fill('保存冲突保留草稿 '+width);await expect(page.getByRole('region',{name:'服务端统一助手'}).getByRole('alert')).toContainText('其他窗口');await expect(b(page,'导出当前助手内容')).toBeVisible();await capture(page,prefix+'-conflict.png');expect(await page.evaluate(()=>{const r=document.querySelector('.app-unified-assistant').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&r.left>=0&&r.right<=innerWidth+1&&r.width>=300})).toBe(true)
    await context.clearCookies();await page.evaluate(()=>{localStorage.clear();sessionStorage.clear()});conflict=false;snapshot=null;revision=0
    results.push({channel,version:context.browser().version(),zoom,width,height,environment,worstCssPx:worst});writeFileSync(path.join(dir,'results.json'),JSON.stringify({method:'Chromium native per-host zoom preferences in isolated profiles; actual CSS viewport; no CSS zoom or DPR emulation',results},null,2));console.log('PASS',channel,zoom,width,worst)
   }
  }finally{await context.close()}
 }
}
