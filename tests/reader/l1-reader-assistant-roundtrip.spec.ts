import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const pdf=readFileSync('tests/fixtures/reader/mixed.pdf')
const sha=createHash('sha256').update(pdf).digest('hex')
const preview='pdfjs-6.5.438-normalized-v1'
const source={id:'s1',course_id:'c1',original_name:'数据库讲义.pdf',extension:'.pdf',status:'ready',sha256:sha,relative_path:'讲义/数据库讲义.pdf',size_bytes:pdf.length,material_type:'courseware',material_confidence:1,material_rationale:'隔离浏览器夹具',processing_stage:'ready',origins:[]}
const emptySnapshot={schema:1,document:{id:sha,name:source.original_name,originalFormat:'pdf',previewFormat:'pdf',previewVersion:preview,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}]},annotations:[],reader:{page:1,zoom:1,scroll:{x:0,y:0},selection:null,context:null,panelOpen:false,draft:''},savedAt:null}
const explanationText='索引是帮助数据库快速定位记录的数据结构。'

async function fixture(page:Page){
 let topic:any=null,revision=0,request:any=null,saved:any=null,saveCommands=0
 let listOverride:any[]|null=null,failLists=0
 const messages:any[]=[]
 const forbidden:string[]=[]
 const paths:string[]=[]
 await page.context().route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname
  paths.push(req.method()+' '+path)
  if(/attempt|grading|tutoring|learning-evidence|mastery/i.test(path))forbidden.push(req.method()+' '+path)
  if(path==='/api/courses')return route.fulfill({json:[{id:'c1',name:'数据库系统',school:'隔离测试',archived_at:null,exam_date:null}]})
  if(path==='/api/health')return route.fulfill({json:{status:'ok'}})
  if(path==='/api/courses/c1/sources')return route.fulfill({json:[source]})
  if(path==='/api/courses/c1/completeness')return route.fulfill({json:{total_sources:1,ready_sources:1,evidence_blocks:1,attention_sources:0,complete:true,issues:[]}})
  if(path==='/api/courses/c1/reading-summaries')return route.fulfill({json:{courseId:'c1',items:[]}})
  if(path==='/api/sources/s1/file')return route.fulfill({body:pdf,contentType:'application/pdf'})
  if(path==='/api/courses/c1/sources/s1/reader'){
   if(req.method()==='PUT'){const body=req.postDataJSON();return route.fulfill({json:{courseId:'c1',sourceId:'s1',courseName:'数据库系统',sha256:sha,name:source.original_name,previewVersion:preview,pages:emptySnapshot.document.pages,readOnly:false,revision:++revision,snapshot:body.snapshot}})}
   return route.fulfill({json:{courseId:'c1',sourceId:'s1',courseName:'数据库系统',sha256:sha,name:source.original_name,previewVersion:preview,pages:emptySnapshot.document.pages,readOnly:false,revision,snapshot:emptySnapshot}})
  }
  if(path==='/api/courses/c1/learning-sessions/current')return route.fulfill({json:null})
  const base='/api/courses/c1/assistant/v2'
  if(path===base+'/capabilities')return route.fulfill({json:{enabled:true,reason:'',mocked:true,task_support:false}})
  if(path===base+'/topics'&&req.method()==='GET')return route.fulfill({json:{schema_version:2,items:topic?[{...topic,text:undefined,bindings:undefined}]:[],next_offset:null,read_only:false}})
  if(path===base+'/topics'&&req.method()==='POST'){
   const body=req.postDataJSON();topic={schema_version:2,id:'t1',course_id:'c1',title:body.title,mode:'independent',item_ids:[],revision:1,context_revision:0,text:'',bindings:[],binding_count:0,read_only:false};return route.fulfill({json:topic})
  }
  if(path===base+'/topics/t1')return route.fulfill({json:topic})
  if(path===base+'/topics/t1/composer'&&req.method()==='PUT'){topic={...topic,text:req.postDataJSON().text,revision:topic.revision+1};return route.fulfill({json:topic})}
  if(path===base+'/topics/t1/requests'&&req.method()==='POST'){
   const body=req.postDataJSON();request={request_id:body.request_id,topic_id:'t1',state:'published',revision:1,error:'',notices:[],mocked:true,needs:'',dispatched:true,cancel_requested:false,answer_mode:'short'}
   messages.splice(0,messages.length,
    {id:1,request_id:body.request_id,role:'user',text:body.text,claims:[],context_active:true,mocked:false},
    {id:2,request_id:body.request_id,role:'assistant',text:explanationText,claims:[{text:'索引结构用于缩小查找范围。',kind:'evidence',evidence_ids:['ev-1'],quote:'索引可以帮助快速定位记录。'},{text:explanationText,kind:'model_explanation',evidence_ids:[],quote:''}],citations:[{evidence_id:'ev-1',title:source.original_name,provenance:'course_pdf',kind:'document',actionable:true,page:2}],context_active:true,mocked:true})
   return route.fulfill({status:202,json:request})
  }
  if(path===base+'/topics/t1/messages')return route.fulfill({json:{items:messages,requests:request?[request]:[],next_after:null}})
  if(path===base+'/requests/'+request?.request_id+'/citations/ev-1')return route.fulfill({json:{title:source.original_name,quote:'索引可以帮助快速定位记录。',provenance:'course_pdf',action:{kind:'document',course_id:'c1',source_id:'s1',source_sha256:sha,preview_version:preview,page:2,precision:'page'}}})
  if(path===base+'/requests/'+request?.request_id+'/saved-explanations'&&req.method()==='POST'){
   saveCommands++;saved={id:'saved-1',course_id:'c1',topic_id:'t1',request_id:request.request_id,content:{question:messages[0]?.text||'',text:explanationText,claims:messages[1]?.claims,citations:messages[1]?.citations,mocked:true},anchors:[{kind:'document',source_id:'s1',source_sha256:sha,preview_version:preview,page:2,evidence_id:'ev-1',title:source.original_name}],revision:1,valid:true,revoked_at:null,created_at:'2026-11-24T00:00:00Z'};return route.fulfill({json:saved})
  }
  if(path===base+'/saved-explanations'&&req.method()==='GET'&&url.searchParams.has('offset')){if(failLists>0){failLists--;return route.fulfill({status:503,json:{detail:'temporary'}})}const items=listOverride??(saved?[saved]:[]),offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));return route.fulfill({json:{items:items.slice(offset,offset+limit),next_offset:items.length>offset+limit?offset+limit:null,enabled:true}})}
  if(path===base+'/saved-explanations'&&req.method()==='GET')return route.fulfill({json:{items:saved&&!saved.revoked_at&&(!url.searchParams.has('source_id')||url.searchParams.get('source_id')==='s1')?[saved]:[],next_offset:null,enabled:true}})
  if(path===base+'/saved-explanations/saved-1/revoke'){if(saved)saved={...saved,revoked_at:'2026-11-24T00:01:00Z',revision:saved.revision+1};return route.fulfill({json:saved})}
  return route.fulfill({status:404,json:{detail:'隔离浏览器夹具未声明此接口'}})
 })
 return {setList:(items:any[])=>{listOverride=items},failNextList:()=>{failLists++},invalidate:()=>{saved={...saved,valid:false}},paths,forbidden,saved:()=>saved,saveCommands:()=>saveCommands,messages:()=>messages}
}

