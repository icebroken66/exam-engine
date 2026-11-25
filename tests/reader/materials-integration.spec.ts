import {test, expect, type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const pdf=readFileSync('tests/fixtures/reader/mixed.pdf'), hash=createHash('sha256').update(pdf).digest('hex'), version='pdfjs-6.5.438-normalized-v1'
const courses=[{id:'c1',name:'数据库基础',school:'样板学校',archived_at:null,exam_date:null},{id:'c2',name:'空课程',school:'样板学校',archived_at:null,exam_date:null}]
const source=(id:string,name:string,extension:string,status:string)=>({id,course_id:'c1',original_name:name,extension,status,sha256:hash,relative_path:'讲义/'+name,size_bytes:pdf.length,material_type:'courseware',material_confidence:1,material_rationale:'',processing_note:status==='failed'?'解析失败样本':'',processing_stage:status,processing_duration_seconds:0,origins:[]})
async function fixture(page:Page){
 let snapshot:any={schema:1,document:{id:hash,name:'讲义.pdf',originalFormat:'pdf',previewFormat:'pdf',previewVersion:version,pages:[{width:800,height:600},{width:600,height:800},{width:800,height:600}]},annotations:[],reader:{page:2,zoom:1.25,scroll:{x:0,y:80},selection:null,context:null,panelOpen:false,draft:''},savedAt:'2026-11-23T00:00:00Z'},revision=1
 let summaryFail=false, corrupt=false, holdUpload:(()=>void)|undefined, uploads=0
 const files=[source('s1','讲义.pdf','.pdf','failed'),source('s2','讲义.pptx','.pptx','ready'),source('s3','排队.pdf','.pdf','queued')]
 const requests:string[]=[]
 await page.context().route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;requests.push(r.request().method()+' '+path)
  if(path==='/api/courses')return r.fulfill({json:courses})
  if(path==='/api/health')return r.fulfill({json:{status:'ok'}})
  if(path.endsWith('/reading-summaries'))return summaryFail?r.fulfill({status:503}):r.fulfill({json:{courseId:path.split('/')[3],items:path.includes('/c1/')?[{sourceId:'s1',name:'讲义.pdf',sha256:hash,previewVersion:version,page:2,revision:1,updatedAt:'2026-11-23T00:00:00Z'}]:[]}})
  if(path.endsWith('/sources/batch')){uploads++;await new Promise<void>(resolve=>holdUpload=resolve);return r.fulfill({json:{imported_count:1,deduplicated_count:0,failures:[{filename:'失败.txt',message:'测试上传失败'}],results:[{source:files[0],deduplicated:false}]}})}
  if(path.endsWith('/sources'))return r.fulfill({json:path.includes('/c1/')?files:[]})
  if(path.endsWith('/completeness'))return r.fulfill({json:{total_sources:path.includes('/c1/')?3:0,ready_sources:1,evidence_blocks:0,attention_sources:2,complete:false,issues:[]}})
  if(path.endsWith('/reader')){if(corrupt)return r.fulfill({status:422,json:{detail:'PDF无法读取；未覆盖已有笔记'}});if(r.request().method()==='PUT'){snapshot=r.request().postDataJSON().snapshot;revision++}return r.fulfill({json:{courseId:'c1',courseName:courses[0].name,sourceId:'s1',sha256:hash,name:'讲义.pdf',previewVersion:version,pages:snapshot.document.pages,readOnly:false,revision,snapshot}})}
  if(path.endsWith('/file'))return r.fulfill({body:pdf,contentType:'application/pdf'})
  if(path.endsWith('/learning-sessions/current'))return r.fulfill({json:null})
  return r.fulfill({status:404,json:{detail:'隔离样板'}})
 })
 return {requests,setSummaryFail:()=>summaryFail=true,setCorrupt:()=>corrupt=true,upload:()=>({uploads,release:()=>holdUpload?.()})}
}
test('FE-V06 cold resume filename filters return and separate course state',async({page},info)=>{
 const state=await fixture(page);await page.goto('/#/courses/c1/materials')
 await expect(page.locator('.workspace-tabs [aria-current=page]')).toHaveText('课程资料')
 await expect(page.getByRole('link',{name:'继续阅读',exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'阅读 讲义.pdf',exact:true})).toBeVisible()
 expect(state.requests.some(r=>r.includes('learning-context')||r.includes('/file')||r.includes('/reader'))).toBe(false)
 expect(await page.evaluate(()=>performance.getEntriesByType('resource').some(e=>/pdf.worker|ReaderLab/.test(e.name)))).toBe(false)
 expect((await page.getByRole('link',{name:'阅读 讲义.pdf',exact:true}).boundingBox())!.y).toBeLessThan(900)
 await page.screenshot({path:info.outputPath('materials.png')})
 await page.getByLabel('按文件名搜索',{exact:true}).fill('讲义');await page.getByRole('button',{name:'可阅读',exact:true}).click();await expect(page.locator('.source-record')).toHaveCount(1)
 await page.getByRole('link',{name:'讲义.pdf',exact:true}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await expect(page.locator('.rl-page')).toHaveAttribute('data-page','2');await expect(page.getByLabel('缩放百分比',{exact:true})).toHaveValue('125')
 await page.screenshot({path:info.outputPath('reader.png')})
 await page.getByRole('button',{name:'AI 学习助手',exact:true}).click();await page.getByLabel('统一助手草稿').fill('返回后继续提问');await expect(page.getByRole('button',{name:'导出统一助手记录'})).toBeHidden();await page.screenshot({path:info.outputPath('assistant.png')})
 await page.getByRole('link',{name:'返回课程资料',exact:true}).click();await expect(page.getByLabel('按文件名搜索',{exact:true})).toHaveValue('讲义');await expect(page.locator('.source-record')).toHaveCount(1)
 await expect(page.getByLabel('统一助手草稿')).toHaveValue('返回后继续提问');await page.getByRole('button',{name:'关闭统一助手'}).click()
 await page.getByRole('row',{name:'空课程',exact:true}).click();await page.getByRole('link',{name:'管理课程资料',exact:true}).click();await expect(page.getByRole('link',{name:'继续阅读',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:/选择多份资料/})).toBeVisible();await page.screenshot({path:info.outputPath('empty.png')})
 await page.getByRole('row',{name:'数据库基础',exact:true}).click();await page.getByRole('link',{name:'管理课程资料',exact:true}).click();await expect(page.getByLabel('按文件名搜索',{exact:true})).toHaveValue('讲义');await page.reload();await expect(page.locator('.source-record')).toHaveCount(1)
 await page.getByLabel('按文件名搜索',{exact:true}).fill('不存在');await expect(page.getByText('没有匹配文件名和筛选条件的资料。请清除筛选后重试。')).toBeVisible();await expect(page.getByRole('button',{name:/选择多份资料/})).toBeHidden();await page.getByRole('button',{name:'清除筛选'}).click();await expect(page.locator('.source-record')).toHaveCount(3)
 await page.goBack();await expect(page.locator('.workspace-tabs [aria-current=page]')).toHaveText('课程总览')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('FE-V06 old summary response cannot replace another course and learning deep link stays explicit',async({page})=>{
 await fixture(page)
 let release:(()=>void)|undefined
 await page.route('**/api/courses/c1/reading-summaries',async route=>{await new Promise<void>(resolve=>release=resolve);await route.fulfill({json:{courseId:'c1',items:[{sourceId:'s1',name:'旧课程资料',sha256:hash,previewVersion:version,page:2,revision:1,updatedAt:'2026-11-23T00:00:00Z'}]}}).catch(()=>{})})
 await page.goto('/#/courses/c1/materials');await expect.poll(()=>Boolean(release)).toBe(true);await page.getByRole('row',{name:'空课程',exact:true}).click();await page.getByRole('link',{name:'管理课程资料',exact:true}).click();release!();await expect(page.getByRole('button',{name:/选择多份资料/})).toBeVisible();await expect(page.getByRole('link',{name:'继续阅读',exact:true})).toHaveCount(0);await expect(page.getByText('旧课程资料',{exact:true})).toHaveCount(0)
 await page.goto('/#/courses/c1/learn?session=history-one');await expect(page.locator('.workspace-tabs [aria-current=page]')).toHaveText('练习题目');expect(page.url()).toContain('/learn?session=history-one')
 await page.goto('/#/courses/missing/materials');await expect(page.getByRole('alert').filter({hasText:'课程不存在或已归档'})).toBeVisible();expect(page.url()).toContain('/missing/materials')
})
test('FE-V06 summary failure unsupported format and corrupt original',async({page},info)=>{
 const state=await fixture(page);state.setSummaryFail();await page.goto('/#/courses/c1/materials');await expect(page.getByText('继续阅读暂时无法读取，可从资料列表手动打开。',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'阅读 讲义.pdf',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'阅读 讲义.pptx',exact:true})).toHaveCount(0)
 state.setCorrupt();await page.getByRole('link',{name:'阅读 讲义.pdf',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('PDF无法读取；未覆盖已有笔记');await expect(page.getByRole('link',{name:'返回课程资料',exact:true})).toBeVisible();await expect(page.locator('.rl-page')).toHaveCount(0);await page.screenshot({path:info.outputPath('read-failure.png')})
})
test('FE-V06 upload stays secondary browsable and prevents duplicate batches',async({page})=>{
 const state=await fixture(page);await page.goto('/#/courses/c1/materials');await page.getByText('添加资料',{exact:true}).click();await page.locator('.source-panel input[type=file]').first().setInputFiles([{name:'成功.pdf',mimeType:'application/pdf',buffer:pdf},{name:'失败.txt',mimeType:'text/plain',buffer:Buffer.from('x')}]);await page.locator('.rights-check input').check();const submit=page.getByRole('button',{name:/批量导入.*并自动解析/});await submit.click();await expect(page.getByRole('button',{name:'正在上传并安排整批解析'})).toBeDisabled();await expect(page.getByRole('link',{name:'阅读 讲义.pdf',exact:true})).toBeVisible();await expect.poll(()=>state.upload().uploads).toBe(1);state.upload().release();await expect(page.getByLabel('未导入文件')).toContainText('失败.txt');await expect(page.locator('.source-list .source-record')).toHaveCount(3);expect(state.upload().uploads).toBe(1)
})
