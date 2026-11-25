import type {ConversationDraft} from './conversationStore'
import {isBlockingRequest} from './generation'

export const ASSISTANT_LEARNING_CHANGED='exam-engine:assistant-learning-changed'
export type AssistantLearningChange={courseId:string;targets:{session_id:string;task_id:string}[]}
export function learningChangeTargetsTask(change:AssistantLearningChange|undefined,courseId:string,sessionId?:string,taskId?:string){
 return change?.courseId===courseId&&!!sessionId&&!!taskId&&Array.isArray(change.targets)&&change.targets.some(t=>t.session_id===sessionId&&t.task_id===taskId)
}
/** Only the explicitly bound task is locked; unrelated concepts/courses remain usable. */
export function assistantTaskBusy(drafts:ConversationDraft[],sessionId?:string,taskId?:string){
 if(!sessionId||!taskId)return false
 return drafts.some(draft=>draft.bindings.some(binding=>binding.session_id===sessionId&&binding.task_id===taskId)&&
  (draft.sending||!!draft.sendPending||draft.requests?.some(isBlockingRequest)))
}
