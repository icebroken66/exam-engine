/** FE-V09 repair acceptance: isolated SQLite, real API, no model dispatch. Build first. */
import {spawn,spawnSync} from 'node:child_process'
import {mkdirSync,mkdtempSync,openSync,closeSync,readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {chromium,expect,request} from '@playwright/test'
const evidence=path.resolve('data/acceptance-fev09/repairs-'+Date.now()),temp=mkdtempSync(path.join(os.tmpdir(),'fev09-repairs-'))
mkdirSync(evidence,{recursive:true})
const apiPort=8036,webPort=7206,base='http://127.0.0.1:'+webPort,python=path.resolve('.venv/Scripts/python.exe')
const env={...process.env,MODEL_PROVIDER:'mock',EXAM_ENGINE_DATA_DIR:temp,DATABASE_URL:'sqlite:///'+path.join(temp,'test.db').split(path.sep).join('/'),EXAM_ENGINE_API_URL:'http://127.0.0.1:'+apiPort,PYTHONUTF8:'1',FEV08_ISOLATED_FIXTURE:'1'}
for(const key of Object.keys(env))if(/^(OPENAI_|MODEL_(?!PROVIDER)|PYTHONPATH$)/i.test(key))delete env[key]
const children=[],fds=[],results=[];let http,browser,page
function start(exe,args,name){const fd=openSync(path.join(evidence,name+'.log'),'a');fds.push(fd);const child=spawn(exe,args,{env,windowsHide:true,stdio:['ignore',fd,fd]});children.push(child)}
const bootstrap="import sys;sys.path.insert(0,'backend')\nfrom app.main import create_app\nfrom app.model_gateway import ModelGateway\ndef forbidden(*a,**k):\n raise RuntimeError('FEV09_GATEWAY_FORBIDDEN')\nModelGateway.generate_json=forbidden\napp=create_app()\nimport uvicorn\nuvicorn.run(app,host='127.0.0.1',port="+apiPort+")"
const b=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByLabel('向助手提问',{exact:true}),saved=()=>expect(page.getByTestId('conversation-save-state')).toHaveText('已保存')
async function json(response){expect(response.ok(),await response.text()).toBe(true);return response.json()}
async function download(name){const waiting=page.waitForEvent('download');await b(name).click();const stream=await(await waiting).createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString())}
try{
 start(python,['-c',bootstrap],'api');start(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(webPort),'--strictPort'],'web')
 http=await request.newContext({baseURL:base});await expect.poll(async()=>{try{return(await http.get('/api/health')).status()}catch{return 0}},{timeout:30000}).toBe(200)
 const course=await json(await http.post('/api/courses',{data:{school:'公开样本',name:'FE-V09修复验收'}}))
 await json(await http.post('/api/courses/'+course.id+'/sources',{multipart:{rights_confirmed:'true',file:{name:'公开样本.pdf',mimeType:'application/pdf',buffer:readFileSync('tests/fixtures/reader/mixed.pdf')}}}))
 const seed=spawnSync(python,['scripts/fev08_public_fixture.py'],{env,encoding:'utf8',windowsHide:true});expect(seed.status,seed.stderr).toBe(0);const fixture=JSON.parse(seed.stdout)[0],root='/api/courses/'+course.id+'/assistant/v2'
 const snapshotCode="import sys,json;sys.path.insert(0,'backend');from app.database import SessionLocal;from app.models import LearningSession,LearningTask,LearningAttempt,LearningEvent,TutoringTurn,UsageRecord,AssistantSnapshot;from sqlalchemy import select;db=SessionLocal();print(json.dumps({m.__tablename__:[{c.name:str(getattr(r,c.name)) for c in m.__table__.columns} for r in db.scalars(select(m).order_by(list(m.__table__.primary_key)[0]))] for m in (LearningSession,LearningTask,LearningAttempt,LearningEvent,TutoringTurn,UsageRecord,AssistantSnapshot)},sort_keys=True));db.close()"
 const formal=()=>{const r=spawnSync(python,['-c',snapshotCode],{env,encoding:'utf8',windowsHide:true});expect(r.status,r.stderr).toBe(0);return r.stdout.trim()}
 const before=formal();writeFileSync(path.join(evidence,'formal-before.json'),before)
 browser=await chromium.launch({channel:'msedge'});page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],writes=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(new URL(r.url()).pathname)})
 async function learn(session){await page.goto(base+'/#/courses/'+course.id+'/learn?session='+session);if(!await input().isVisible())await b('AI 学习助手').click();await expect(input()).toBeEditable()}
 await learn(fixture.session_id)
 await page.route('**/assistant/v2/topics',r=>r.request().method()==='POST'?r.abort('failed'):r.continue())
 const text='首次保存失败也能从历史找回';await input().fill(text);await expect(page.getByRole('alert')).toContainText('尚未保存')
 await b('新对话').click();await b('对话历史').click();const local=page.locator('.cp-history-row').filter({hasText:text});await expect(local).toContainText('仅保留在此页面');await local.click();await expect(input()).toHaveValue(text)
 expect((await download('导出当前内容')).draft.text).toBe(text);await page.screenshot({path:path.join(evidence,'draft-recovered.png')})
 await page.unroute('**/assistant/v2/topics');await b('重试保存').click();await saved();results.push('首次POST失败：新对话→历史→恢复→导出→重试成功')
 let loseComposer=true
 await page.route('**/assistant/v2/topics/*/composer',async r=>{if(loseComposer){loseComposer=false;await r.fetch();await r.abort('failed')}else await r.continue()})
 await input().fill('服务端已保存但响应丢失');await expect(page.getByRole('alert')).toContainText('尚未保存');await b('新对话').click();await b('对话历史').click();await page.locator('.cp-history-row').filter({hasText:text}).click();await expect(input()).toHaveValue('服务端已保存但响应丢失');await b('重试保存').click();await saved();await page.unroute('**/assistant/v2/topics/*/composer');results.push('已存主题PUT丢回执：历史恢复与幂等重试')
 async function choose(label){await b('添加内容').click();await b(label).click();await expect(page.getByLabel('添加内容预览')).toBeVisible()}
 await b('新对话').click();await choose('附带本题');await b('取消').click();await expect(page.getByLabel('添加内容预览')).toHaveCount(0)
 await choose('附带本题');await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(1)
 await choose('附带已提交作答');await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(2)
 await choose('附带已显示反馈');await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(3);await saved();results.push('真实练习页：取消、本题、已提交作答、已显示反馈')
 const topics=(await json(await http.get(root+'/topics'))).items;const original=topics.find(t=>t.binding_count===3);expect(original).toBeTruthy()
 await learn(fixture.draft_session_id);await page.locator('#formal-answer textarea').fill('明确交给助手的纸笔思路文字')
 await choose('附带当前作答');await b('明确比较两题').click();await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(4);await saved()
 const compared=await json(await http.get(root+'/topics/'+original.id));expect(compared.mode).toBe('compare');expect(compared.item_ids).toHaveLength(2);expect(compared.bindings.map(x=>x.role)).toEqual(['question','submitted_answer','visible_feedback','student_work']);expect(JSON.stringify(compared)).not.toContain('PRIVATE_');results.push('明确比较两题、未提交作答快照、隐藏答案不纳入')
 await b('新对话').click();await choose('附带本题');await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(1);await saved()
 await learn(fixture.session_id);await choose('附带本题');await b('在新对话中添加').click();await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(1);await saved();results.push('异题经明确选择新建对话，原比较内容保留')
 // A fresh store isolates an unacknowledged WorkItem creation from all previous state.
 await page.reload();await expect(input()).toBeEditable();await b('新对话').click();let lost=false;const itemCalls=[]
 await page.route('**/assistant/v2/items',async r=>{if(r.request().method()!=='POST')return r.continue();itemCalls.push(r.request().postDataJSON());if(!lost){lost=true;await r.fetch();await r.abort('failed')}else await r.continue()})
 await choose('附带本题');await b('添加').click();await expect(page.getByLabel('添加内容预览')).toBeVisible();await expect(page.locator('.cp-notice')).toBeVisible();await b('取消').click()
 await learn(fixture.draft_session_id);await choose('附带本题');await b('添加').click();await expect(page.locator('.cp-attachment')).toHaveCount(1);await saved()
 expect(itemCalls.map(c=>c.task_id)).toEqual([fixture.task_ids[0],fixture.task_ids[0],fixture.draft_task_id]);expect(itemCalls[0].command_id).toBe(itemCalls[1].command_id);expect(itemCalls[2].command_id).not.toBe(itemCalls[0].command_id)
 const finalTopics=(await json(await http.get(root+'/topics'))).items;const details=await Promise.all(finalTopics.map(t=>http.get(root+'/topics/'+t.id).then(json)));const final=details.find(t=>t.id!==original.id&&t.bindings.length===1&&t.bindings[0].task_id===fixture.draft_task_id);expect(final).toBeTruthy();expect(final.item_ids).toHaveLength(1);await page.screenshot({path:path.join(evidence,'task-isolated.png')});results.push('真实API事项已执行但丢回执：先确认原命令，再正确附带新题')
 const after=formal();writeFileSync(path.join(evidence,'formal-after.json'),after);expect(after).toBe(before);expect(writes.filter(p=>/tutoring|preflight|attempts|manifest/.test(p))).toEqual([]);expect(errors).toEqual([]);results.push('正式学习、提交、帮助、用量数据无变化；无页面错误或模型调用')
 writeFileSync(path.join(evidence,'results.json'),JSON.stringify({status:'passed',results,errors,browser:browser.version(),fixture},null,2));console.log(JSON.stringify({status:'passed',evidence,results},null,2))
}catch(error){if(page)await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});writeFileSync(path.join(evidence,'failure.txt'),String(error.stack||error));console.error('Evidence:',evidence);throw error}
finally{await browser?.close();await http?.dispose();for(const child of children)if(child.pid)spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});for(const fd of fds)closeSync(fd)}