test('L1 reader to assistant citation return save reopen and revoke stays outside grading',async({page},info)=>{
 const state=await fixture(page)
 await page.goto('/#/courses/c1/materials')
 await page.getByRole('link',{name:'阅读 数据库讲义.pdf',exact:true}).click()
 await expect(page.locator('.rl-page')).toHaveAttribute('data-page','1')
 await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
 if(!await page.getByRole('complementary',{name:'AI 学习助手'}).isVisible())await page.getByRole('button',{name:'AI 学习助手',exact:true}).click()
 await expect(page.getByLabel('向助手提问')).toBeEnabled()
 await page.getByLabel('向助手提问').fill('索引为什么能加快查找？')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 const answer=page.getByRole('article',{name:'助手回答'})
 await expect(answer).toContainText(explanationText)
 await expect(answer).toContainText('MOCK流程样本')
 await answer.getByRole('button',{name:/数据库讲义.pdf · 第 2 页/}).click()
 await expect(page.getByRole('complementary',{name:'引用核对'})).toContainText('页级定位')
 await expect(page.getByRole('complementary',{name:'引用核对'})).toContainText('索引可以帮助快速定位记录。')
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await expect(page.locator('.rl-selectionbar').getByRole('button',{name:'返回原位置'})).toBeVisible()
 await page.getByRole('button',{name:'返回原学习位置'}).click()
 await expect(page.locator('.rl-selectionbar').getByRole('button',{name:'返回原位置'})).toHaveCount(0)
 await expect(page.locator('.rl-page')).toHaveAttribute('data-page','1')
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await expect(page.getByLabel('向助手提问')).toHaveValue('')
 await expect(page.getByRole('article',{name:'你的问题'})).toContainText('索引为什么能加快查找？')
 await answer.getByRole('button',{name:'明确保存讲解'}).click()
 await expect(answer.getByRole('button',{name:/已保存 · 数据库讲义.pdf 第2页/})).toBeVisible()
 expect(state.saveCommands()).toBe(1)
 expect(state.saved()?.anchors[0]).toMatchObject({source_id:'s1',source_sha256:sha,preview_version:preview,page:2})
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.getByRole('link',{name:'返回课程资料',exact:true}).click()
 await page.getByRole('link',{name:'阅读 数据库讲义.pdf',exact:true}).click()
 const backlinks=page.getByRole('complementary',{name:'已保存的讲解'})
 await expect(backlinks).toBeVisible()
 await backlinks.getByRole('button',{name:/索引为什么能加快查找/}).click()
 await expect(page.getByRole('region',{name:'中央关联讲解'})).toContainText(explanationText)
 await expect(page.getByRole('region',{name:'中央关联讲解'})).toContainText('不产生新请求')
 await page.getByRole('button',{name:'返回提问位置'}).click()
 await expect(page.locator('.rl-page')).toHaveAttribute('data-page','1')
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 if(!await page.getByRole('region',{name:'AI 学习助手'}).isVisible())await page.getByRole('button',{name:'AI 学习助手',exact:true}).click()
 const savedButton=page.getByRole('button',{name:/已保存 · 数据库讲义.pdf 第2页/})
 await expect(savedButton).toBeVisible()
 await page.getByRole('button',{name:'撤销关系'}).click()
 await expect(savedButton).toHaveCount(0)
 expect(state.saved()?.revoked_at).toBeTruthy()
 expect(state.messages().map(message=>message.role)).toEqual(['user','assistant'])
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.getByRole('link',{name:'返回课程资料',exact:true}).click()
 await page.getByRole('link',{name:'阅读 数据库讲义.pdf',exact:true}).click()
 await expect(page.getByRole('complementary',{name:'已保存的讲解'})).toHaveCount(0)
 expect(state.forbidden).toEqual([])
 expect(state.paths.some(path=>/attempt|grading|tutoring|learning-evidence|mastery/i.test(path))).toBe(false)
 await page.screenshot({path:info.outputPath('reader-assistant-roundtrip.png')})
})


