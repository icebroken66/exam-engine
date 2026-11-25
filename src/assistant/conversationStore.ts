/** FE-V09 review controller: one in-flight write, lazy topics, stable command retries. */
import {command,workspaceApi,WorkspaceError} from './workspace'
import {isActiveRequest,isBlockingRequest} from './generation'
import {ASSISTANT_LEARNING_CHANGED} from './learningSync'
import type {Capabilities,GenerationRequest,ConversationMessage,MessagePage,RequestIntent,Citation,SavedExplanation,SavedExplanationPage,SupportMode} from './generation'
import type {Binding,BindingInput,Page,Topic,TopicSummary,WorkItem,Bookmark} from './workspace'

export type SaveStatus='local'|'waiting'|'saving'|'saved'|'failed'|'conflict'
export type ConversationDraft={key:string;topic:Topic|null;text:string;bindings:Binding[];status:SaveStatus;error:string;edit:number;pending?:{path:string;method:string;body:Record<string,unknown>};updated:string;titleOverride?:string;messages?:ConversationMessage[];requests?:GenerationRequest[];sending?:boolean;sendError?:string;messageError?:string;sendPending?:RequestIntent}
type State={drafts:ConversationDraft[];selected:string;history:TopicSummary[];nextOffset:number|null;loading:boolean;loadError:string;readOnly:boolean;capabilities?:Capabilities}
export type WorkspaceTransport=<T>(course:string,path:string,method?:string,body?:unknown)=>Promise<T>
export const AUTO_SAVE_DELAY=600
export function conversationTitle(text:string){return text.trim().split(/[\r\n]/)[0].slice(0,32)||'新对话'}
// Command IDs identify deliveries; all other fields identify the requested operation.
function itemIntent(value:unknown):string{if(Array.isArray(value))return '['+value.map(itemIntent).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([key])=>key!=='command_id').sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+itemIntent(v)).join(',')+'}';return JSON.stringify(value)??'null'}
export class ConversationStore{
 private state:State={drafts:[],selected:'',history:[],nextOffset:null,loading:false,loadError:'',readOnly:false}
 private listeners=new Set<()=>void>();private timers=new Map<string,ReturnType<typeof setTimeout>>();private queue:Promise<unknown>=Promise.resolve();private initializing:Promise<void>|null=null;private selectionVersion=0;private polling=new Map<string,ReturnType<typeof setTimeout>>();private focusOnStart='';private itemPending?:{path:string;body:Record<string,unknown>}
 private outboxKey(topic:string){return 'exam-engine:assistant-request:v10:'+this.courseId+':'+topic}
 private messageReads=new Map<string,number>()
 private notifyLearningChanged(key:string){
  if(typeof window==='undefined')return
  const targets=this.draft(key).bindings.filter(b=>b.session_id&&b.task_id).map(b=>({session_id:b.session_id!,task_id:b.task_id!}))
  if(targets.length)window.dispatchEvent(new CustomEvent(ASSISTANT_LEARNING_CHANGED,{detail:{courseId:this.courseId,targets}}))
 }
 private restoreIntent(topic:string):RequestIntent|undefined{try{const value=JSON.parse(localStorage.getItem(this.outboxKey(topic))||'null');return value?.request_id&&typeof value.text==='string'?value:undefined}catch{return undefined}}
 constructor(readonly courseId:string,private api:WorkspaceTransport=workspaceApi){try{this.focusOnStart=localStorage.getItem('exam-engine:conversation-focus:v09:'+courseId)||localStorage.getItem('exam-engine:workspace-focus:v2:'+encodeURIComponent(courseId))||''}catch{}this.newConversation()}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 getSnapshot=()=>this.state
 private emit(patch:Partial<State>={}){this.state={...this.state,...patch};this.listeners.forEach(l=>l())}
 private draft(key=this.state.selected){const d=this.state.drafts.find(d=>d.key===key);if(!d)throw new Error('当前草稿不存在');return d}
 private patch(key:string,patch:Partial<ConversationDraft>){this.emit({drafts:this.state.drafts.map(d=>d.key===key?{...d,...patch}:d)})}
 current(){return this.draft()}
 hasUnsaved(){return this.state.drafts.some(d=>['waiting','saving','failed','conflict'].includes(d.status)||!!d.pending)}
 private enqueue<T>(fn:()=>Promise<T>):Promise<T>{const task=this.queue.then(fn,fn);this.queue=task.catch(()=>{});return task}
 private rememberFocus(key:string){try{localStorage.setItem('exam-engine:conversation-focus:v09:'+this.courseId,key)}catch{}}
 newConversation(){this.selectionVersion++;const previous=this.state.drafts.find(d=>d.key===this.state.selected);if(previous&&!previous.topic&&!previous.text&&!previous.bindings.length&&!previous.pending)return previous.key;const key='local-'+crypto.randomUUID();const draft:ConversationDraft={key,topic:null,text:'',bindings:[],status:'local',error:'',edit:0,updated:new Date().toISOString()};this.emit({drafts:[...this.state.drafts,draft],selected:key});this.rememberFocus(key);return key}
 async initialize(){if(this.initializing)return this.initializing;this.initializing=this.loadInitial();return this.initializing}
 async refreshCapabilities(){try{const capabilities=await this.api<Capabilities>(this.courseId,'/capabilities');if(typeof capabilities?.enabled==='boolean')this.emit({capabilities})}catch{this.emit({capabilities:{enabled:false,reason:'回答服务暂不可用，内容可先保存',mocked:false,task_support:false}})}}
 private async loadInitial(){if(this.courseId==='__workspace__'){this.emit({capabilities:{enabled:false,reason:'请先选择课程；当前内容仅保留在此页面',mocked:false,task_support:false}});return}void this.refreshCapabilities();const version=this.selectionVersion;this.emit({loading:true,loadError:''});try{const page=await this.api<Page<TopicSummary>>(this.courseId,'/topics');this.emit({history:page.items,nextOffset:page.next_offset,readOnly:page.read_only});const focus=this.focusOnStart;const untouched=!this.current().text&&!this.current().bindings.length&&version===this.selectionVersion;const target=page.items.find(t=>t.id===focus)||page.items[0];if(untouched&&focus&&!focus.startsWith('local-'))await this.open(focus);else if(untouched&&target&&!focus.startsWith('local-'))await this.open(target.id)}catch(e){this.emit({loadError:'暂时无法读取历史，当前输入仍可保留。'+this.message(e)})}finally{this.emit({loading:false})}}
 async refreshHistory(){this.initializing=null;await this.initialize()}
 clearLoadError(){this.emit({loadError:''})}
 async moreHistory(){if(this.state.nextOffset===null)return;const p=await this.api<Page<TopicSummary>>(this.courseId,'/topics?offset='+this.state.nextOffset);this.emit({history:[...this.state.history,...p.items.filter(t=>!this.state.history.some(h=>h.id===t.id))],nextOffset:p.next_offset})}
 async open(topicId:string){const selection=++this.selectionVersion,existing=this.state.drafts.find(d=>d.topic?.id===topicId);if(existing&&existing.status!=='saved'){this.emit({selected:existing.key});this.rememberFocus(topicId);void this.refreshMessages(existing.key);return}const topic=await this.api<Topic>(this.courseId,'/topics/'+encodeURIComponent(topicId));if(selection!==this.selectionVersion)return;const key=existing?.key||topic.id;const draft:ConversationDraft={...existing,key,topic,sendPending:this.restoreIntent(topic.id),text:topic.text,bindings:topic.bindings,status:'saved',error:'',edit:0,updated:new Date().toISOString()};this.emit({drafts:[...this.state.drafts.filter(d=>d.key!==key),draft],selected:key,readOnly:topic.read_only});this.rememberFocus(topic.id);void this.refreshMessages(key)}
 selectLocal(key:string){this.selectionVersion++;this.draft(key);this.emit({selected:key});this.rememberFocus(key)}
 edit(text:string){this.selectionVersion++;const d=this.current();if(this.state.readOnly)return;const stopped=d.status==='conflict'||d.status==='failed';this.patch(d.key,{text,edit:d.edit+1,error:stopped?d.error:'',status:stopped?d.status:'waiting',updated:new Date().toISOString()});clearTimeout(this.timers.get(d.key));if(!stopped)this.timers.set(d.key,setTimeout(()=>{void this.flush(d.key).catch(()=>{})},AUTO_SAVE_DELAY))}
 private message(error:unknown){return error instanceof Error?error.message:String(error)}
 private failed(key:string,error:unknown){const conflict=error instanceof WorkspaceError&&error.status===409;if(error instanceof WorkspaceError&&error.status===422)this.patch(key,{pending:undefined});this.patch(key,{status:conflict?'conflict':'failed',error:conflict?'另一窗口已更新或内容已失效，当前内容仍在。'+this.message(error):'尚未保存，内容仍在。'+this.message(error)})}
 private merge(key:string,topic:Topic,edit:number,savedText?:string){const d=this.draft(key),changed=d.edit!==edit||(d.pending?.path.endsWith('/composer')&&d.text!==d.pending.body.text);this.patch(key,{topic,bindings:topic.bindings,pending:undefined,text:changed?d.text:savedText??topic.text,status:changed?'waiting':'saved',error:'',updated:new Date().toISOString()});this.emit({history:[topic,...this.state.history.filter(t=>t.id!==topic.id)]});if(this.state.selected===key)this.rememberFocus(topic.id)}
 private async execute(key:string,pending:NonNullable<ConversationDraft['pending']>,edit:number){this.patch(key,{pending,status:'saving',error:''});try{const topic=await this.api<Topic>(this.courseId,pending.path,pending.method,pending.body);this.merge(key,topic,edit,pending.path==='/topics'?this.draft(key).text:undefined);return topic}catch(e){this.failed(key,e);throw e}}
 async flush(key=this.state.selected):Promise<void>{clearTimeout(this.timers.get(key));return this.enqueue(()=>this.saveUntilCurrent(key))}
 private async saveUntilCurrent(key:string){let d=this.draft(key);if(this.state.readOnly)throw new Error('课程已归档，内容只读');if(d.status==='conflict')throw new Error(d.error);if(d.status==='failed')throw new Error('保存尚未确认，请先重试');
  if(this.courseId==='__workspace__'){this.patch(key,{status:'failed',error:'尚未保存，内容仍在。请先选择课程；当前无课程草稿仅保留在此页面。'});throw new Error('请先选择课程')}
  if(d.pending){await this.execute(key,d.pending,d.edit);d=this.draft(key)}
  if(!d.topic){if(!d.text.trim()&&!d.bindings.length){this.patch(key,{status:'local'});return}const edit=d.edit;await this.execute(key,{path:'/topics',method:'POST',body:{...command(0),title:d.titleOverride||conversationTitle(d.text),mode:'independent',item_ids:[]}},edit);d=this.draft(key)}
  while(d.topic&&d.text!==d.topic.text){const edit=d.edit,text=d.text;await this.execute(key,{path:'/topics/'+d.topic.id+'/composer',method:'PUT',body:{...command(d.topic.revision),text}},edit);d=this.draft(key)}
  if(d.status==='waiting')this.patch(key,{status:'saved'})
 }
 async retry(key=this.state.selected){return this.enqueue(async()=>{const d=this.draft(key);if(d.status==='conflict')throw new Error('请先读取另一窗口版本');this.patch(key,{status:'waiting',error:''});const pending=d.pending;if(pending)await this.execute(key,pending,d.edit);await this.saveUntilCurrent(key)})}
 async reload(key=this.state.selected){return this.enqueue(async()=>{const d=this.draft(key);if(!d.topic){this.patch(key,{status:'local',pending:undefined,error:''});return}const t=await this.api<Topic>(this.courseId,'/topics/'+d.topic.id);this.patch(key,{topic:t,text:t.text,bindings:t.bindings,status:'saved',pending:undefined,error:'',edit:d.edit+1});this.emit({readOnly:t.read_only})})}
 async attach(binding:BindingInput,replaceId?:string,key=this.state.selected){await this.flush(key);return this.enqueue(async()=>{let d=this.draft(key);if(!d.topic){const edit=d.edit;await this.execute(key,{path:'/topics',method:'POST',body:{...command(0),title:'课件片段',mode:'independent',item_ids:[]}},edit);d=this.draft(key)}if(!d.topic)throw new Error('对话未建立');if(!replaceId&&d.bindings.length>=4)throw new Error('最多添加4项内容，请先移除一项');await this.execute(key,{path:'/topics/'+d.topic.id+'/bindings',method:'POST',body:{...command(d.topic.revision),confirmed:true,binding,...(replaceId?{replace_id:replaceId}:{})}},d.edit)})}
 async remove(bindingId:string,key=this.state.selected){await this.flush(key);return this.enqueue(async()=>{const d=this.draft(key);if(!d.topic)return;await this.execute(key,{path:'/topics/'+d.topic.id+'/bindings/'+bindingId,method:'DELETE',body:command(d.topic.revision)},d.edit)})}
 async rename(title:string,key=this.state.selected){const value=title.trim();if(!value||value.length>200)throw new Error('名称需为1至200字符');const current=this.draft(key);if(!current.topic&&!current.text.trim()){this.patch(key,{titleOverride:value});return}await this.flush(key);return this.enqueue(async()=>{const d=this.draft(key);if(d.topic)await this.execute(key,{path:'/topics/'+d.topic.id,method:'PATCH',body:{...command(d.topic.revision),title:value}},d.edit)})}
 private async deliverItem(pending:{path:string;body:Record<string,unknown>}){this.itemPending=pending;try{const item=await this.api<WorkItem>(this.courseId,pending.path,'POST',pending.body);if(pending.path==='/items'&&(item.task_id!==pending.body.task_id||item.session_id!==pending.body.session_id))throw new Error('保存结果与请求的题目不一致，请重试；尚未添加内容');this.itemPending=undefined;return item}catch(e){if(e instanceof WorkspaceError&&e.status<500)this.itemPending=undefined;throw e}}
 private async itemCommand(path:string,body:Record<string,unknown>){const pending=this.itemPending;if(pending){const same=pending.path===path&&itemIntent(pending.body)===itemIntent(body);if(!same&&(path!=='/items'||pending.path!=='/items'))throw new Error('上一项保存未确认，请先重试原操作');const recovered=await this.deliverItem(pending);if(same)return recovered}return this.deliverItem({path,body})}
 async listItems(offset=0){return this.api<Page<WorkItem>>(this.courseId,'/items?offset='+offset)}
 async attention(item:WorkItem,value:'ongoing'|'paused'|'finished',bookmark?:Bookmark){return this.enqueue(()=>this.itemCommand('/items/'+item.id+'/attention',{...command(item.revision),attention:value,...(bookmark?{bookmark}:{})}))}
 async ensureTask(binding:BindingInput){if(!binding.task_id||!binding.session_id)throw new Error('题目身份无效');return this.enqueue(()=>this.itemCommand('/items',{...command(0),kind:'platform_task',title:'题目讨论',session_id:binding.session_id,task_id:binding.task_id}))}
 async targetConflict(binding:BindingInput,key=this.state.selected){if(!binding.task_id)return false;const topic=this.draft(key).topic;if(!topic?.item_ids.length)return false;for(const id of topic.item_ids){const item=await this.api<WorkItem>(this.courseId,'/items/'+id);if(item.task_id===binding.task_id)return false}return true}
 async attachTask(binding:BindingInput,choice:'current'|'new'|'compare'='current',replaceId?:string){let key=this.state.selected;if(await this.targetConflict(binding,key)){if(choice==='current')throw new Error('这段对话关联其他题目，请选择新对话或明确比较');if(choice==='new'){await this.flush(key);if(this.state.selected!==key)throw new Error('当前对话已切换，请重新确认添加内容');key=this.newConversation();replaceId=undefined}}
  await this.flush(key);const item=await this.ensureTask(binding);return this.enqueue(async()=>{let d=this.draft(key);if(!d.topic){await this.execute(key,{path:'/topics',method:'POST',body:{...command(0),title:d.titleOverride||conversationTitle(d.text||item.title),mode:'single',item_ids:[item.id]}},d.edit);d=this.draft(key)}else if(!d.topic.item_ids.includes(item.id)){const ids=choice==='compare'?[...d.topic.item_ids,item.id]:[item.id];if(ids.length>2)throw new Error('一次最多明确比较两个学习事项');await this.execute(key,{path:'/topics/'+d.topic.id,method:'PATCH',body:{...command(d.topic.revision),mode:ids.length===2?'compare':'single',item_ids:ids}},d.edit);d=this.draft(key)}if(!d.topic)throw new Error('对话尚未保存');if(!replaceId&&d.bindings.length>=4)throw new Error('最多添加4项内容，请先移除或替换');await this.execute(key,{path:'/topics/'+d.topic.id+'/bindings',method:'POST',body:{...command(d.topic.revision),confirmed:true,binding,...(replaceId?{replace_id:replaceId}:{})}},d.edit)})}

