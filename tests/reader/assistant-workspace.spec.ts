import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const bytes=readFileSync('tests/fixtures/reader/mixed.pdf'),hash=createHash('sha256').update(bytes).digest('hex'),version='pdfjs-6.5.438-normalized-v1'
const b=(p:Page,n:string)=>p.getByRole('button',{name:n,exact:true})
async function fixture(page:Page){
 const topics:any[]=[{schema_version:2,id:'t1',course_id:'c1',title:'互斥主题',mode:'independent',item_ids:[],revision:1,context_revision:0,text:'',bindings:[],binding_count:0,read_only:false},{schema_version:2,id:'t2',course_id:'c1',title:'分页主题',mode:'independent',item_ids:[],revision:1,context_revision:0,text:'第二主题草稿',bindings:[],binding_count:0,read_only:false}],requests:string[]=[],receipts=new Map<string,unknown>();let failed=false,conflict=false,delayRead:Promise<void>|null=null,release:(()=>void)|undefined
 const source={id:'s1',course_id:'c1',original_name:'公开课件.pdf',relative_path:'公开/课件.pdf',extension:'.pdf',sha256:hash,size_bytes:bytes.length,status:'ready',material_type:'courseware',origins:[]}
 await page.addInitScript(()=>{localStorage.setItem('assistant-workspace-v2:c1','enabled');localStorage.setItem('assistant-workspace-v2:c2','enabled')})
 await page.context().route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;requests.push(req.method()+' '+path)
  if(path==='/api/courses')return route.fulfill({json:[{id:'c1',name:'课程一',school:'公开学校',archived_at:null,exam_date:null},{id:'c2',name:'课程二',school:'公开学校',archived_at:null,exam_date:null}]})
  if(path==='/api/health')return route.fulfill({json:{status:'ok'}})
  if(path.endsWith('/sources'))return route.fulfill({json:path.includes('/c1/')?[source]:[]})
  if(path.endsWith('/reading-summaries'))return route.fulfill({json:{items:[]}})
  if(path.endsWith('/learning-sessions/current'))return route.fulfill({json:null})
  if(path.endsWith('/reader'))return route.fulfill({json:{courseId:'c1',courseName:'课程一',sourceId:'s1',sha256:hash,name:source.original_name,previewVersion:version,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}],readOnly:false,revision:0,snapshot:null}})
  if(path.endsWith('/file'))return route.fulfill({body:bytes,contentType:'application/pdf'})
  if(path.includes('/assistant/v2/')){
   const course=path.split('/')[3],tail=path.split('/assistant/v2')[1]
   if(tail==='/items')return route.fulfill({json:{schema_version:2,items:[],next_offset:null,read_only:false}})
   if(tail==='/topics'&&req.method()==='GET')return route.fulfill({json:{schema_version:2,items:topics.filter(t=>t.course_id===course).map(t=>({...t,text:undefined,bindings:undefined})),next_offset:null,read_only:false}})
   if(tail==='/legacy')return route.fulfill({json:{supported:true,source_fingerprint:'a'.repeat(64),snapshot:{schema:1,draft:'旧历史文字',context:{text:'不自动授权'},entries:[]},context_authorized:false}})
   const t=topics.find(t=>t.id===tail.split('/')[2]&&t.course_id===course)
   if(t&&req.method()==='GET'){if(delayRead&&t.id==='t1')await delayRead;return route.fulfill({json:t})}
   const data=req.postDataJSON()
   if(failed)return route.abort('failed')
   if(data.command_id&&receipts.has(data.command_id))return route.fulfill({json:receipts.get(data.command_id)})
   if(tail==='/topics'){const t={schema_version:2,mode:data.mode,item_ids:data.item_ids,read_only:false,legacy_origin:null,binding_count:0,...topics[0],id:'t'+(topics.length+1),course_id:course,title:data.title,text:'',bindings:[],revision:1,context_revision:0};topics.push(t);receipts.set(data.command_id,structuredClone(t));return route.fulfill({json:t})}
   if(!t)return route.fulfill({status:404,json:{detail:'不存在'}})
   if(conflict||t.revision!==data.expected_revision)return route.fulfill({status:409,json:{detail:{code:'revision_conflict',message:'其他窗口已更新，当前内容保留'}}})
   if(tail.endsWith('/manifest'))return route.fulfill({json:{status:'ready_model_disabled',model_called:false,can_send:false,course:{id:course,name:'课程一'},topic:t,question:data.question,included:t.bindings,excluded:[],groups:[],trace:{included:t.bindings.map((b:any)=>b.id),excluded:['other_topics','private_teacher_fields']},limitations:['未发送'],candidates:[]}})
   if(tail.endsWith('/composer'))t.text=data.text
   if(tail.endsWith('/legacy-copy'))t.text='旧历史文字'
   if(tail.endsWith('/bindings')){const next={...data.binding,id:crypto.randomUUID(),title:'公开课件.pdf',confirmed:true,provenance:'user_excerpt_unverified',supersedes:data.replace_id||null};t.bindings=data.replace_id?t.bindings.map((x:any)=>x.id===data.replace_id?next:x):[...t.bindings,next];t.context_revision++}
   if(req.method()==='DELETE'){t.bindings=t.bindings.filter((x:any)=>x.id!==tail.split('/').at(-1));t.context_revision++}
   t.revision++;t.binding_count=t.bindings.length;receipts.set(data.command_id,structuredClone(t));return route.fulfill({json:t})
  }
  return route.fulfill({status:404,json:{detail:'隔离测试'}})
 })
 return {topics,requests,fail:(value:boolean)=>failed=value,conflict:(value:boolean)=>conflict=value,hold:()=>{delayRead=new Promise(r=>release=r)},release:()=>{release?.();delayRead=null}}
}
async function open(page:Page,reader=false){await page.goto('/#/courses/c1/'+(reader?'reader?source=s1':'overview'));await b(page,'AI 学习助手').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toBeEnabled()}
async function save(page:Page,text:string){await page.getByLabel('本主题问题草稿',{exact:true}).fill(text);await b(page,'保存主题草稿').click();await expect(page.getByTestId('workspace-save-status')).toHaveText('已保存到服务端')}
async function region(page:Page){const box=(await page.locator('.rl-page').boundingBox())!;await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.3,{steps:4});await page.mouse.up()}

