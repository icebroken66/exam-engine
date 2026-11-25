import {useState} from 'react'
import type {Binding} from './workspace'
import type {ConversationStore} from './conversationStore'
import {Button} from '../reader/boardui/button'

export function ImageCorrection({binding,store,disabled}:{binding:Binding;store:ConversationStore;disabled:boolean}){
 const [editing,setEditing]=useState(false),[text,setText]=useState(binding.image_correction||''),[confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(){
  setBusy(true);setError('')
  try{await store.correctImage(binding.id,text);setEditing(false);setConfirming(false)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 return <div className="cp-image-correction">
  {binding.image_correction&&<p className="text-caption-1-regular">已确认的纸稿纠正：{binding.image_correction}</p>}
  {!editing?<Button variant="ghost" size="xs" disabled={disabled} onClick={()=>{setText(binding.image_correction||'');setEditing(true)}}>纠正纸稿符号</Button>:<div aria-label="纸稿符号纠正">
   <p className="text-caption-1-regular">仅补充图中符号或文字；不会改写原图、旧回答或正式作答，也不会自动发送。</p>
   {confirming?<blockquote>{text.trim()}</blockquote>:<label>正确的符号或文字<textarea aria-label="正确的纸稿符号或文字" value={text} maxLength={2000} disabled={busy||disabled} onChange={e=>setText(e.target.value)}/></label>}
   <div className="cp-row">{confirming?<Button size="small" disabled={disabled||busy} onClick={()=>void save()}>{busy?'正在保存…':'确认保存纠正'}</Button>:<Button size="small" disabled={disabled||!text.trim()} onClick={()=>setConfirming(true)}>预览纠正</Button>}<Button variant="ghost" size="small" disabled={busy} onClick={()=>{setEditing(false);setConfirming(false);setError('')}}>取消纠正</Button></div>
   {error&&<p role="alert">{error}</p>}
  </div>}
 </div>
}
