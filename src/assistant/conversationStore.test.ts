import {describe,it,expect,vi,afterEach} from 'vitest'
import {ConversationStore,conversationTitle} from './conversationStore'
import {WorkspaceError} from './workspace'
import type {Topic,BindingInput} from './workspace'
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
function fixture(){let t:Topic|null=null;const calls:{path:string;method:string;body:any}[]=[];let fail=false;const receipts=new Map<string,Topic>();const api=vi.fn(async(_course:string,path:string,method='GET',body?:any)=>{calls.push({path,method,body});if(method==='GET'){if(path==='/topics')return {items:t?[t]:[],next_offset:null,read_only:false};return structuredClone(t)}if(fail)throw new TypeError('offline');if(receipts.has(body.command_id))return receipts.get(body.command_id);if(path==='/topics')t={schema_version:2,id:'t1',course_id:'c1',title:body.title,mode:'independent',item_ids:[],revision:1,context_revision:0,text:'',bindings:[],binding_count:0,read_only:false,legacy_origin:null};else{if(t!.revision!==body.expected_revision)throw new WorkspaceError(409,'revision_conflict','changed');t={...t!,revision:t!.revision+1,...(path.endsWith('/composer')?{text:body.text}:{})}}receipts.set(body.command_id,structuredClone(t!));return structuredClone(t)});return {api:api as any,calls,fail:(v:boolean)=>fail=v,topic:()=>t}}
describe('FE-V09 lazy autosave controller',()=>{
 it('opening and empty new conversations perform no writes',async()=>{const f=fixture(),s=new ConversationStore('c1',f.api);await s.initialize();s.newConversation();s.newConversation();await s.flush();expect(f.calls.filter(c=>c.method!=='GET')).toHaveLength(0);expect(s.getSnapshot().drafts).toHaveLength(1)})
 it('debounces editing and lazily creates exactly one topic',async()=>{vi.useFakeTimers();const f=fixture(),s=new ConversationStore('c1',f.api);s.edit('第一段');s.edit('最后的中文问题');await vi.advanceTimersByTimeAsync(599);expect(f.calls).toHaveLength(0);await vi.advanceTimersByTimeAsync(1);await s.flush();expect(f.calls.map(c=>c.method)).toEqual(['POST','PUT']);expect(f.topic()?.text).toBe('最后的中文问题')})
 it('retains input edited while an acknowledgement is pending',async()=>{const f=fixture();let release:()=>void=()=>{};const gate=new Promise<void>(r=>release=r);let held=true;const api=async(...args:any[])=>{if(held&&args[1].endsWith('/composer')){held=false;await gate}return f.api(...args)};const s=new ConversationStore('c1',api as any);s.edit('第一版');const saving=s.flush();await vi.waitFor(()=>expect(held).toBe(false));s.edit('回执期间第二版');release();await saving;expect(s.current().text).toBe('回执期间第二版');expect(f.topic()?.text).toBe('回执期间第二版');expect(f.calls.filter(c=>c.method==='POST')).toHaveLength(1)})
 it('retries with the original command and stops after failure',async()=>{const f=fixture(),s=new ConversationStore('c1',f.api);f.fail(true);s.edit('不能丢');await expect(s.flush()).rejects.toThrow();const original=s.current().pending?.body.command_id;expect(s.current().status).toBe('failed');f.fail(false);await s.retry();expect(f.calls.filter(c=>c.method==='POST').map(c=>c.body.command_id)).toEqual([original,original]);expect(f.topic()?.text).toBe('不能丢')})
 it('keeps new local drafts distinct and uses deterministic titles',async()=>{const f=fixture(),s=new ConversationStore('c1',f.api);s.edit('第一份');await s.flush();const old=s.current().key;s.newConversation();expect(s.current().text).toBe('');s.selectLocal(old);expect(s.current().text).toBe('第一份');expect(conversationTitle('  互斥与同步\n第二行')).toBe('互斥与同步')})
 it('keeps failure stopped while editing newer text until explicit retry',async()=>{const f=fixture(),s=new ConversationStore('c1',f.api);s.edit('第一版');await s.flush();f.fail(true);s.edit('断网时保存');await expect(s.flush()).rejects.toThrow();const id=s.current().pending?.body.command_id;s.edit('失败后继续编辑');expect(s.current().status).toBe('failed');f.fail(false);await s.retry();expect(s.current().text).toBe('失败后继续编辑');expect(f.topic()?.text).toBe('失败后继续编辑');expect(f.calls.filter(c=>c.body?.command_id===id)).toHaveLength(2)})
 it('does not let a delayed history read replace a newer conversation',async()=>{const f=fixture(),s=new ConversationStore('c1',f.api);s.edit('历史');await s.flush();const topic=f.topic()!;let release:(value:Topic)=>void=()=>{};const delayed=new Promise<Topic>(r=>release=r);const api=async(_c:string,path:string)=>path==='/topics/'+topic.id?delayed:{items:[],next_offset:null,read_only:false};const next=new ConversationStore('c1',api as any);const reading=next.open(topic.id);next.edit('另一个新的问题');release(topic);await reading;expect(next.current().text).toBe('另一个新的问题')})
})

