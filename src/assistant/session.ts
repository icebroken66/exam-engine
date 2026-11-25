export type AssistantContext = {kind:'document'|'question'|'answer';title:string;text:string;sourceId?:string;documentId?:string;previewVersion?:string;page?:number;regions?:{x:number;y:number;width:number;height:number}[];sessionId?:string;taskId?:string;progressVersion?:string;stage?:string}
export type AssistantEntry={id:string;createdAt:string;message:string;context:AssistantContext|null}
export type AssistantSession={schema:1;courseId:string;revision:number;draft:string;context:AssistantContext|null;entries:AssistantEntry[]}
export const sessionKey=(id:string)=>'exam-engine:assistant:v1:'+encodeURIComponent(id)
export const emptySession=(courseId:string):AssistantSession=>({schema:1,courseId,revision:0,draft:'',context:null,entries:[]})
const str=(v:unknown,n:number)=>typeof v==='string'&&v.length<=n
export function validContext(c:unknown):c is AssistantContext{
 if(!c||typeof c!=='object')return false;const a=c as AssistantContext
 if(!str(a.title,500)||!str(a.text,100000))return false
 if(a.kind==='document')return str(a.sourceId,100)&&str(a.documentId,100)&&str(a.previewVersion,100)&&Number.isInteger(a.page)&&a.page!>0&&Array.isArray(a.regions)&&a.regions.length<=1000&&a.regions.every(r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1.000001&&r.y+r.height<=1.000001)
 return (a.kind==='question'||a.kind==='answer')&&str(a.sessionId,100)&&str(a.taskId,100)&&str(a.progressVersion,200)&&str(a.stage,40)
}
export function parseSession(raw:string|null,courseId:string):AssistantSession{
 if(raw===null)return emptySession(courseId);const s=JSON.parse(raw) as AssistantSession
 if(!s||s.schema!==1||s.courseId!==courseId||!Number.isSafeInteger(s.revision)||s.revision<0||!str(s.draft,10000)||(s.context!==null&&!validContext(s.context))||!Array.isArray(s.entries)||s.entries.length>200)throw new Error('统一助手记录格式不兼容；原数据保留，请先导出')
 const ids=new Set<string>();for(const e of s.entries){if(!e||!str(e.id,100)||!e.id||ids.has(e.id)||!str(e.createdAt,100)||!str(e.message,10000)||(e.context!==null&&!validContext(e.context)))throw new Error('统一助手记录损坏；原数据保留，请先导出');ids.add(e.id)}return s
}
export const ATTACH_EVENT='exam-engine:assistant-attach'
export function attachAssistant(courseId:string,context:AssistantContext,draft?:string){window.dispatchEvent(new CustomEvent(ATTACH_EVENT,{detail:{courseId,context,draft}}))}