test('失效讲解从助手和资料入口仍能回访正文，定位保持禁用',async({page})=>{
 const state=await fixture(page)
 await page.goto('/#/courses/c1/materials')
 await page.getByRole('link',{name:'阅读 数据库讲义.pdf',exact:true}).click()
 await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
 if(!await page.getByRole('complementary',{name:'AI 学习助手'}).isVisible())await page.getByRole('button',{name:'AI 学习助手',exact:true}).click()
 await page.getByLabel('向助手提问').fill('索引为什么能加快查找？')
 await page.getByRole('button',{name:'发送',exact:true}).click()
 const answer=page.getByRole('article',{name:'助手回答'})
 await answer.getByRole('button',{name:'明确保存讲解'}).click()
 await expect(answer.getByRole('button',{name:/已保存 ·/})).toBeVisible()
 state.invalidate()
 await page.reload()
 await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
 const backlinks=page.getByRole('complementary',{name:'已保存的讲解'})
 await expect(backlinks).toContainText('锚点已失效，内容仍保留')
 await backlinks.getByRole('button',{name:/索引为什么能加快查找/}).click()
 const central=page.getByRole('region',{name:'中央关联讲解'})
 await expect(central).toContainText(explanationText)
 await expect(central).toContainText('不能当作当前有效依据')
 await expect(central.getByRole('button',{name:/核对并定位/})).toBeDisabled()
 await page.getByRole('button',{name:'关闭讲解',exact:true}).click()
 if(!await page.getByRole('complementary',{name:'AI 学习助手'}).isVisible())await page.getByRole('button',{name:'AI 学习助手',exact:true}).click()
 await answer.getByRole('button',{name:/已保存 ·/}).click()
 await expect(central).toContainText(explanationText)
 await expect(central.getByRole('button',{name:/核对并定位/})).toBeDisabled()
 expect(state.paths.filter(path=>path.endsWith('/topics/t1/requests'))).toHaveLength(1)
 expect(state.paths.filter(path=>path.includes('/citations/'))).toHaveLength(0)
 expect(state.forbidden).toEqual([])
 expect(state.saveCommands()).toBe(1)
})


