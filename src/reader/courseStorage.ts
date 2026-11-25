import { validateSnapshot } from './storage'
import type { DocumentInfo, Snapshot } from './types'
import { PREVIEW_VERSION } from './types'
export type ReaderStorage = { label: string; read: (doc: DocumentInfo) => Promise<{snapshot: Snapshot | null; raw: unknown; error?: string}>; save: (s: Snapshot, injectFailure?: boolean) => Promise<void> }
type CourseDocument={courseId:string;courseName:string;sourceId:string;sha256:string;name:string;previewVersion:string;pages:DocumentInfo['pages'];readOnly:boolean;revision:number;snapshot:unknown}
async function request<T>(url:string,init?:RequestInit):Promise<T>{const timeout=AbortSignal.timeout(20000),signal=init?.signal?AbortSignal.any([init.signal,timeout]):timeout;const r=await fetch(url,{...init,signal});if(!r.ok){const error=await r.json().catch(()=>null);throw new Error(typeof error?.detail==='string'?error.detail:`请求失败（${r.status}）`)}return r.json()}
export function courseDocumentUrl(courseId:string,sourceId:string){return `/api/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(sourceId)}/reader`}
export async function openCourseDocument(courseId:string,sourceId:string,signal:AbortSignal){
 const url=courseDocumentUrl(courseId,sourceId),metadata=await request<CourseDocument>(url,{signal})
 if(metadata.courseId!==courseId||metadata.sourceId!==sourceId||metadata.previewVersion!==PREVIEW_VERSION)throw new Error('课程资料身份或预览版本不兼容')
 const response=await fetch(`/api/sources/${encodeURIComponent(sourceId)}/file?inline=true`,{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});if(!response.ok)throw new Error(`读取课程原件失败（${response.status}）`)
 const file=new File([await response.blob()],metadata.name,{type:'application/pdf'})
 let revision=metadata.revision
 const storage:ReaderStorage={label:'服务端阅读笔记',async read(doc){
  if(doc.id!==metadata.sha256||doc.pages.length!==metadata.pages.length||doc.pages.some((p,i)=>Math.abs(p.width-metadata.pages[i].width)>.1||Math.abs(p.height-metadata.pages[i].height)>.1))throw new Error('下载原件与课程登记版本不符；未加载或覆盖笔记')
  if(metadata.snapshot===null)return{snapshot:null,raw:null,...(metadata.readOnly?{error:'课程已归档，只读打开；恢复课程后可保存'}:{})}
  try{return{snapshot:validateSnapshot(metadata.snapshot,doc),raw:metadata.snapshot,...(metadata.readOnly?{error:'课程已归档，只读打开；恢复课程后可保存'}:{})}}catch(e){return{snapshot:null,raw:metadata.snapshot,error:String(e)}}
 },async save(snapshot,injectFailure){
  if(injectFailure)throw new Error('验证夹具：服务端保存失败')
  const result=await request<{revision:number}>(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,snapshot})});revision=result.revision
 }}
 return{metadata,file,storage}
}
