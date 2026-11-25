/** Actual installed Chromium browser zoom, with isolated public no-model fixtures. */
import {chromium,expect} from '@playwright/test'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
const base=process.env.READER_URL||'http://127.0.0.1:7198',dir=path.resolve('data/acceptance-fev08/native-'+Date.now());mkdirSync(dir,{recursive:true})
const bytes=readFileSync('tests/fixtures/reader/mixed.pdf'),hash=createHash('sha256').update(bytes).digest('hex'),version='pdfjs-6.5.438-normalized-v1',results=[],b=(p,n)=>p.getByRole('button',{name:n,exact:true})
async function screenshot(p,name){const c=await p.context().newCDPSession(p),m=await c.send('Page.getLayoutMetrics'),r=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:m.visualViewport.clientWidth,height:m.visualViewport.clientHeight,scale:1}});writeFileSync(path.join(dir,name),Buffer.from(r.data,'base64'));await c.detach()}
for(const channel of ['msedge','chrome']){let baseline
 for(const zoom of [1,1.25]){
  const profile=mkdtempSync(path.join(os.tmpdir(),'fev08-native-'));mkdirSync(path.join(profile,'Default'));writeFileSync(path.join(profile,'Default/Preferences'),JSON.stringify({partition:{per_host_zoom_levels:{x:{'127.0.0.1':{zoom_level:Math.log(zoom)/Math.log(1.2),last_modified:'13370000000000000'}}}}}))
  const context=await chromium.launchPersistentContext(profile,{channel,headless:true,viewport:null,args:['--window-size=1440,1000']})
  let topic={schema_version:2,id:'t1',course_id:'c1',title:'原生缩放主题',mode:'independent',item_ids:[],revision:1,context_revision:0,text:'公开中文问题',bindings:[],binding_count:0,read_only:false},snapshot=null,readerRevision=0
  try{
   await context.addInitScript(()=>{localStorage.setItem('assistant-workspace-v2:c1','enabled');localStorage.setItem('exam-engine:workspace-focus:v2:c1','t1')})
   await context.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname
    if(p==='/api/courses')return route.fulfill({json:[{id:'c1',name:'原生缩放公开课',school:'公开学校',archived_at:null,exam_date:null}]})
    if(p==='/api/health')return route.fulfill({json:{status:'ok'}})
    if(p.endsWith('/sources'))return route.fulfill({json:[{id:'s1',course_id:'c1',original_name:'公开课件.pdf',extension:'.pdf',status:'ready',sha256:hash,size_bytes:bytes.length,origins:[]}]})
    if(p.endsWith('/reading-summaries'))return route.fulfill({json:{items:[]}})
    if(p.endsWith('/learning-sessions/current'))return route.fulfill({json:null})
    if(p.endsWith('/file'))return route.fulfill({body:bytes,contentType:'application/pdf'})
    if(p.endsWith('/reader')){if(req.method()==='PUT'){snapshot=req.postDataJSON().snapshot;readerRevision++}return route.fulfill({json:{courseId:'c1',courseName:'公开课',sourceId:'s1',name:'公开课件.pdf',sha256:hash,previewVersion:version,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}],readOnly:false,revision:readerRevision,snapshot}})}
    if(p.endsWith('/v2/items'))return route.fulfill({json:{items:[],next_offset:null,read_only:false}})
    if(p.endsWith('/v2/topics'))return route.fulfill({json:{items:[topic],next_offset:null,read_only:false}})
    if(p.endsWith('/topics/t1'))return route.fulfill({json:topic})
    if(p.endsWith('/bindings')){const data=req.postDataJSON();topic={...topic,revision:topic.revision+1,context_revision:topic.context_revision+1,bindings:[{...data.binding,id:'b1',title:'公开课件.pdf',confirmed:true,provenance:'user_excerpt_unverified'}]};return route.fulfill({json:topic})}
    if(p.endsWith('/manifest'))return route.fulfill({json:{status:'ready_model_disabled',course:{id:'c1',name:'公开课'},topic,question:'公开问题',included:topic.bindings,excluded:[],groups:[],trace:{included:['explicit'],excluded:['other_topics','teacher_private_fields']},model_called:false,can_send:false,limitations:[],candidates:[]}})
    return route.fulfill({status:404,json:{detail:'公开夹具范围外'}})
   })
   const p=await context.newPage(),cdp=await context.newCDPSession(p);await p.goto(base+'/#/courses/c1/overview');const {windowId}=await cdp.send('Browser.getWindowForTarget')
   for(const [width,height] of [[1024,768],[1440,900],[1920,1080]]){
    for(let n=0;n<10;n++){const s=await p.evaluate(()=>({w:innerWidth,h:innerHeight}));if(Math.abs(s.w-width)<=2&&Math.abs(s.h-height)<=2)break;const {bounds}=await cdp.send('Browser.getWindowBounds',{windowId});await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width:Math.round(bounds.width+(width-s.w)*zoom),height:Math.round(bounds.height+(height-s.h)*zoom)}});await p.waitForTimeout(120)}
    await p.goto(base+'/#/courses/c1/reader?source=s1');await expect(p.locator('.rl-page')).toHaveAttribute('data-ready','true');if(!await p.getByLabel('任务主题与上下文').isVisible())await b(p,'AI 学习助手').click();const environment=await p.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,visualScale:visualViewport.scale}));if(zoom===1)baseline=environment.dpr;expect(environment.dpr/baseline).toBeCloseTo(zoom,5);expect(environment.cssZoom).toBe('1');expect(environment.visualScale).toBe(1);expect(Math.abs(environment.width-width)).toBeLessThanOrEqual(2);expect(Math.abs(environment.height-height)).toBeLessThanOrEqual(2)
    await p.getByLabel('缩放百分比',{exact:true}).fill('50');await p.getByLabel('缩放百分比',{exact:true}).press('Enter');if(!await b(p,'从资料框选').isVisible())await p.getByText('添加上下文／从工作区选择',{exact:true}).click();await b(p,'从资料框选').click();await expect(p.getByText('临时上下文取材',{exact:true})).toBeVisible();const box=await p.locator('.rl-page').boundingBox(),start={x:box.x+.2*box.width,y:box.y+.2*box.height},end={x:box.x+.4*box.width,y:box.y+.3*box.height};await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y,{steps:4});await p.mouse.up();const actual=await p.locator('.rl-selection').first().boundingBox();expect(actual).not.toBeNull();const error=Math.max(Math.abs(actual.x-start.x),Math.abs(actual.y-start.y),Math.abs(actual.width-(end.x-start.x)),Math.abs(actual.height-(end.y-start.y)));expect(error).toBeLessThanOrEqual(4)
    await b(p,'预览本次取材').click();await expect(p.getByLabel('待确认上下文')).toBeVisible();await screenshot(p,channel+'-'+zoom+'-'+width+'-preview.png');await b(p,'取消本次预览').click();await expect(p.getByText('临时上下文取材',{exact:true})).toHaveCount(0);await expect(p.locator('[data-annotation]')).toHaveCount(0);await b(p,'从资料框选').click();await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y);await p.mouse.up();await b(p,'预览本次取材').click();if(topic.bindings.length){await p.getByLabel('上下文新增或替换').selectOption('b1')};await b(p,'确认绑定上下文').click();await b(p,'检查本次上下文').click();await expect(p.getByLabel('本次上下文检查结果')).toContainText('纳入 1');await screenshot(p,channel+'-'+zoom+'-'+width+'-manifest.png');await b(p,'关闭上下文准备').click();await b(p,'AI 学习助手').click();await expect(p.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('公开中文问题');expect(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false)
    results.push({channel,version:context.browser().version(),zoom,environment,errorCssPx:error,captureCancelConfirm:true,assistantToggle:true});writeFileSync(path.join(dir,'results.json'),JSON.stringify({method:'Native Chromium per-host zoom; isolated browser profiles, no CSS zoom or DPR emulation',results},null,2));console.log('PASS',channel,zoom,width)
   }
  }finally{await context.close()}
 }
}
console.log(JSON.stringify({status:'passed',dir,groups:results.length}))
