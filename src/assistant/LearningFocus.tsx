import {useState} from 'react'
import type {Binding} from './workspace'
import type {ConversationStore} from './conversationStore'
import {Button} from '../reader/boardui/button'

export function LearningFocus({binding,store,disabled}:{binding:Binding;store:ConversationStore;disabled:boolean}){
 const [editing,setEditing]=useState(false),[text,setText]=useState(binding.learning_focus||''),[preview,setPreview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(){setBusy(true);setError('');try{await store.correctLearningFocus(binding.id,text);setEditing(false)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <div className="cp-image-correction" aria-label="当前题卡点说明">
  {binding.learning_focus&&<p className="text-caption-1-regular">我确认的卡点：{binding.learning_focus}</p>}
  {!editing?<Button variant="ghost" size="xs" disabled={disabled} onClick={()=>{setText(binding.learning_focus||'');setPreview(false);setEditing(true)}}>说明或纠正卡点</Button>:<>
   <p className="text-caption-1-regular">例如“我懂概念，只是不知道第二步怎么算”。只用于调整本题后续帮助，不改成绩或掌握状态，不自动发送。</p>
   {preview?<blockquote>{text.trim()}</blockquote>:<textarea aria-label="我实际卡在哪里" value={text} maxLength={2000} disabled={busy||disabled} onChange={e=>setText(e.target.value)}/>}
   <div className="cp-row">{preview?<Button size="small" disabled={disabled||busy} onClick={()=>void save()}>{busy?'正在保存…':'确认卡点说明'}</Button>:<Button size="small" disabled={disabled||!text.trim()} onClick={()=>setPreview(true)}>预览卡点说明</Button>}<Button variant="ghost" size="small" disabled={busy} onClick={()=>{setEditing(false);setPreview(false);setError('')}}>取消卡点说明</Button></div>
   {error&&<p role="alert">{error}</p>}
  </>}
 </div>
}
