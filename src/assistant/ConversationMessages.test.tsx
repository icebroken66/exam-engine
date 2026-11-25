import {describe,it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {ConversationMessages} from './ConversationMessages'
import type {ConversationDraft,ConversationStore} from './conversationStore'

describe('system guidance without a model reply',()=>{
 it('shows the original help mode while awaiting request acknowledgement',()=>{
  const draft={key:'test',text:'新的草稿',messages:[],requests:[],sendPending:{request_id:'r',text:'旧问题',support_mode:'different'}} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html).toContain('待确认的帮助方式：换一种表示');expect(html).toContain('先查询原请求');expect(html).toContain('仅明确不存在时才用原标识重试')
 })
 it('identifies a deterministic pause as a system confirmation',()=>{
  const draft={key:'test',text:'',messages:[{id:1,request_id:'r',role:'assistant',text:'先暂停',context_active:true,system_generated:true,claims:[{text:'先暂停',kind:'model_explanation',evidence_ids:[],quote:''}]}],requests:[]} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html).toContain('系统确认');expect(html).not.toContain('模型解释／推导未经外部资料核验')
 })
 it('labels learning observations as hypotheses and shows the student quote',()=>{
  const draft={key:'test',text:'',messages:[{id:1,request_id:'r',role:'assistant',text:'先看第二步',context_active:true,claims:[{text:'先看第二步',kind:'model_explanation',evidence_ids:[],quote:'',learning_observation:'可能卡在步骤连接',student_quote:'我不懂第二步'}]}],requests:[]} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html).toContain('可能卡点（待你确认）');expect(html).toContain('我不懂第二步');expect(html).toContain('这不是能力定论或评分')
 })
 it('shows image uncertainty guidance without presenting it as verified evidence',()=>{
  const draft={key:'test',text:'',messages:[{id:1,request_id:'r',role:'assistant',text:'负号不清楚',context_active:true,claims:[{text:'负号不清楚',kind:'model_explanation',evidence_ids:[],quote:'',image_uncertainty:true}]}],requests:[]} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html).toContain('纸稿有待确认的符号');expect(html).toContain('纠正纸稿符号');expect(html).toContain('确认前不要把相关推导当作定论')
 })
 it('keeps stale guidance only with its original question',()=>{
  const draft={key:'test',messages:[{id:1,request_id:'old',role:'user',text:'旧问题',context_active:true},{id:2,request_id:'new',role:'user',text:'新问题',context_active:true}],requests:[{request_id:'old',state:'stale',error:'资料失效',notices:[]},{request_id:'new',state:'published',notices:[]}]} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html.match(/资料失效/g)).toHaveLength(1)
  expect(html.indexOf('资料失效')).toBeLessThan(html.indexOf('新问题'))
  expect(html.match(/aria-label="回答请求状态"/g)).toHaveLength(1)
 })
 it.each([
  ['waiting_input','target','请明确附带要讨论的题目或文字，再发送新问题','无需先取消','取消本次问题'],
  ['stale','','来源已失效或移除','移除或替换失效资料后再发送','重新生成'],
 ])('shows reason and next steps for %s',(state,needs,error,guidance,action)=>{
  const draft={key:'test',messages:[],requests:[{request_id:'r1',state,needs,error,notices:[]}]} as unknown as ConversationDraft
  const html=renderToStaticMarkup(<ConversationMessages store={{} as ConversationStore} draft={draft}/>)
  expect(html).toContain(error)
  expect(html).toContain(guidance)
  expect(html).toContain(action)
  expect(html).toContain('role="status"')
 })
})