// Multiple persisted topics expose accidental moves or bindings against the wrong draft.
function taskFixture(){
 const topics=new Map<string,Topic>(),calls:{path:string;method:string;body:any}[]=[]
 let offline=false,sequence=0
 const api=async(_course:string,path:string,method='GET',body?:any)=>{
  calls.push({path,method,body})
  if(path.startsWith('/items/')&&method==='GET')return {id:path.split('/')[2],task_id:path.split('/')[2].slice(5)}
  if(method==='GET')return structuredClone(topics.get(path.split('/')[2]))
  if(offline)throw new TypeError('offline')
  if(path==='/items')return {id:'item-'+body.task_id,title:'公开题目',task_id:body.task_id,session_id:body.session_id}
  if(path==='/topics'){
   const t:Topic={schema_version:2,id:'topic-'+(++sequence),course_id:'c1',title:body.title,mode:body.mode,item_ids:body.item_ids,revision:1,context_revision:0,text:'',bindings:[],binding_count:0,read_only:false,legacy_origin:null}
   topics.set(t.id,t);return structuredClone(t)
  }
  const t=topics.get(path.split('/')[2])!
  if(t.revision!==body.expected_revision)throw new WorkspaceError(409,'revision_conflict','changed')
  if(path.endsWith('/composer'))t.text=body.text
  else if(path.endsWith('/bindings')){if(body.replace_id&&!t.bindings.some(b=>b.id===body.replace_id))throw new Error('Unknown replacement');t.bindings.push({...body.binding,id:'binding-'+t.bindings.length,title:body.binding.task_id,text:'公开题干',confirmed:true,supersedes:null,provenance:'public'});t.binding_count=t.bindings.length}
  else {if(body.mode)t.mode=body.mode;if(body.item_ids)t.item_ids=body.item_ids}
  t.revision++;return structuredClone(t)
 }
 return {api:api as any,calls,topics,fail:(v:boolean)=>offline=v}
}
const taskBinding=(id:string):BindingInput=>({role:'question',session_id:'session',task_id:id})
describe('FE-V09 explicit task attachment',()=>{
 it('reconciles a lost acknowledgement before creating a different task',async()=>{
  const f=taskFixture();let lose=true
  const api=async(...args:any[])=>{const result=await f.api(...args);if(lose&&args[1]==='/items'){lose=false;throw new TypeError('lost acknowledgement')}return result}
  const s=new ConversationStore('c1',api as any)
  await expect(s.ensureTask(taskBinding('q1'))).rejects.toThrow('lost acknowledgement')
  expect((await s.ensureTask(taskBinding('q2'))).task_id).toBe('q2')
  const calls=f.calls.filter(c=>c.path==='/items')
  expect(calls.map(c=>c.body.task_id)).toEqual(['q1','q1','q2'])
  expect(calls[1].body.command_id).toBe(calls[0].body.command_id)
  expect(calls[2].body.command_id).not.toBe(calls[0].body.command_id)
 })
 it('reuses the exact command when retrying the same task with another attachment role',async()=>{
  const f=taskFixture();let lose=true
  const api=async(...args:any[])=>{const result=await f.api(...args);if(lose&&args[1]==='/items'){lose=false;throw new TypeError('lost acknowledgement')}return result}
  const s=new ConversationStore('c1',api as any)
  await expect(s.ensureTask(taskBinding('q1'))).rejects.toThrow()
  expect((await s.ensureTask({...taskBinding('q1'),role:'student_work'})).task_id).toBe('q1')
  const calls=f.calls.filter(c=>c.path==='/items');expect(calls).toHaveLength(2);expect(calls[1].body).toEqual(calls[0].body)
 })
 it('does not dispatch a new task while the old acknowledgement remains uncertain',async()=>{
  const f=taskFixture();const api=async(...args:any[])=>{if(args[1]==='/items'){await f.api(...args);throw new TypeError('offline')}return f.api(...args)}
  const s=new ConversationStore('c1',api as any)
  await expect(s.ensureTask(taskBinding('q1'))).rejects.toThrow()
  await expect(s.ensureTask(taskBinding('q2'))).rejects.toThrow()
  expect(f.calls.filter(c=>c.path==='/items').map(c=>c.body.task_id)).toEqual(['q1','q1'])
 })
 it('rejects a response belonging to another task or session before attaching',async()=>{
  for(const mismatch of [{task_id:'other'},{session_id:'other'}]){
   const f=taskFixture();const api=async(...args:any[])=>{const result=await f.api(...args);return args[1]==='/items'?{...result,...mismatch}:result}
   const s=new ConversationStore('c1',api as any)
   await expect(s.attachTask(taskBinding('q1'))).rejects.toThrow('保存结果与请求的题目不一致')
   expect(s.current().bindings).toHaveLength(0);expect(f.calls.some(c=>c.path.endsWith('/bindings'))).toBe(false)
  }
 })
 it('blocks changed attention payloads until the original revisioned command is confirmed',async()=>{
  const calls:any[]=[];let lose=true
  const api=async(_c:string,path:string,_m:string,body:any)=>{calls.push({path,body});if(lose){lose=false;throw new TypeError('lost acknowledgement')}return {id:'i1',revision:2,attention:body.attention}}
  const s=new ConversationStore('c1',api as any),item={id:'i1',revision:1} as any
  await expect(s.attention(item,'paused')).rejects.toThrow()
  await expect(s.attention(item,'finished')).rejects.toThrow('请先重试原操作')
  expect(calls).toHaveLength(1)
  const recovered=await s.attention(item,'paused')
  expect((await s.attention(recovered,'finished')).attention).toBe('finished')
  expect(calls.map(c=>c.body.attention)).toEqual(['paused','paused','finished'])
  expect(calls[0].body.command_id).toBe(calls[1].body.command_id)
  expect(calls[2].body.expected_revision).toBe(2)
 })
 it('saves pending text before attaching and reuses the same task target',async()=>{
  const f=taskFixture(),s=new ConversationStore('c1',f.api)
  s.edit('还没自动保存的问题');await s.attachTask(taskBinding('q1'))
  const id=s.current().topic!.id;s.edit('继续写下的新正文');await s.attachTask(taskBinding('q1'))
  expect(s.current().topic!.id).toBe(id);expect(f.topics.get(id)!.text).toBe('继续写下的新正文')
  expect(s.current().topic!.item_ids).toEqual(['item-q1']);expect(s.current().topic!.mode).toBe('single')
  const last=f.calls.map(c=>c.path.endsWith('/bindings')).lastIndexOf(true)
  expect(f.calls.slice(0,last).reverse().find(c=>c.method==='PUT')?.body.text).toBe('继续写下的新正文')
 })
 it('requires a choice on question change and preserves the original when starting new',async()=>{
  const f=taskFixture(),s=new ConversationStore('c1',f.api);s.edit('第一题的讨论');await s.attachTask(taskBinding('q1'))
  const original=s.current().topic!.id;s.edit('第一题待保存补充')
  await expect(s.attachTask(taskBinding('q2'))).rejects.toThrow('请选择')
  expect(s.current().topic!.id).toBe(original)
  await s.attachTask(taskBinding('q2'),'new',s.current().bindings[0].id)
  expect(s.current().topic!.id).not.toBe(original);expect(s.current().text).toBe('');expect(s.current().topic!.item_ids).toEqual(['item-q2'])
  expect(f.topics.get(original)!.text).toBe('第一题待保存补充');expect(f.topics.get(original)!.bindings.map(b=>b.task_id)).toEqual(['q1'])
  expect(s.current().bindings.map(b=>b.task_id)).toEqual(['q2'])
 })
 it('compares only after explicit choice and retains both attachments and text',async()=>{
  const f=taskFixture(),s=new ConversationStore('c1',f.api);s.edit('比较两个思路');await s.attachTask(taskBinding('q1'))
  const id=s.current().topic!.id;await s.attachTask(taskBinding('q2'),'compare')
  expect(s.current().topic!.id).toBe(id);expect(s.current().topic!.mode).toBe('compare');expect(s.current().topic!.item_ids).toEqual(['item-q1','item-q2'])
  expect(s.current().text).toBe('比较两个思路');expect(s.current().bindings.map(b=>b.task_id)).toEqual(['q1','q2'])
 })
 it('keeps attachment destination stable during a delayed target lookup',async()=>{
  const f=taskFixture();let release:()=>void=()=>{};let hold=false,entered=false
  const api=async(...args:any[])=>{if(hold&&args[1].startsWith('/items/')&&(args[2]||'GET')==='GET'){entered=true;await new Promise<void>(r=>release=r)}return f.api(...args)}
  const s=new ConversationStore('c1',api as any);s.edit('原对话');await s.attachTask(taskBinding('q1'));const original=s.current().key
  hold=true;const adding=s.attachTask(taskBinding('q1'));await vi.waitFor(()=>expect(entered).toBe(true));s.newConversation();const blank=s.current().key;release();await adding
  expect(s.current().key).toBe(blank);expect(s.current().topic).toBeNull();s.selectLocal(original);expect(s.current().bindings).toHaveLength(2)
 })
 it('stops on text-save failure and allows explicit retry before attachment',async()=>{
  const f=taskFixture(),s=new ConversationStore('c1',f.api);s.edit('原问题');await s.flush();f.fail(true);s.edit('断网时的补充')
  await expect(s.attachTask(taskBinding('q1'))).rejects.toThrow('offline');expect(f.calls.some(c=>c.path==='/items'||c.path.endsWith('/bindings'))).toBe(false);expect(s.current().text).toBe('断网时的补充')
  f.fail(false);await s.retry();await s.attachTask(taskBinding('q1'));expect(s.current().text).toBe('断网时的补充');expect(s.current().bindings).toHaveLength(1)
 })
})