test('FE-V08 topics retain separate dirty drafts cross course and readonly manifest',async({page},info)=>{
 const f=await fixture(page);await open(page);expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>/ReaderLab|pdf.worker/.test(r.name)))).toBe(false)
 await save(page,'中文概念问题一');await page.locator('.aw-diagnostics > summary').click();await b(page,'检查本次上下文').click();await expect(page.getByLabel('本次上下文检查结果')).toContainText('纳入 0')
 await page.getByLabel('本主题问题草稿',{exact:true}).fill('尚未保存的A课草稿');await page.getByLabel('当前上下文主题').selectOption('t2');await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('第二主题草稿');await page.getByLabel('当前上下文主题').selectOption('t1');await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('尚未保存的A课草稿')
 await b(page,'关闭上下文准备').click();await page.getByRole('row',{name:'课程二',exact:true}).click();await b(page,'AI 学习助手').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toBeDisabled();await b(page,'关闭上下文准备').click();await page.getByRole('row',{name:'课程一',exact:true}).click();await b(page,'AI 学习助手').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('尚未保存的A课草稿')
 await save(page,'最终A课草稿');await page.reload();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('最终A课草稿');await page.screenshot({path:info.outputPath('topics-restored.png')});expect(f.requests.some(r=>/tutoring|preflight|attempts/.test(r))).toBe(false)
})

test('FE-V08 failed save conflict exports and explicit reload preserve local text',async({page})=>{
 const f=await fixture(page);await open(page);f.fail(true);await page.getByLabel('本主题问题草稿',{exact:true}).fill('网络失败也不能丢');await b(page,'保存主题草稿').click();await expect(page.getByRole('alert')).toContainText('未保存');await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('网络失败也不能丢')
 const downloadPromise=page.waitForEvent('download');await b(page,'导出当前准备内容').click();const download=await downloadPromise;expect(download.suggestedFilename()).toContain('assistant-workspace')
 f.fail(false);await b(page,'保存主题草稿').click();await expect(page.getByTestId('workspace-save-status')).toHaveText('已保存到服务端');f.conflict(true);await page.getByLabel('本主题问题草稿',{exact:true}).fill('冲突窗口内容');await b(page,'保存主题草稿').click();await expect(page.getByRole('alert')).toContainText('其他窗口');await expect(b(page,'保存主题草稿')).toBeDisabled();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('冲突窗口内容');f.conflict(false);page.once('dialog',d=>d.accept());await b(page,'显式重新读取').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('网络失败也不能丢')
})