function listItem(index:number){
 return {id:'list-'+index,course_id:'c1',topic_id:'t1',request_id:'saved-request-'+index,
  content:{question:'保留问题 '+index,text:'保留解释 '+index,claims:[{text:'保留解释 '+index,kind:'evidence',evidence_ids:['ev-1'],quote:'历史文字'}],citations:[{evidence_id:'ev-1',title:source.original_name,kind:'document',actionable:true,page:2}],mocked:true},
  anchors:index===0?[]:[{kind:'document',source_id:'s1',page:2,title:source.original_name}],valid:index!==20,revision:1,revoked_at:null}
}

test('课程列表无需原对话即可分页重开无锚点与失效讲解',async({page})=>{
 const state=await fixture(page);state.setList(Array.from({length:21},(_,index)=>listItem(index)))
 await page.goto('/#/courses/c1/overview')
 await page.getByRole('region',{name:'课程总览',exact:true}).getByRole('link',{name:'已保存讲解',exact:true}).click()
 const list=page.getByRole('region',{name:'课程已保存讲解'})
 await expect(list).toContainText('保存到讲解列表 · 无关联资料或题目')
 await list.getByRole('button',{name:'保留问题 0',exact:true}).click()
 const central=page.getByRole('region',{name:'中央关联讲解'})
 await expect(central).toContainText('保留解释 0')
 await page.getByRole('button',{name:'返回提问位置',exact:true}).click()
 await expect(central).toHaveCount(0)
 await list.getByRole('button',{name:'加载更早讲解'}).click()
 await list.getByRole('button',{name:'保留问题 20',exact:true}).click()
 await expect(central).toContainText('保留解释 20')
 await expect(central).toContainText('不能当作当前有效依据')
 await expect(central.getByRole('button',{name:/核对并定位/})).toBeDisabled()
 await page.reload()
 await expect(list.getByRole('button',{name:'保留问题 0',exact:true})).toBeVisible()
 expect(state.paths.filter(path=>path.startsWith('POST '))).toEqual([])
 expect(state.forbidden).toEqual([])
})

