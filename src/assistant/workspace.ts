/** FE-V08 bounded no-model DTOs and ephemeral capture bridge. */
export type Region={x:number;y:number;width:number;height:number}
export type BindingInput={schema_version?:2;role:'document_excerpt'|'question'|'student_work'|'submitted_answer'|'visible_feedback';source_id?:string;source_sha256?:string;preview_version?:string;page?:number;regions?:Region[];precision?:'text'|'region'|'page';text?:string;session_id?:string;task_id?:string;task_fingerprint?:string;attempt_id?:string;image_id?:string;image_sha256?:string;image_version?:string;image_width?:number;image_height?:number;image_correction?:string;learning_focus?:string}
export type Binding=BindingInput&{id:string;title:string;text:string;confirmed:true;supersedes:string|null;provenance:string;limitation?:string;image_original?:{original_sha256:string;original_width:number;original_height:number;original_media_type:string;original_size_bytes:number;exif_orientation:number;transform:string;normalization_version:string};image_correction_version?:string;learning_focus_version?:string}
export type ViewRef={view:'learn'|'reader'|'overview'|'materials'|'history';session_id?:string;task_id?:string;source_id?:string;page?:number}
export type Bookmark={relation:'known'|'unknown';origin:ViewRef;target:ViewRef}
export type WorkItem={id:string;course_id:string;kind:'platform_task'|'exploration';title:string;task_id:string|null;session_id:string|null;attention:'ongoing'|'paused'|'finished';revision:number;bookmark:Bookmark|null;business:null|{available:boolean;is_current?:boolean;stage?:string;can_submit:boolean;can_tutor:boolean;reason:string;public_task?:{stem:string;options:string[]}};read_only:boolean}
export type Topic={schema_version:2;id:string;course_id:string;title:string;mode:'single'|'compare'|'independent';item_ids:string[];revision:number;context_revision:number;text:string;bindings:Binding[];binding_count:number;read_only:boolean;updated_at?:string;legacy_origin:null|{legacy:true;source_fingerprint:string;entry_id:string|null}}
export type TopicSummary=Omit<Topic,'text'|'bindings'>
export type Page<T>={schema_version:2;items:T[];next_offset:number|null;read_only:boolean}
export type Manifest={status:string;model_called:false;can_send:false;course:{id:string;name:string};topic:{title:string;revision:number;context_revision:number};question:string;included:Binding[];excluded:{binding_id:string;reason:string;message:string}[];groups:{item_id:string;title:string;bindings:string[]}[];trace:unknown;limitations:string[];candidates:{item_id:string;title:string}[]}
export type Legacy={supported:boolean;source_fingerprint:string;snapshot:unknown;context_authorized:false}
export class WorkspaceError extends Error{status:number;code:string;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code}}
export async function workspaceApi<T>(courseId:string,path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch('/api/courses/'+encodeURIComponent(courseId)+'/assistant/v2'+path,{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 if(!response.ok){let value:unknown;try{value=await response.json()}catch{}const detail=(value as {detail?:{code?:string;message?:string}|string})?.detail;throw new WorkspaceError(response.status,detail&&typeof detail==='object'&&!Array.isArray(detail)?detail.code||'invalid':'invalid',detail&&typeof detail==='object'&&!Array.isArray(detail)?detail.message||'保存失败':typeof detail==='string'?detail:response.status===422?'输入超出限额或格式无效；未保存':'服务不可用；保存未确认，当前内存保留')}
 return response.json() as Promise<T>
}
export async function uploadAssistantImage(courseId:string,file:File,signal?:AbortSignal):Promise<Pick<BindingInput,'image_id'|'image_sha256'|'image_version'|'image_width'|'image_height'>>{
 const data=new FormData();data.append('file',file)
 const response=await fetch('/api/courses/'+encodeURIComponent(courseId)+'/assistant/v2/images',{method:'POST',body:data,cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)})
 if(!response.ok){const value=await response.json().catch(()=>null),detail=value?.detail;throw new WorkspaceError(response.status,typeof detail==='object'?detail.code||'image_upload':'image_upload',typeof detail==='object'?detail.message||'图片上传失败':typeof detail==='string'?detail:'图片上传失败')}
 return response.json()
}
export const command=(expected_revision:number)=>({schema_version:2,command_id:crypto.randomUUID(),expected_revision})
type Outbox={path:string;body:Record<string,unknown>}
const outbox=new Map<string,Outbox>()
/** Unacknowledged explicit commands keep their original ID across course switches. */
export async function explicitCommand<T>(courseId:string,path:string,body:Record<string,unknown>):Promise<T>{
 const previous=outbox.get(courseId),payload=previous?.path===path?previous.body:body
 if(previous&&previous.path!==path)throw new Error('上一项命令保存结果未确认；请先重试待确认命令，或导出并核对服务端记录')
 outbox.set(courseId,{path,body:payload})
 try{const result=await workspaceApi<T>(courseId,path,'POST',payload);outbox.delete(courseId);return result}catch(error){if(error instanceof WorkspaceError&&error.status<500)outbox.delete(courseId);throw error}
}
export function pendingCommand(courseId:string){return outbox.get(courseId)}
export const CAPTURE='exam-engine:workspace-capture',CANDIDATE='exam-engine:workspace-candidate',CANCEL_CAPTURE='exam-engine:workspace-capture-cancel',READ_CAPTURE='exam-engine:workspace-read-capture',TASK_CAPTURE='exam-engine:workspace-task-capture'
export type CaptureCandidate={courseId:string;binding:BindingInput;title:string;previewUrl?:string;replaceId?:string}
let capture:{courseId:string;kind:'text'|'region'}|null=null
export function captureState(){return capture}
export function startCapture(courseId:string,kind:'text'|'region'){capture={courseId,kind};window.dispatchEvent(new CustomEvent(CAPTURE,{detail:capture}))}
export function cancelCapture(){capture=null;window.dispatchEvent(new Event(CANCEL_CAPTURE))}
export function offerCandidate(candidate:CaptureCandidate){window.dispatchEvent(new CustomEvent(CANDIDATE,{detail:candidate}))}
export function viewRef():ViewRef{const [path,query]=location.hash.split('?'),p=new URLSearchParams(query),v=path.split('/')[3];return {view:(['learn','reader','overview','materials','history'].includes(v)?v:'overview') as ViewRef['view'],...(p.get('session')?{session_id:p.get('session')!}:{}),...(p.get('source')?{source_id:p.get('source')!}:{})}}
export function downloadWorkspace(value:unknown,name='assistant-workspace.json'){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
