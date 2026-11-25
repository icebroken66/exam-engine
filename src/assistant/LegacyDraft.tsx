import {attachAssistant} from './session'
import type {AssistantContext} from './session'
export function LegacyDraft({value,onChange,courseId,context}:{value:string;onChange:(v:string)=>void;courseId:string;context:AssistantContext}){return <details className="wb-legacy-draft"><summary>资料旧草稿</summary><div><label>仅此资料的旧草稿<textarea aria-label="问题草稿" value={value} onChange={e=>onChange(e.target.value)}/></label><p>仍随课程笔记保存，不自动覆盖统一助手。</p><button type="button" onClick={()=>attachAssistant(courseId,context,value)}>将旧草稿带入统一助手</button></div></details>}
