import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const bytes=readFileSync('tests/fixtures/reader/mixed.pdf'),digest=createHash('sha256').update(bytes).digest('hex'),previewVersion='pdfjs-6.5.438-normalized-v1'
const b=(p:Page,name:string)=>p.getByRole('button',{name,exact:true})
const ready=(p:Page)=>expect(p.locator('.rl-page')).toHaveAttribute('data-ready','true')
async function fixture(page:Page){
 let snapshot:any=null,revision=0,fail=false,conflict=false,puts=0
 const courses=[{id:'c1',name:'课程一',school:'测试学校',archived_at:null,exam_date:null},{id:'c2',name:'课程二',school:'测试学校',archived_at:null,exam_date:null}]
 const sources=[{id:'s1',original_name:'相同课件.pdf',relative_path:'目录一/相同课件.pdf',course_id:'c1',extension:'.pdf',size_bytes:bytes.length,sha256:digest,status:'failed',processing_stage:'failed',processing_note:'解析失败不影响原件',material_type:'courseware',material_confidence:1,origins:[]},{id:'s2',original_name:'相同课件.pdf',relative_path:'目录二/相同课件.pdf',course_id:'c1',extension:'.pdf',size_bytes:bytes.length,sha256:digest,status:'queued',processing_stage:'queued',processing_note:'',material_type:'courseware',material_confidence:1,origins:[]}]
 const requests:string[]=[]
 await page.context().route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;requests.push(route.request().method()+' '+path)
  if(path==='/api/courses')return route.fulfill({json:courses})
  if(path==='/api/health')return route.fulfill({json:{status:'ok'}})
  if(path.endsWith('/sources'))return route.fulfill({json:path.includes('/c1/')?sources:[]})
  if(path.endsWith('/completeness'))return route.fulfill({json:{total_sources:2,ready_sources:0,attention_sources:2,evidence_blocks:0,complete:false,issues:[]}})
  if(path.endsWith('/reading-summaries'))return route.fulfill({json:{courseId:path.split('/')[3],items:[]}})
  if(path.endsWith('/learning-sessions/current'))return route.fulfill({json:null})
  if(path.endsWith('/reader')){if(route.request().method()==='PUT'){puts++;if(fail)return route.abort('failed');if(conflict)return route.fulfill({status:409,json:{detail:'其他窗口已更新笔记'}});snapshot=route.request().postDataJSON().snapshot;revision++}return route.fulfill({json:{courseId:'c1',courseName:'课程一',sourceId:path.split('/')[5],sha256:digest,name:'相同课件.pdf',previewVersion,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}],readOnly:false,revision,snapshot}})}
  if(path.endsWith('/file'))return route.fulfill({body:bytes,contentType:'application/pdf'})
  return route.fulfill({status:404,json:{detail:'隔离样板'}})
 })
 return{requests,fail:(v:boolean)=>fail=v,conflict:()=>conflict=true,puts:()=>puts,snapshot:()=>snapshot}
}
async function line(page:Page,points:number[][]){await b(page,'笔刷').click();const box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x+points[0][0]*box.width,box.y+points[0][1]*box.height);await page.mouse.down();for(const [x,y]of points.slice(1))await page.mouse.move(box.x+x*box.width,box.y+y*box.height,{steps:3});await page.mouse.up();await b(page,'阅读').click()}
async function erase(page:Page,from:number[],to=from,release=true){if(await b(page,'整笔橡皮擦').getAttribute('aria-pressed')!=='true')await b(page,'整笔橡皮擦').click();const box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x+from[0]*box.width,box.y+from[1]*box.height);await page.mouse.down();await page.mouse.move(box.x+to[0]*box.width,box.y+to[1]*box.height);if(release)await page.mouse.up()}
test('FE-V07 course tree overview central reader panels and protected navigation',async({page},info)=>{
 const f=await fixture(page);await page.goto('/#/courses/c1');await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'开始练习',exact:true})).toBeVisible()
 expect(f.requests.some(r=>r.startsWith('POST')||r.includes('/file')||r.endsWith('/reader'))).toBe(false);expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/ReaderLab|pdf.worker/.test(r.name)))).toBe(false)
 const tree=page.getByRole('treegrid',{name:'课程与资料'});await expect(tree.getByRole('row').filter({hasText:'相同课件.pdf'})).toHaveCount(2)
 await b(page,'收起 课程一').click();await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();await b(page,'展开 课程一').click();await tree.getByRole('row').filter({hasText:'相同课件.pdf'}).first().click();await ready(page);expect(page.url()).toContain('/reader?source=s1');await expect(tree.locator('[aria-selected=true]')).toContainText('相同课件.pdf')
 await page.screenshot({path:info.outputPath('central-reader.png')});await b(page,'AI 学习助手').click();await page.getByLabel('统一助手草稿').fill('跨中央页面保留');if((page.viewportSize()?.width||0)>=1250)await expect(page.locator('.sidebar')).toBeVisible();else await expect(page.locator('.sidebar')).toBeHidden();await b(page,'关闭统一助手').click();await expect(page.locator('.sidebar')).toBeVisible()
 f.fail(true);await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('失败仍保留');await b(page,'阅读').click();await expect(page.getByTestId('save-status')).toHaveText('保存失败');await tree.getByRole('row').filter({hasText:'课程二'}).click();await expect(page.locator('.rl-page')).toHaveCount(1);expect(page.url()).toContain('/c1/reader');await expect(page.getByRole('alert')).toContainText('尚未保存');f.fail(false);await b(page,'重试保存').click();await expect(page.getByTestId('save-status')).toHaveText('已保存');await tree.getByRole('row').filter({hasText:'课程二'}).click();await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();expect(page.url()).toContain('/c2/overview')
})
test('FE-V07 whole stroke gesture transaction cancel undo redo and server recovery',async({page},info)=>{
 const f=await fixture(page);await page.goto('/#/courses/c1/reader?source=s1');await ready(page);await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await ready(page)
 await line(page,[[.2,.2],[.2,.8]]);await line(page,[[.5,.2],[.5,.8]]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(2);await expect(page.getByTestId('save-status')).toHaveText('已保存');const before=f.puts()
 await erase(page,[.1,.5],[.7,.5],false);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);expect(f.puts()).toBe(before);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('[data-annotation] polyline')).toHaveCount(2)
 await erase(page,[.1,.5],[.7,.5]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await b(page,'撤销').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(2);await b(page,'重做').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await expect(page.getByTestId('save-status')).toHaveText('已保存');expect(f.snapshot().annotations).toHaveLength(0)
 await page.reload();await ready(page);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await page.screenshot({path:info.outputPath('eraser-saved.png')})
})
test('FE-V07 eraser excludes empty bounding box highlight note and hidden annotations',async({page})=>{
 await fixture(page);await page.goto('/reader-workbench.html');await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles('tests/fixtures/reader/mixed.pdf');await ready(page);await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await ready(page)
 await line(page,[[.1,.1],[.1,.8],[.8,.8]]);await erase(page,[.5,.5]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await b(page,'阅读').click();await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('不可擦除贴条');await b(page,'收起贴条').click();await b(page,'阅读').click();await b(page,'框选').click();let box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x+.6*box.width,box.y+.3*box.height);await page.mouse.down();await page.mouse.move(box.x+.7*box.width,box.y+.4*box.height);await page.mouse.up();await b(page,'高亮选区').click();await erase(page,[.05,.35],[.9,.35]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await expect(page.locator('[data-annotation] rect')).toHaveCount(1);await expect(page.locator('.rl-note')).toHaveCount(1)
 await b(page,'隐藏批注').click();await expect(b(page,'整笔橡皮擦')).toBeDisabled();await b(page,'显示批注').click();await expect(page.getByTestId('save-status')).toHaveText('已保存');await page.reload();await page.getByLabel('打开本地 PDF',{exact:true}).setInputFiles('tests/fixtures/reader/mixed.pdf');await ready(page);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await expect(page.locator('[data-annotation] rect')).toHaveCount(1)
})

test('FE-V07 eraser cancel paths overlapping strokes empty history and multiple zooms',async({page})=>{
 const f=await fixture(page);await page.goto('/#/courses/c1/reader?source=s1');await ready(page)
 await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await ready(page)
 for(const width of ['2','8']){await b(page,'笔刷').click();await page.getByLabel('笔宽',{exact:true}).selectOption(width);await b(page,'阅读').click();await line(page,[[.2,.2],[.3,.25],[.2,.3]])}
 await line(page,[[.65,.6],[.8,.6]]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(3);await expect(page.getByTestId('save-status')).toHaveText('已保存')
 for(const why of ['pointercancel','lostpointercapture','blur','leave','page','tool']){
  await erase(page,[.2,.25],[.3,.25],false);await expect(page.locator('[data-annotation] polyline')).toHaveCount(1)
  if(why==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')))
  else if(why==='leave'){const box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x-2,box.y+10)}
  else if(why==='page'){await page.keyboard.press('Control+PageDown');await ready(page);await page.keyboard.press('Control+PageUp');await ready(page)}
  else if(why==='tool')await page.keyboard.press('Escape')
  else await page.locator('.rl-overlay').dispatchEvent(why)
  await page.mouse.up();await expect(page.locator('[data-annotation] polyline')).toHaveCount(3)
 }
 for(const value of ['50','100','200']){
  await b(page,'阅读').click();await page.getByLabel('缩放百分比',{exact:true}).fill(value);await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await ready(page)
  await page.locator('.rl-scroll').evaluate(el=>{el.scrollLeft=0;el.scrollTop=0});await erase(page,[.2,.25],[.3,.25]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await b(page,'撤销').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(3)
 }
 await b(page,'适应宽度').click();await ready(page);await erase(page,[.2,.25],[.3,.25]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await b(page,'撤销').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(3)
 await b(page,'阅读').click();await expect(page.getByTestId('save-status')).toHaveText('已保存');let count=f.puts();await erase(page,[.9,.1]);await expect(page.getByTestId('save-status')).toHaveText('已保存');expect(f.puts()).toBe(count)
 f.conflict();await erase(page,[.2,.25],[.3,.25]);await expect(page.getByTestId('save-status')).toHaveText('保存失败');await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await expect(page.getByRole('alert')).toContainText('其他窗口');await expect(b(page,'导出验证 JSON')).toBeVisible()
})

test('FE-V07 tree keyboard focus expansion course selection and panel preference',async({page})=>{
 await fixture(page);await page.addInitScript(()=>{if(!sessionStorage.getItem('bad-preference-seeded')){localStorage.setItem('exam-engine:panels:v1','{bad');sessionStorage.setItem('bad-preference-seeded','1')}});await page.goto('/#/courses/c1/overview');const tree=page.getByRole('treegrid',{name:'课程与资料'}),row=tree.getByRole('row',{name:'课程一',exact:true});await row.focus();await page.keyboard.press('ArrowLeft');await expect(row).toHaveAttribute('aria-expanded','false');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await ready(page);expect(page.url()).toContain('source=s1');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await b(page,'AI 学习助手').click();await b(page,'关闭统一助手').click();await b(page,'收起课程导航').click();await expect(b(page,'展开课程导航')).toBeVisible();await page.reload();await ready(page);await expect(page.locator('.sidebar')).toBeHidden();await b(page,'展开课程导航').click();await expect(page.locator('.sidebar')).toBeVisible()
})

test('FE-V07 late tree response stays scoped and unsupported files keep a download path',async({page})=>{
 await fixture(page)
 let release:(()=>void)|undefined
 await page.route('**/api/courses/c2/sources',async route=>{await new Promise<void>(resolve=>release=resolve);await route.fulfill({json:[{id:'s9',original_name:'仅课程二.pptx',extension:'.pptx',relative_path:'目录/仅课程二.pptx',origins:[],status:'ready'}]})})
 await page.goto('/#/courses/c1/overview');await b(page,'展开 课程二').click();await expect.poll(()=>Boolean(release)).toBe(true);await b(page,'收起 课程二').click();release!();await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();expect(page.url()).toContain('/c1/overview');await b(page,'展开 课程二').click();const row=page.getByRole('row',{name:'仅课程二.pptx 目录/仅课程二.pptx',exact:true});await expect(row).toBeVisible();await row.click();await expect(page.getByRole('status').filter({hasText:'当前格式不支持工作台阅读'})).toBeVisible();await expect(page.getByRole('link',{name:'下载原件',exact:true})).toHaveAttribute('href','/api/sources/s9/file');expect(page.url()).toContain('/c2/materials');await expect(page.locator('.rl-page')).toHaveCount(0)
})

test('FE-V07 overview actual active session local failure and no fabricated continue',async({page})=>{
 const f=await fixture(page)
 await page.route('**/api/courses/c1/learning-sessions/current',r=>r.fulfill({json:{id:'saved-round',course_id:'c1',stage:'practicing'}}))
 await page.route('**/api/courses/c1/reading-summaries',r=>r.fulfill({status:503}))
 await page.goto('/#/courses/c1/overview');await expect(page.getByRole('link',{name:'继续练习',exact:true})).toHaveAttribute('href','#/courses/c1/learn?session=saved-round');await expect(page.getByRole('link',{name:'继续阅读',exact:true})).toHaveCount(0);await expect(page.getByRole('status').filter({hasText:'继续阅读暂时无法读取'})).toBeVisible();await expect(page.getByRole('link',{name:'题目校准／管理'})).toBeVisible();expect(f.requests.filter(r=>!r.startsWith('GET'))).toEqual([])
})

test('FE-V07 browser hash navigation commits focused note and blocks before unmount',async({page})=>{
 const f=await fixture(page);await page.goto('/#/courses/c1/reader?source=s1');await ready(page);await b(page,'添加贴条').click();await page.getByLabel('贴条内容').fill('焦点内尚未失焦的笔记');f.fail(true);await page.evaluate(()=>location.hash='/courses/c2/overview');await expect(page.getByTestId('save-status')).toHaveText('保存失败');await expect(page.getByLabel('贴条内容')).toHaveValue('焦点内尚未失焦的笔记');expect(page.url()).toContain('/c1/reader?source=s1');f.fail(false);await b(page,'重试保存').click();await expect(page.getByTestId('save-status')).toHaveText('已保存');expect(f.snapshot().annotations[0].text).toBe('焦点内尚未失焦的笔记')
})

test('FE-V07 expanded tree retry large list final file reachable and no original prefetch',async({page})=>{
 const f=await fixture(page);let failed=true
 await page.route('**/api/courses/c2/sources',route=>failed?route.fulfill({status:503}):route.fulfill({json:Array.from({length:85},(_,n)=>({id:'large-'+n,original_name:'课程二文件'+n+'.pdf',relative_path:'目录/'+n+'.pdf',extension:'.pdf',status:'ready',origins:[]}))}))
 await page.goto('/#/courses/c1/overview');await b(page,'展开 课程二').click();const retry=page.getByRole('row',{name:'资料读取失败，按 Enter 重试',exact:true});await expect(retry).toBeVisible();failed=false;await retry.click();const last=page.getByRole('row',{name:'课程二文件84.pdf 目录/84.pdf',exact:true});await last.scrollIntoViewIfNeeded();await expect(last).toBeVisible();expect(f.requests.some(r=>r.includes('/file')||r.endsWith('/reader'))).toBe(false);expect(page.url()).toContain('/c1/overview')
})

test('FE-V07 actual window blur and middle pan cancel uncommitted erasure',async({page,context})=>{
 test.skip(!process.env.READER_HEADED,'Real focus exercised in headed run')
 await fixture(page);await page.goto('/#/courses/c1/reader?source=s1');await ready(page);await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await line(page,[[.2,.2],[.4,.2]])
 const other=await context.newPage();await other.goto('about:blank');for(const target of [page,other]){const cdp=await context.newCDPSession(target);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false})}await page.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true)
 await erase(page,[.2,.2],[.4,.2],false);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(false);await page.bringToFront();await page.mouse.up();await expect(page.locator('[data-annotation] polyline')).toHaveCount(1)
 const box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x+.25*box.width,box.y+.2*box.height);await page.mouse.down({button:'middle'});await page.mouse.move(box.x+.3*box.width,box.y+.2*box.height);await page.mouse.up({button:'middle'});await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await other.close()
})

test('FE-V07 eraser on portrait second page leaves first page ink intact',async({page})=>{
 await fixture(page);await page.goto('/#/courses/c1/reader?source=s1');await ready(page);await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await line(page,[[.2,.2],[.4,.2]]);await b(page,'下一页').click();await ready(page);await line(page,[[.5,.5],[.7,.5]]);await erase(page,[.45,.5],[.75,.5]);await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await b(page,'上一页').click();await ready(page);await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await b(page,'阅读').click();await expect(page.getByTestId('save-status')).toHaveText('已保存')
})