test('FE-V08 material capture confirms cancels replaces and never creates notes',async({page},info)=>{
 const f=await fixture(page);await open(page,true);await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b(page,'笔刷').click();await page.getByText('添加上下文／从工作区选择',{exact:true}).click();await b(page,'从资料框选').click();await expect(page.getByText('临时上下文取材',{exact:true})).toBeVisible();await region(page);await b(page,'预览本次取材').click();await expect(page.getByLabel('待确认上下文')).toContainText('未执行OCR');expect(f.topics[0].bindings).toHaveLength(0);await b(page,'取消本次预览').click();await expect(b(page,'笔刷')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-annotation]')).toHaveCount(0)
 await b(page,'从资料框选').click();await region(page);await page.keyboard.press('Escape');await expect(page.getByText('临时上下文取材',{exact:true})).toHaveCount(0);await expect(b(page,'笔刷')).toHaveAttribute('aria-pressed','true')
 await b(page,'从资料框选').click();await region(page);await b(page,'预览本次取材').click();await b(page,'确认绑定上下文').click();await expect(page.getByLabel('已确认上下文')).toContainText('第 1 页');expect(f.topics[0].bindings).toHaveLength(1);await expect(page.locator('[data-annotation]')).toHaveCount(0)
 await b(page,'从资料框选').click();await region(page);await b(page,'预览本次取材').click();await page.getByLabel('上下文新增或替换').selectOption(f.topics[0].bindings[0].id);await b(page,'确认绑定上下文').click();expect(f.topics[0].bindings).toHaveLength(1);expect(f.topics[0].context_revision).toBe(2)
 await save(page,'解释所选区域');await page.locator('.aw-diagnostics > summary').click();await b(page,'检查本次上下文').click();await expect(page.getByLabel('本次上下文检查结果')).toContainText('纳入 1');await page.screenshot({path:info.outputPath('capture-manifest.png')});await b(page,'移除此上下文').click();await expect(page.getByLabel('已确认上下文')).toContainText('可添加课件片段或题目')
})

test('FE-V08 delayed old topic response cannot overwrite another course',async({page})=>{
 const f=await fixture(page);await open(page);await page.getByLabel('当前上下文主题').selectOption('t2');f.hold();await page.getByLabel('当前上下文主题').selectOption('t1');await b(page,'关闭上下文准备').click();await page.getByRole('row',{name:'课程二',exact:true}).click();await b(page,'AI 学习助手').click();f.release();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toBeDisabled();await expect(page.getByLabel('当前上下文主题')).toHaveCount(0);await b(page,'关闭上下文准备').click();await page.getByRole('row',{name:'课程一',exact:true}).click();await b(page,'AI 学习助手').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('第二主题草稿')
})

test('FE-V08 legacy stays historical until explicit text-only copy',async({page})=>{
 const f=await fixture(page);await open(page);await page.getByText('历史记录',{exact:true}).click();await page.getByText('旧记录查看与显式复制',{exact:true}).click();await b(page,'读取旧记录').click();await expect(page.getByText('旧历史文字',{exact:true})).toBeVisible();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('');await b(page,'仅复制旧草稿文字').click();await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('旧历史文字');expect(f.topics[0].bindings).toHaveLength(0)
})

test('FE-V08 acknowledged older save retains newer text for next explicit save',async({page})=>{
 const f=await fixture(page);await open(page);let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);let held=false
 await page.route('**/assistant/v2/topics/t1/composer',async route=>{if(!held){held=true;await gate}await route.fallback()})
 await page.getByLabel('本主题问题草稿',{exact:true}).fill('发送保存的第一版');await b(page,'保存主题草稿').click();await expect.poll(()=>held).toBe(true);await page.getByLabel('本主题问题草稿',{exact:true}).fill('等待回执时编辑的第二版');release();await expect(page.getByTestId('workspace-save-status')).toContainText('新改动');await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('等待回执时编辑的第二版');expect(f.topics[0].text).toBe('发送保存的第一版');await b(page,'保存主题草稿').click();await expect(page.getByTestId('workspace-save-status')).toHaveText('已保存到服务端');expect(f.topics[0].text).toBe('等待回执时编辑的第二版')
})

