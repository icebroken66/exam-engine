import {savedExplanationMessage} from './generation'
import {useEffect,useState} from 'react'
import type {SavedExplanation,SavedExplanationPage} from './generation'
import {Button} from '../reader/boardui/button'

export function SavedExplanationBacklinks({courseId,sourceId,sessionId,taskId}:{courseId:string;sourceId?:string|null;sessionId?:string|null;taskId?:string|null}){
 const [items,setItems]=useState<SavedExplanation[]>([]),[error,setError]=useState('')
 useEffect(()=>{let active=true;const filter=sourceId?'source_id='+encodeURIComponent(sourceId):sessionId?'session_id='+encodeURIComponent(sessionId)+(taskId?'&task_id='+encodeURIComponent(taskId):''):'';if(!filter){setItems([]);return}setError('');void fetch('/api/courses/'+encodeURIComponent(courseId)+'/assistant/v2/saved-explanations?'+filter,{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async response=>{if(!response.ok)throw new Error('暂时无法读取已保存讲解');return response.json() as Promise<SavedExplanationPage>}).then(page=>{if(active)setItems(page.items)}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e))});return()=>{active=false}},[courseId,sourceId,sessionId,taskId])
 if(!items.length&&!error)return null
 function open(item:SavedExplanation){const message=savedExplanationMessage(item);window.dispatchEvent(new CustomEvent('assistant:show-explanation',{detail:{course_id:item.course_id,topic_id:item.topic_id,request_id:item.request_id,message,question:item.content.question,origin:location.href,saved_id:item.id}}))}
 return <aside className="saved-explanation-backlinks" aria-label="已保存的讲解"><strong>已保存的讲解</strong>{error&&<span role="status">{error}</span>}{items.map(item=><div key={item.id}><Button size="xs" variant="ghost" onClick={()=>open(item)}>{item.content.question||'打开已保存讲解'} · {item.anchors.map(anchor=>anchor.kind==='document'?'第'+anchor.page+'页':anchor.title).join('、')}</Button>{!item.valid&&<small>关联位置或依赖资料已失效，内容仍保留</small>}</div>)}</aside>
}