test('中央讲解键盘打开、输入法Escape保护与关闭恢复入口焦点',async({page})=>{
 const state=await fixture(page);state.setList([listItem(1)])
 await page.goto('/#/courses/c1/saved')
 const opener=page.getByRole('button',{name:'保留问题 1',exact:true}),central=page.getByRole('region',{name:'中央关联讲解'})
 await opener.focus();await opener.press('Enter');await expect(central).toBeFocused()
 await page.keyboard.press('Tab');await expect(central.getByRole('button',{name:'返回提问位置',exact:true})).toBeFocused()
 await page.keyboard.press('Tab');await expect(central.getByRole('button',{name:'关闭讲解',exact:true})).toBeFocused()
 await central.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});await expect(central).toBeVisible()
 await central.dispatchEvent('keydown',{key:'Escape',code:'Escape',keyCode:229});await expect(central).toBeVisible()
 await page.keyboard.press('Escape');await expect(central).toHaveCount(0);await expect(opener).toBeFocused()
 await opener.press('Enter');await expect(central).toBeFocused()
 await central.getByRole('button',{name:'关闭讲解',exact:true}).click();await expect(opener).toBeFocused()
 await opener.press('Enter');await expect(central).toBeFocused()
 await central.getByRole('button',{name:'返回提问位置',exact:true}).click();await expect(opener).toBeFocused()
 expect(state.paths.filter(path=>path.startsWith('POST '))).toEqual([]);expect(state.forbidden).toEqual([])
})

test('中央讲解离开原路由后关闭不会抢回旧入口焦点',async({page})=>{
 const state=await fixture(page);state.setList([listItem(1)])
 await page.goto('/#/courses/c1/saved');await page.getByRole('button',{name:'保留问题 1',exact:true}).click()
 const central=page.getByRole('region',{name:'中央关联讲解'});await expect(central).toBeFocused()
 await page.evaluate(()=>{location.hash='#/courses/c1/overview'})
 await expect(page.getByRole('region',{name:'课程总览',exact:true})).toBeVisible()
 await central.press('Escape');await expect(central).toHaveCount(0)
 await expect(page).toHaveURL(/overview$/);await expect(page.getByRole('button',{name:'保留问题 1',exact:true})).toHaveCount(0)
 expect(state.forbidden).toEqual([])
})

for(const action of ['关闭讲解','Escape','返回提问位置','切换讲解','离开页面','离开课程'] as const){
 test('中央讲解引用查询在'+action+'后取消，迟到结果不抢回位置',async({page})=>{
  const state=await fixture(page);state.setList([listItem(1),listItem(2)])
  let release!:()=>void,started!:()=>void,finished!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve}),received=new Promise<void>(resolve=>{started=resolve}),done=new Promise<void>(resolve=>{finished=resolve})
  await page.route('**/requests/saved-request-1/citations/ev-1',async route=>{
   started();await held
   try{await route.fulfill(action==='切换讲解'?{status:503,json:{detail:{message:'旧讲解查询失败'}}}:{json:{action:{kind:'document',course_id:'c1',source_id:'s1',source_sha256:sha,preview_version:preview,page:2}}})}catch{/* The canceled browser request may already be disposed. */}finally{finished()}
  })
  await page.goto('/#/courses/c1/saved')
  await page.getByRole('button',{name:'保留问题 1',exact:true}).click()
  const central=page.getByRole('region',{name:'中央关联讲解'}),locate=central.getByRole('button',{name:/核对并定位/})
  await locate.click();await received
  await expect(central.getByRole('status')).toContainText('正在核对来源')
  await expect(locate).toBeDisabled()
  const canceled=page.waitForEvent('requestfailed',request=>request.url().includes('/requests/saved-request-1/citations/ev-1'))
  if(action==='切换讲解')await page.evaluate(()=>window.dispatchEvent(new CustomEvent('assistant:show-explanation',{detail:{course_id:'c1',request_id:'saved-request-2',origin:location.href,question:'保留问题 2',message:{role:'assistant',text:'保留解释 2',claims:[{text:'保留解释 2',kind:'evidence',evidence_ids:['ev-1']}],citations:[{evidence_id:'ev-1',actionable:true,title:'讲义',page:2}],context_active:true}}})))
  else if(action==='离开页面')await page.evaluate(()=>{location.hash='#/courses/c1/overview'})
  else if(action==='离开课程')await page.evaluate(()=>{location.hash='#/'})
  else if(action==='Escape')await central.press('Escape')
  else await central.getByRole('button',{name:action,exact:true}).click()
  await canceled
  const destination=page.url();release();await done
  await expect(page).toHaveURL(destination)
  if(action==='切换讲解'){await expect(central).toContainText('保留解释 2');await expect(central.getByRole('button',{name:/核对并定位/})).toBeEnabled();await expect(central.getByRole('alert')).toHaveCount(0)}
  if(action==='关闭讲解'||action==='Escape'||action==='返回提问位置')await expect(central).toHaveCount(0)
  expect(state.paths.filter(path=>path.startsWith('POST '))).toEqual([]);expect(state.forbidden).toEqual([])
 })
}

