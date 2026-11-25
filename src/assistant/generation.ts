import type {Binding} from './workspace'
export type RequestState='queued'|'accepted'|'preparing'|'waiting_input'|'running'|'validating'|'published'|'blocked'|'failed'|'cancelled'|'stale'|'interrupted_unknown'
export type SupportMode='auto'|'step'|'different'|'pause'
export const supportModeLabels:Record<SupportMode,string>={auto:'按问题需要',step:'只讲当前步骤',different:'换一种表示',pause:'暂停本轮讲解'}
export type GenerationRequest={request_id:string;topic_id:string;state:RequestState;revision:number;error:string;notices:string[];mocked:boolean;needs:string;dispatched:boolean;cancel_requested:boolean;support_mode?:SupportMode;answer_mode?:'short'|'complete';continuation_of?:string}
export type Claim={text:string;kind:'evidence'|'model_explanation';evidence_ids:string[];quote:string;image_uncertainty?:boolean;learning_observation?:string;student_quote?:string}
export type ConversationMessage={id:number;request_id:string;role:'user'|'assistant';text:string;claims:Claim[];citations?:{evidence_id:string;title:string;provenance:string;kind:string;actionable:boolean;page?:number}[];context_active:boolean;mocked:boolean;system_generated?:boolean;images?:{binding_id:string;image_id:string;image_sha256:string;image_original?:Binding['image_original'];image_correction?:string}[]}
export type MessagePage={items:ConversationMessage[];requests:GenerationRequest[];next_after:number|null}
export type Capabilities={enabled:boolean;reason:string;mocked:boolean;task_support:boolean}
export const isActiveRequest=(r:GenerationRequest)=>['accepted','queued','preparing','running','validating','waiting_input'].includes(r.state)
export const requestLabels:Record<RequestState,string>={accepted:'已接受',queued:'等待回答',preparing:'正在核验内容',running:'正在生成回答',validating:'正在校验引用',waiting_input:'需要确认',published:'已回答',blocked:'暂不能回答',failed:'回答未发布',cancelled:'已停止',stale:'上下文已变化',interrupted_unknown:'执行结果未知'}
export const isBlockingRequest=(r:GenerationRequest)=>isActiveRequest(r)&&!(r.state==='waiting_input'&&r.needs==='target'&&!r.dispatched)
export type RequestIntent={request_id:string;expected_revision:number;context_revision:number;text:string;binding_ids:string[];user_provided_binding_ids:string[];retry_of?:string;clarification_of?:string;continuation_of?:string;support_mode?:SupportMode;answer_mode?:'short'|'complete'}
export type Citation={title:string;quote:string;provenance:string;action:{kind:'document';course_id:string;source_id:string;source_sha256:string;preview_version:string;page:number;precision:'page'}|{kind:'task';course_id:string;session_id:string;task_id:string;attempt_id?:string;role:string};record?:{stem:string;options:string[];snapshot:string;role:string}}
export type SavedAnchor={kind:'document';source_id:string;source_sha256:string;preview_version:string;page:number;evidence_id:string;title:string}|{kind:'task';session_id:string;task_id:string;task_fingerprint?:string;evidence_id:string;title:string}
export type SavedExplanation={id:string;course_id:string;topic_id:string;request_id:string;content:{question:string;text:string;claims:Claim[];citations?:ConversationMessage['citations'];mocked:boolean};anchors:SavedAnchor[];revision:number;valid:boolean;revoked_at:string|null;created_at:string|null}
export type SavedExplanationPage={items:SavedExplanation[];next_offset:number|null;enabled?:boolean}

// The saved text survives invalid anchors; navigation must remain unavailable.
export function savedExplanationMessage(item:SavedExplanation):ConversationMessage{
 return {id:0,request_id:item.request_id,role:'assistant',text:item.content.text,claims:item.content.claims,
  citations:item.content.citations?.map(c=>({...c,actionable:item.valid&&c.actionable})),
  context_active:item.valid,mocked:item.content.mocked}
}