 async correctImage(bindingId:string,text:string,key=this.state.selected){
  const correction=text.trim();if(!correction||correction.length>2000)throw new Error('纠正文字需为1至2000字符')
  await this.flush(key)
  return this.enqueue(async()=>{
   const d=this.draft(key),original=d.bindings.find(b=>b.id===bindingId&&b.image_id&&b.role==='student_work')
   if(!d.topic||!original)throw new Error('原纸稿已移除或替换，请重新核对')
   if(d.sendPending||d.requests?.some(isBlockingRequest))throw new Error('请等待当前请求结束，再确认纸稿纠正')
   const keys=['session_id','task_id','task_fingerprint','text','image_id','image_sha256','image_version','image_width','image_height','learning_focus'] as const
   const binding={...Object.fromEntries(keys.map(k=>[k,original[k]])),role:'student_work',image_correction:correction}
   await this.execute(key,{path:'/topics/'+d.topic.id+'/bindings',method:'POST',body:{...command(d.topic.revision),confirmed:true,binding,replace_id:bindingId}},d.edit)
  })
 }
 async correctLearningFocus(bindingId:string,text:string,key=this.state.selected){
  const focus=text.trim();if(!focus||focus.length>2000)throw new Error('卡点说明需为1至2000字符')
  await this.flush(key)
  return this.enqueue(async()=>{
   const d=this.draft(key),original=d.bindings.find(b=>b.id===bindingId&&b.task_id&&b.role!=='document_excerpt')
   if(!d.topic||!original)throw new Error('原题附件已变化，请重新核对')
   if(d.sendPending||d.requests?.some(isBlockingRequest))throw new Error('请等待当前请求结束，再确认卡点说明')
   const keys=['role','session_id','task_id','task_fingerprint','attempt_id','text','image_id','image_sha256','image_version','image_width','image_height','image_correction'] as const
   const binding={...Object.fromEntries(keys.map(k=>[k,original[k]])),learning_focus:focus}
   await this.execute(key,{path:'/topics/'+d.topic.id+'/bindings',method:'POST',body:{...command(d.topic.revision),confirmed:true,binding,replace_id:bindingId}},d.edit)
  })
 }
 async refreshMessages(key=this.state.selected){
  const d=this.draft(key);if(!d.topic)return
  const read=(this.messageReads.get(key)||0)+1;this.messageReads.set(key,read)
  clearTimeout(this.polling.get(key))
  try{
   let after=0;const all:ConversationMessage[]=[];let requests:GenerationRequest[]=[]
   do{const page=await this.api<MessagePage>(this.courseId,'/topics/'+d.topic.id+'/messages?after='+after);if(!Array.isArray(page?.items))return;all.push(...page.items);requests=page.requests;after=page.next_after??0}while(after)
   if(this.messageReads.get(key)!==read||this.draft(key).topic?.id!==d.topic.id)return
   const previous=this.draft(key).requests||[]
   this.patch(key,{messages:all,requests,messageError:''})
   if(requests.some(r=>r.support_mode!=='pause'&&!isActiveRequest(r)&&previous.find(old=>old.request_id===r.request_id)?.state!==r.state))this.notifyLearningChanged(key)
   if(requests.some(r=>isActiveRequest(r)&&r.state!=='waiting_input'))this.polling.set(key,setTimeout(()=>{void this.refreshMessages(key)},1000))
  }catch{if(this.messageReads.get(key)===read)this.patch(key,{messageError:'暂时无法读取回答，输入仍在；请重试读取，不会重新生成。'})}
 }
 async send(key=this.state.selected,retryOf?:string,answerMode:'short'|'complete'='short',continuationOf?:string,supportMode:SupportMode='auto'){
  const initial=this.draft(key)
  if(initial.sending||initial.sendPending)throw new Error('上次发送结果尚未确认，请先查询原请求')
  if(initial.requests?.some(isBlockingRequest))throw new Error('当前对话还有请求未结束')
  if(!this.state.capabilities?.enabled&&supportMode!=='pause')throw new Error(this.state.capabilities?.reason||'回答功能尚未接通')
  const frozen=supportMode==='pause'?'暂停本轮讲解':initial.text,edit=initial.edit
  if(!frozen.trim())throw new Error('请先写下问题')
  this.patch(key,{sending:true,sendError:''})
  try{
   await this.flush(key)
   return await this.enqueue(async()=>{
    const d=this.draft(key);if(!d.topic)throw new Error('问题尚未保存')
    const clarification=d.requests?.find(r=>r.state==='waiting_input'&&r.needs==='target'&&!r.dispatched)
    const body:RequestIntent={request_id:crypto.randomUUID(),expected_revision:d.topic.revision,context_revision:d.topic.context_revision,text:frozen,binding_ids:d.bindings.map(b=>b.id),user_provided_binding_ids:[],answer_mode:answerMode,support_mode:supportMode,...(continuationOf?{continuation_of:continuationOf}:{}),...(retryOf?{retry_of:retryOf}:{}),...(clarification?{clarification_of:clarification.request_id}:{})}
    try{localStorage.setItem(this.outboxKey(d.topic.id),JSON.stringify(body))}catch{throw new Error('无法保留发送标识，尚未发送；请恢复浏览器存储后重试')}
    this.patch(key,{sendPending:body})
    return this.deliverRequest(key,body,edit)
   })
  }catch(e){this.patch(key,{sendError:this.draft(key).sendPending?'发送结果尚未确认，内容仍在；请确认原请求。':this.message(e)});throw e}finally{this.patch(key,{sending:false})}
 }
 async continueFrom(requestId:string,key=this.state.selected){
  const text=this.draft(key).text.trim();
  if(!text)throw new Error('请先写下追问内容');
  return this.send(key,undefined,'short',requestId)
 }
 private async deliverRequest(key:string,body:RequestIntent,edit:number){
  const d=this.draft(key);if(!d.topic)throw new Error('原对话不可用')
  try{
   const accepted=await this.api<GenerationRequest>(this.courseId,'/topics/'+d.topic.id+'/requests','POST',body)
   return await this.acknowledgeRequest(key,body,accepted,edit)
  }catch(error){
   if(error instanceof WorkspaceError&&error.status<500){this.patch(key,{sendPending:undefined});try{localStorage.removeItem(this.outboxKey(d.topic.id))}catch{}}
   throw error
  }
 }
 private async acknowledgeRequest(key:string,body:RequestIntent,accepted:GenerationRequest,edit:number){
  const current=this.draft(key)
  if(!current.topic||accepted.request_id!==body.request_id||accepted.topic_id!==current.topic.id)throw new Error('查询结果与原请求不一致，请保留内容并重新查询')
  this.messageReads.set(key,(this.messageReads.get(key)||0)+1)
  try{localStorage.removeItem(this.outboxKey(current.topic.id))}catch{}
  this.patch(key,{sendPending:undefined,sendError:'',requests:[accepted,...(current.requests||[]).filter(r=>r.request_id!==accepted.request_id)]})
  if(accepted.support_mode!=='pause'&&!isActiveRequest(accepted))this.notifyLearningChanged(key)
  if(body.support_mode!=='pause'&&current.edit===edit&&current.text===body.text){this.patch(key,{text:'',edit:current.edit+1,status:'waiting'});await this.saveUntilCurrent(key)}
  void this.refreshMessages(key)
  return accepted
 }
 async retryAcceptance(key=this.state.selected){
  const initial=this.draft(key),pending=initial.sendPending;if(!pending||initial.sending)return
  this.patch(key,{sending:true})
  return this.enqueue(async()=>{try{
   if(this.draft(key).sendPending?.request_id!==pending.request_id)return
   const edit=this.draft(key).text===pending.text?this.draft(key).edit:-1
   let accepted:GenerationRequest
   try{accepted=await this.api<GenerationRequest>(this.courseId,'/requests/'+encodeURIComponent(pending.request_id))}
   catch(e){
    if(e instanceof WorkspaceError&&e.status===404)return await this.deliverRequest(key,pending,edit)
    throw e
   }
   return await this.acknowledgeRequest(key,pending,accepted,edit)
  }catch(e){this.patch(key,{sendError:this.draft(key).sendPending?'暂时无法确认原请求，内容和原标识仍保留；不会自动重发。'+this.message(e):this.message(e)});throw e}finally{this.patch(key,{sending:false})}})
 }
 async cancelRequest(id:string,key=this.state.selected){await this.api(this.courseId,'/requests/'+id+'/cancel','POST');await this.refreshMessages(key)}
 async resolveRequest(r:GenerationRequest,allowHelp:boolean,provided:string[],key=this.state.selected){await this.api(this.courseId,'/requests/'+r.request_id+'/resolve','POST',{expected_revision:r.revision,allow_retest_help:allowHelp,user_provided_binding_ids:provided});await this.refreshMessages(key)}
 async citation(requestId:string,evidenceId:string){return this.api<Citation>(this.courseId,'/requests/'+requestId+'/citations/'+evidenceId)}
 async savedExplanations(requestId?:string){const query=requestId?'?request_id='+encodeURIComponent(requestId):'';return this.api<SavedExplanationPage>(this.courseId,'/saved-explanations'+query)}
 async saveExplanation(requestId:string,expectedRevision:number,evidenceIds:string[]){return this.api<SavedExplanation>(this.courseId,'/requests/'+encodeURIComponent(requestId)+'/saved-explanations','POST',{schema_version:2,command_id:crypto.randomUUID(),expected_revision:expectedRevision,evidence_ids:evidenceIds})}
 async revokeExplanation(item:SavedExplanation){return this.api<SavedExplanation>(this.courseId,'/saved-explanations/'+encodeURIComponent(item.id)+'/revoke','POST',{...command(item.revision)})}
 export(key=this.state.selected){return {schema_version:2,course_id:this.courseId,draft:this.draft(key),scope:'未发送草稿及明确确认的附件'}}
}
const stores=new Map<string,ConversationStore>()
export function conversationStore(courseId:string){let store=stores.get(courseId);if(!store){store=new ConversationStore(courseId);stores.set(courseId,store)}return store}
export function anyUnsavedConversations(){return Array.from(stores.values()).some(s=>s.hasUnsaved())}
