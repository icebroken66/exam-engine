import {describe,it,expect} from 'vitest'
import type {ConversationDraft} from './conversationStore'
import {assistantTaskBusy,learningChangeTargetsTask} from './learningSync'
const draft=(state:string,patch={})=>({bindings:[{session_id:'s1',task_id:'q1'}],requests:[{state,needs:'',...patch}]} as unknown as ConversationDraft)
describe('assistant current-task learning lock',()=>{
 it('scopes terminal changes by course, session and task',()=>{
  const change={courseId:'c1',targets:[{session_id:'s1',task_id:'old'}]}
  expect(learningChangeTargetsTask(change,'c1','s1','old')).toBe(true)
  expect(learningChangeTargetsTask(change,'c1','s1','new')).toBe(false)
  expect(learningChangeTargetsTask(change,'c2','s1','old')).toBe(false)
  expect(learningChangeTargetsTask(change,'c1','s2','old')).toBe(false)
  expect(learningChangeTargetsTask(undefined,'c1','s1','old')).toBe(false)
 })
 it.each(['queued','preparing','running','validating','waiting_input'])('locks the explicitly bound task during %s',state=>{
  expect(assistantTaskBusy([draft(state)],'s1','q1')).toBe(true)
  expect(assistantTaskBusy([draft(state)],'s2','q1')).toBe(false)
  expect(assistantTaskBusy([draft(state)],'s1','q2')).toBe(false)
 })
 it.each(['published','failed','stale','cancelled','interrupted_unknown'])('releases terminal state %s for server synchronization',state=>{
  expect(assistantTaskBusy([draft(state)],'s1','q1')).toBe(false)
 })
 it('locks pending acceptance and sending, but does not lock free concepts',()=>{
  const d=draft('published');d.sendPending={} as any
  expect(assistantTaskBusy([d],'s1','q1')).toBe(true)
  d.bindings=[];expect(assistantTaskBusy([d],'s1','q1')).toBe(false)
  expect(assistantTaskBusy([d],undefined,'q1')).toBe(false)
 })
})
