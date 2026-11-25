import {describe,it,expect} from 'vitest'
import {savedExplanationMessage,type SavedExplanation} from './generation'

describe('saved explanation history',()=>{
 const saved={request_id:'original',valid:false,content:{text:'保留的解释',question:'原问题',claims:[],mocked:true,citations:[{evidence_id:'e1',title:'旧来源',provenance:'course_pdf',kind:'document',actionable:true}]}} as unknown as SavedExplanation
 it('keeps historical text readable while disabling invalid source navigation',()=>{
  const message=savedExplanationMessage(saved)
  expect(message.text).toBe('保留的解释')
  expect(message.context_active).toBe(false)
  expect(message.citations?.[0].actionable).toBe(false)
  expect(saved.content.citations?.[0].actionable).toBe(true)
 })
 it('preserves valid citation permissions and supports older records without citations',()=>{
  expect(savedExplanationMessage({...saved,valid:true}).citations?.[0].actionable).toBe(true)
  expect(savedExplanationMessage({...saved,content:{...saved.content,citations:undefined}}).citations).toBeUndefined()
 })
})
