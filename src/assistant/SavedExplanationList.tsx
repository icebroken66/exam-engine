import {useEffect,useState} from 'react'
import {savedExplanationMessage,type SavedExplanation,type SavedExplanationPage} from './generation'
import {Button} from '../reader/boardui/button'

export function SavedExplanationList({courseId}:{courseId:string}){
 const [items,setItems]=useState<SavedExplanation[]>([])
 const [offset,setOffset]=useState(0),[next,setNext]=useState<number|null>(null),[retry,setRetry]=useState(0)
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[enabled,setEnabled]=useState(true)
 useEffect(()=>{
  const controller=new AbortController()
  setLoading(true);setError('')
  void fetch('/api/courses/'+encodeURIComponent(courseId)+'/assistant/v2/saved-explanations?offset='+offset+'&limit=20',
   {cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})
   .then(async response=>{if(!response.ok)throw new Error('暂时无法读取已保存讲解，请重试。');return response.json() as Promise<SavedExplanationPage>})
   .then(page=>{if(controller.signal.aborted)return
    if(page.items.some(item=>item.course_id!==courseId))throw new Error('讲解课程不匹配，请重新读取。')
    setItems(current=>offset===0?page.items:[...current,...page.items.filter(item=>!current.some(old=>old.id===item.id))])
    setNext(page.next_offset);setEnabled(page.enabled!==false);setLoading(false)
   }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:String(e));setLoading(false)}})
  return()=>controller.abort()
 },[courseId,offset,retry])
 function open(item:SavedExplanation){
  window.dispatchEvent(new CustomEvent('assistant:show-explanation',{detail:{course_id:courseId,topic_id:item.topic_id,request_id:item.request_id,
   message:savedExplanationMessage(item),question:item.content.question,origin:location.href,saved_id:item.id}}))
 }
 return <section className="saved-explanation-list" aria-label="课程已保存讲解">
  <div className="view-heading"><div><h2>已保存讲解</h2><p>只收录你明确保存的讲解；打开不会重新生成回答。</p></div>
   <Button variant="secondary" disabled={loading} onClick={()=>{setOffset(0);setRetry(n=>n+1)}}>刷新讲解列表</Button></div>
  {!enabled&&<p role="status">保存关系表尚未启用，当前没有可读取的讲解。</p>}
  {!loading&&!error&&enabled&&!items.length&&<p role="status">还没有已保存讲解。可在助手回答中选择“明确保存讲解”，再到这里回访。</p>}
  {items.map(item=><article className="assistant-explanation-claim" key={item.id}>
   <h3><Button variant="ghost" onClick={()=>open(item)}>{item.content.question||'打开已保存讲解'}</Button></h3>
   <p>{item.anchors.length?item.anchors.map(anchor=>anchor.title+(anchor.kind==='document'?' · 第'+anchor.page+'页':' · 题目')).join('、'):'保存到讲解列表 · 无关联资料或题目'}</p>
   {!item.valid&&<p role="status">关联位置或依赖资料已失效，历史正文仍可阅读，失效引用不可定位。</p>}
   {item.content.mocked&&<small>模拟样本</small>}
  </article>)}
  {loading&&<p role="status">正在读取已保存讲解…</p>}
  {error&&<p role="alert">{error} <Button variant="secondary" onClick={()=>setRetry(n=>n+1)}>重试读取讲解</Button></p>}
  {next!==null&&!error&&<Button variant="secondary" disabled={loading} onClick={()=>setOffset(next)}>加载更早讲解</Button>}
 </section>
}