function generationFixture(){
 const base=fixture(),requests:any[]=[],queries:string[]=[];let lost=false,gate:Promise<void>|undefined,lookup:any=null,queryGate:Promise<void>|undefined
 const api=async(course:string,path:string,method='GET',body?:any)=>{
  if(path==='/capabilities')return {enabled:true,mocked:true,reason:'',task_support:true}
  if(path.startsWith('/requests/')&&method==='GET'){queries.push(path);if(queryGate)await queryGate;if(lookup instanceof Error)throw lookup;if(lookup)return lookup;throw new WorkspaceError(404,'not_found','not found')}
  if(path.endsWith('/requests')){requests.push(body);if(gate)await gate;if(lost){lost=false;throw new TypeError('lost acceptance')}return {request_id:body.request_id,topic_id:'t1',state:'published',revision:1,notices:[],needs:'',mocked:true}}
  if(path.includes('/messages'))return {items:[],requests:[],next_after:null}
  return base.api(course,path,method,body)
 }
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)})
 return {...base,api:api as any,requests,queries,lookup:(value:any)=>lookup=value,holdQuery:(p:Promise<void>)=>queryGate=p,lose:()=>lost=true,hold:(p:Promise<void>)=>gate=p,storage}
}
describe('FE-V10 frozen send controller',()=>{
 it.each(['running','error'])('ignores an older late message read: %s',async(result)=>{
  vi.useFakeTimers();const f=generationFixture();let hold=false,entered=false,resolve:(value:any)=>void=()=>{},reject:(error:Error)=>void=()=>{}
  const api=async(...args:any[])=>{
   if(hold&&args[1].includes('/messages')){
    if(!entered){entered=true;return new Promise((ok,no)=>{resolve=ok;reject=no})}
    return {items:[{id:2,text:'新回答'}],requests:[{request_id:'r',state:'published',revision:2,notices:[]}],next_after:null}
   }
   return f.api(...args)
  }
  const s=new ConversationStore('c1',api as any);s.edit('保存对话');await s.flush();hold=true
  const old=s.refreshMessages();await vi.waitFor(()=>expect(entered).toBe(true));await s.refreshMessages()
  if(result==='error')reject(new TypeError('old offline'));else resolve({items:[{id:1,text:'旧回答'}],requests:[{request_id:'r',state:'running',revision:1}],next_after:null})
  await old
  expect(s.current().messages?.[0].text).toBe('新回答');expect(s.current().requests?.[0].state).toBe('published');expect(s.current().messageError).toBe('')
  expect(vi.getTimerCount()).toBe(0)
 })
 it('queries an existing request without reposting and retains a newer draft',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.lose();s.edit('原问题')
  await expect(s.send(s.current().key,undefined,'short',undefined,'step')).rejects.toThrow()
  const pending=s.current().sendPending!;s.edit('后续问题')
  f.lookup({request_id:pending.request_id,topic_id:'t1',state:'published',revision:2,notices:[],needs:'',mocked:true})
  await s.retryAcceptance()
  expect(f.queries).toEqual(['/requests/'+pending.request_id]);expect(f.requests).toHaveLength(1)
  expect(s.current().text).toBe('后续问题');expect(s.current().sendPending).toBeUndefined()
 })
 it.each([new TypeError('offline'),new WorkspaceError(503,'busy','busy'),new WorkspaceError(403,'denied','denied')])('does not repost after a failed query: %s',async(error)=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.lose();s.edit('保留的问题');await expect(s.send()).rejects.toThrow()
  const pending=s.current().sendPending!;f.lookup(error);await expect(s.retryAcceptance()).rejects.toThrow()
  expect(f.requests).toHaveLength(1);expect(s.current().sendPending).toEqual(pending);expect(s.current().text).toBe('保留的问题')
 })
 it('retains the original request when a lookup returns another topic or request',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.lose();s.edit('原问题');await expect(s.send()).rejects.toThrow()
  const pending=s.current().sendPending!
  for(const mismatch of [{request_id:'other',topic_id:'t1'},{request_id:pending.request_id,topic_id:'other'}]){
   f.lookup({...mismatch,state:'published'});await expect(s.retryAcceptance()).rejects.toThrow('不一致')
   expect(s.current().sendPending).toEqual(pending);expect(f.requests).toHaveLength(1)
  }
 })
 it('coalesces repeated query clicks and falls back only after explicit 404',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.lose();s.edit('原问题');await expect(s.send()).rejects.toThrow()
  let release:()=>void=()=>{};f.holdQuery(new Promise<void>(resolve=>release=resolve))
  const first=s.retryAcceptance();const second=s.retryAcceptance();await vi.waitFor(()=>expect(f.queries).toHaveLength(1));release();await Promise.all([first,second])
  expect(f.requests).toHaveLength(2);expect(f.requests[0]).toEqual(f.requests[1]);expect(f.queries).toHaveLength(1)
 })
 it('freezes help mode across lost acknowledgement and keeps pause draft',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();s.edit('保留这条未发送的问题');await s.flush();f.lose()
  await expect(s.send(s.current().key,undefined,'short',undefined,'different')).rejects.toThrow('lost acceptance')
  expect(s.current().sendPending?.support_mode).toBe('different');await s.retryAcceptance()
  expect(f.requests[0]).toEqual(f.requests[1])
  s.edit('下一条未发送草稿');await s.send(s.current().key,undefined,'short',undefined,'pause')
  expect(f.requests.at(-1).support_mode).toBe('pause');expect(f.requests.at(-1).text).toBe('暂停本轮讲解');expect(s.current().text).toBe('下一条未发送草稿')
 })
 it('saves before accepting, sends once and clears only acknowledged text',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();s.edit('冻结的问题');await s.send()
  expect(f.topic()?.text).toBe('');expect(s.current().text).toBe('');expect(f.requests).toHaveLength(1);expect(f.requests[0].text).toBe('冻结的问题')
  expect(f.calls.find(c=>c.method==='PUT')?.body.text).toBe('冻结的问题')
 })
 it('keeps newer input and rejects a second click while acceptance is pending',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();let release:()=>void=()=>{};f.hold(new Promise<void>(r=>release=r));s.edit('原问题');const sending=s.send();await vi.waitFor(()=>expect(f.requests).toHaveLength(1));s.edit('下一条草稿')
  await expect(s.send()).rejects.toThrow('尚未确认');release();await sending;expect(s.current().text).toBe('下一条草稿');expect(f.requests).toHaveLength(1)
 })
 it('never accepts after composer save failure',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.fail(true);s.edit('不能丢');await expect(s.send()).rejects.toThrow();expect(f.requests).toHaveLength(0);expect(s.current().text).toBe('不能丢')
 })
 it('reuses the complete frozen intent after lost acceptance and restores it across reload',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();f.lose();s.edit('原问题');await expect(s.send()).rejects.toThrow('lost acceptance');const pending=s.current().sendPending!;s.edit('新草稿')
  const restored=new ConversationStore('c1',f.api);await restored.open('t1');expect(restored.current().sendPending).toEqual(pending)
  await s.retryAcceptance();expect(f.requests[0]).toEqual(f.requests[1]);expect(s.current().text).toBe('新草稿');expect(s.current().sendPending).toBeUndefined()
 })
 it('preserves original request destination when another draft is selected',async()=>{
  const f=generationFixture(),s=new ConversationStore('c1',f.api);await s.refreshCapabilities();s.edit('原对话的问题');const original=s.current().key;let release:()=>void=()=>{};f.hold(new Promise<void>(r=>release=r));const sending=s.send();await vi.waitFor(()=>expect(f.requests).toHaveLength(1));s.newConversation();const next=s.current().key;s.edit('新对话草稿');release();await sending
  expect(s.current().key).toBe(next);expect(s.current().text).toBe('新对话草稿');s.selectLocal(original);expect(s.current().text).toBe('');expect(f.requests).toHaveLength(1)
 })
})