test('中央讲解引用核对失败保留正文且可显式重试',async({page})=>{
 const state=await fixture(page);state.setList([listItem(1)]);let calls=0
 await page.route('**/requests/saved-request-1/citations/ev-1',route=>++calls===1
  ?route.fulfill({status:503,json:{detail:{message:'来源核对暂不可用'}}})
  :route.fulfill({json:{action:{kind:'document',course_id:'c1',source_id:'s1',source_sha256:sha,preview_version:preview,page:2}}}))
 await page.goto('/#/courses/c1/saved');await page.getByRole('button',{name:'保留问题 1',exact:true}).click()
 const central=page.getByRole('region',{name:'中央关联讲解'}),locate=central.getByRole('button',{name:/核对并定位/})
 await locate.click();await expect(central.getByRole('alert')).toContainText('来源核对暂不可用')
 await expect(central).toContainText('保留解释 1');await expect(locate).toBeEnabled();expect(calls).toBe(1)
 await locate.click();await expect(page).toHaveURL(/citation_page=2/);await expect(central.getByRole('alert')).toHaveCount(0)
 expect(calls).toBe(2);expect(state.forbidden).toEqual([])
})

for(const targetCourse of ['c1','other-course']){
 test('中央讲解引用校验课程 '+targetCourse,async({page})=>{
  const state=await fixture(page);state.setList([listItem(1)])
  await page.route('**/requests/saved-request-1/citations/ev-1',route=>route.fulfill({json:{action:{kind:'document',course_id:targetCourse,source_id:'s1',source_sha256:sha,preview_version:preview,page:2}}}))
  await page.goto('/#/courses/c1/saved');await page.getByRole('button',{name:'保留问题 1',exact:true}).click()
  const central=page.getByRole('region',{name:'中央关联讲解'})
  await central.getByRole('button',{name:/核对并定位/}).click()
  if(targetCourse==='c1'){await expect(page).toHaveURL(/citation_page=2/);await expect(page.locator('.rl-page')).toHaveAttribute('data-page','2')}
  else{await expect(central.getByRole('alert')).toContainText('本课程资料页定位');await expect(page).toHaveURL(new RegExp("#.*courses.*c1.*saved$"));await expect(central.getByRole('button',{name:/核对并定位/})).toBeEnabled()}
  expect(state.forbidden).toEqual([])
 })
}

test('课程列表加载失败可重试，空列表提供明确保存说明',async({page})=>{
 const state=await fixture(page);state.setList([]);state.failNextList()
 await page.goto('/#/courses/c1/saved')
 const list=page.getByRole('region',{name:'课程已保存讲解'})
 await expect(list.getByRole('alert')).toContainText('暂时无法读取已保存讲解')
 await list.getByRole('button',{name:'重试读取讲解'}).click()
 await expect(list).toContainText('还没有已保存讲解')
 state.setList([listItem(0)])
 await list.getByRole('button',{name:'刷新讲解列表'}).click()
 await expect(list.getByRole('button',{name:'保留问题 0',exact:true})).toBeVisible()
 expect(state.paths.filter(path=>path.startsWith('POST '))).toEqual([])
 expect(state.forbidden).toEqual([])
})
