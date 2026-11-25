import {spawn} from 'node:child_process'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {chromium,expect,request} from '@playwright/test'
const evidence=path.resolve('data/acceptance-fev07/live-'+Date.now());mkdirSync(evidence,{recursive:true})
const temp=mkdtempSync(path.join(os.tmpdir(),'fev07-live-')),env={...process.env,MODEL_PROVIDER:'mock',EXAM_ENGINE_DATA_DIR:temp,DATABASE_URL:'sqlite:///'+path.join(temp,'test.db').split(path.sep).join('/'),EXAM_ENGINE_API_URL:'http://127.0.0.1:8025',PYTHONUTF8:'1'}
for(const key of Object.keys(env))if(/^(OPENAI_|MODEL_(?!PROVIDER)|PYTHONPATH$)/i.test(key))delete env[key]
const logs=[],children=[],results=[]
function start(command,args,name){const fd=openSync(path.join(evidence,name+'.log'),'w');logs.push(fd);const p=spawn(command,args,{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(p)}
start(path.resolve('.venv/Scripts/python.exe'),['-m','uvicorn','app.main:app','--app-dir','backend','--host','127.0.0.1','--port','8025'],'api')
start(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','7195','--strictPort'],'vite')
let http
try{
 http=await request.newContext({baseURL:'http://127.0.0.1:7195'});await expect.poll(async()=>{try{return(await http.get('/api/health')).status()}catch{return 0}},{timeout:30000}).toBe(200)
 const course=await(await http.post('/api/courses',{data:{school:'公开夹具学校',name:'FE-V07临时联通'}})).json()
 const uploaded=await http.post('/api/courses/'+course.id+'/sources',{multipart:{rights_confirmed:'true',file:{name:'mixed.pdf',mimeType:'application/pdf',buffer:readFileSync('tests/fixtures/reader/mixed.pdf')}}});expect(uploaded.status()).toBe(201);const source=(await uploaded.json()).source,url='/api/courses/'+course.id+'/sources/'+source.id+'/reader'
 for(const channel of ['msedge','chrome']){
  const browser=await chromium.launch({channel})
  try{
   const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const b=n=>page.getByRole('button',{name:n,exact:true})
   await page.goto('http://127.0.0.1:7195/#/courses/'+course.id+'/overview');await expect(page.getByRole('heading',{name:'课程总览',exact:true})).toBeVisible();await page.getByRole('treegrid').getByRole('row',{name:/^mixed\.pdf/}).click();await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true')
   await page.getByLabel('缩放百分比',{exact:true}).fill('50');await page.getByLabel('缩放百分比',{exact:true}).press('Enter');await b('笔刷').click();let box=await page.locator('.rl-page').boundingBox();await page.mouse.move(box.x+.55*box.width,box.y+.2*box.height);await page.mouse.down();await page.mouse.move(box.x+.7*box.width,box.y+.3*box.height,{steps:5});await page.mouse.up();await b('阅读').click();await expect(page.getByTestId('save-status')).toHaveText('已保存');let saved=await(await http.get(url)).json();expect(saved.snapshot.annotations.filter(a=>a.kind==='ink')).toHaveLength(1)
   if(await b('整笔橡皮擦').getAttribute('aria-pressed')!=='true')await b('整笔橡皮擦').click();box=await page.locator('.rl-page').boundingBox();await page.mouse.move(box.x+.4*box.width,box.y+.25*box.height);await page.mouse.down();await page.mouse.move(box.x+.8*box.width,box.y+.25*box.height);await page.mouse.up();await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await expect(page.getByTestId('save-status')).toHaveText('已保存');saved=await(await http.get(url)).json();expect(saved.snapshot.annotations.filter(a=>a.kind==='ink')).toHaveLength(0)
   await b('撤销').click();await expect(page.locator('[data-annotation] polyline')).toHaveCount(1);await expect(page.getByTestId('save-status')).toHaveText('已保存');const clean=await browser.newContext({viewport:{width:1024,height:768}}),second=await clean.newPage();await second.goto(page.url());await expect(second.locator('.rl-page')).toHaveAttribute('data-ready','true');await expect(second.locator('[data-annotation] polyline')).toHaveCount(1)
   await second.getByRole('button',{name:'整笔橡皮擦',exact:true}).click();box=await second.locator('.rl-page').boundingBox();await second.mouse.move(box.x+.4*box.width,box.y+.25*box.height);await second.mouse.down();await second.mouse.move(box.x+.8*box.width,box.y+.25*box.height);await second.mouse.up();await expect(second.getByTestId('save-status')).toHaveText('已保存')
   if(await b('整笔橡皮擦').getAttribute('aria-pressed')!=='true')await b('整笔橡皮擦').click();box=await page.locator('.rl-page').boundingBox();await page.mouse.move(box.x+.4*box.width,box.y+.25*box.height);await page.mouse.down();await page.mouse.move(box.x+.8*box.width,box.y+.25*box.height);await page.mouse.up();await expect(page.getByTestId('save-status')).toHaveText('保存失败');await expect(page.getByRole('alert')).toContainText('其他窗口');await page.screenshot({path:path.join(evidence,channel+'-erase-conflict.png')});await page.getByRole('row',{name:course.name,exact:true}).click();expect(page.url()).toContain('/reader?source=');await expect(page.getByRole('alert')).toContainText('尚未保存')
   page.once('dialog',d=>d.accept());await b('重新载入服务器版本').click();await expect(page.locator('.rl-page')).toHaveAttribute('data-ready','true');await expect(page.locator('[data-annotation] polyline')).toHaveCount(0);await page.getByRole('link',{name:'返回课程资料',exact:true}).click();await expect(page.getByRole('heading',{name:'课程资料',exact:true})).toBeVisible();await page.screenshot({path:path.join(evidence,channel+'-central-return.png')});expect(errors).toEqual([])
   results.push({channel,version:browser.version(),serverEraserRecovery:true,freshContext:true,casConflict:true,dirtyNavigationBlocked:true,centralReturn:true,errors});await clean.close();await context.close()
  }finally{await browser.close()}
 }
 writeFileSync(path.join(evidence,'live.json'),JSON.stringify({status:'passed',evidence,temp,courseId:course.id,sourceId:source.id,results},null,2));console.log(JSON.stringify({status:'passed',evidence,results},null,2))
}finally{await http?.dispose();for(const p of children)p.kill();for(const fd of logs)closeSync(fd)}