test('FE-V08 explicit create retries lost acknowledgement with same command',async({page})=>{
 const f=await fixture(page);await open(page);let fail=true
 await page.route('**/assistant/v2/topics',async route=>{if(route.request().method()==='POST'&&fail){fail=false;return route.abort('failed')}return route.fallback()})
 await page.getByText('更多对话选项',{exact:true}).click();await page.getByLabel('新主题名称').fill('断网建主题');await b(page,'创建话题').click();await expect(page.getByRole('alert')).toBeVisible();await expect(b(page,'重试待确认命令')).toBeVisible();await b(page,'重试待确认命令').click();await expect(page.getByLabel('当前上下文主题')).toContainText('断网建主题');expect(f.topics.filter(t=>t.title==='断网建主题')).toHaveLength(1)
})

test('FE-V08 text capture restores old selection and composing Escape stays in capture',async({page})=>{
 const f=await fixture(page);await open(page,true);await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await page.getByLabel('缩放百分比',{exact:true}).fill('100');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b(page,'框选').click();await region(page);const original=await page.locator('.rl-selection').first().getAttribute('x');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.getByText('添加上下文／从工作区选择',{exact:true}).click();await b(page,'从资料选字').click();const span=page.locator('.rl-page .rl-text-layer span').filter({hasText:'单行中文选择'});await span.scrollIntoViewIfNeeded();const box=(await span.boundingBox())!;await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:8});await page.mouse.up();await b(page,'预览本次取材').click();await expect(page.getByLabel('待确认上下文')).toContainText('单行中文选择');await page.getByLabel('本主题问题草稿',{exact:true}).dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});await expect(page.getByText('临时上下文取材',{exact:true})).toBeVisible();await b(page,'取消本次预览').click();await expect(b(page,'框选')).toHaveAttribute('aria-pressed','true');expect(await page.locator('.rl-selection').first().getAttribute('x')).toBe(original);expect(f.topics[0].bindings).toHaveLength(0)
})


test('assistant simplified default hides legacy modes and keeps recovery accessible',async({page},info)=>{
 const f=await fixture(page)
 await page.goto('/#/courses/c1/overview');await b(page,'AI 学习助手').click()
 await expect(page.getByLabel('本主题问题草稿',{exact:true})).toBeEnabled()
 await expect(b(page,'启用任务主题与上下文')).toHaveCount(0)
 await expect(b(page,'带学对话')).toHaveCount(0)
 await expect(b(page,'切回本机助手记录')).toHaveCount(0)
 await expect(b(page,'导出当前准备内容')).not.toBeVisible()
 await expect(b(page,'检查本次上下文')).not.toBeVisible()
 await expect(page.getByText('回答功能尚未接通，问题与附件可先保存。',{exact:true})).toBeVisible()
 await save(page,'简化后仍保存草稿')
 f.conflict(true);await page.getByLabel('本主题问题草稿',{exact:true}).fill('冲突时保留内容');await b(page,'保存主题草稿').click()
 await expect(page.getByRole('alert')).toBeVisible();await expect(b(page,'导出当前准备内容')).toBeVisible()
 await expect(page.getByLabel('本主题问题草稿',{exact:true})).toHaveValue('冲突时保留内容')
 await page.screenshot({path:info.outputPath('assistant-conflict.png')})
})

test('assistant simplified new conversation does not require technical setup',async({page},info)=>{
 const f=await fixture(page);f.topics.splice(0)
 await page.goto('/#/courses/c1/overview');await b(page,'AI 学习助手').click()
 await expect(page.getByText('从一个问题开始',{exact:true})).toBeVisible()
 await b(page,'新对话').click()
 await expect(page.getByLabel('本主题问题草稿',{exact:true})).toBeEnabled()
 await expect(page.getByLabel('当前上下文主题')).toHaveValue('t1')
 await expect(b(page,'建立新主题')).toHaveCount(0)
 await page.screenshot({path:info.outputPath('assistant-normal.png')})
})
