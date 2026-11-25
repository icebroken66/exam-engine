import {useEffect,useState} from 'react'
import {Button} from '../reader/boardui/button'
import type {Binding} from './workspace'

export function SavedPaperPreview({courseId,topicId,bindingId,original,requestId}:{courseId:string;topicId:string;bindingId:string;original?:Binding['image_original'];requestId?:string}){
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState('')
 const [failed,setFailed]=useState(false),[revision,setRevision]=useState(0),[url,setUrl]=useState('')
 const base='/api/courses/'+encodeURIComponent(courseId)+'/assistant/v2'
 const path=requestId?base+'/requests/'+encodeURIComponent(requestId)+'/images/'+encodeURIComponent(bindingId):base+'/topics/'+encodeURIComponent(topicId)+'/bindings/'+encodeURIComponent(bindingId)+'/image'
 useEffect(()=>{
  const controller=new AbortController();let active=true,objectUrl=''
  setFailed(false);setUrl('')
  void fetch(path,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(async response=>{
   if(!response.ok)throw new Error('image unavailable')
   const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('image format')
   if(!active)return
   objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)
  }).catch(()=>{if(active)setFailed(true)})
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
 },[path,revision])
 async function downloadOriginal(){
  setDownloading(true);setDownloadError('')
  try{
   const response=await fetch(path+'?original=true',{cache:'no-store',signal:AbortSignal.timeout(15000)})
   if(!response.ok)throw new Error('上传原图不可用或版本已变化；未用规范化快照替代原图。')
   const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a')
   link.href=url;link.download='paper-original.'+(original?.original_media_type==='image/png'?'png':'jpg');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }catch(e){setDownloadError(e instanceof Error?e.message:String(e))}finally{setDownloading(false)}
 }
 return <div aria-label="已保存纸稿预览">
  {failed?<p role="status" className="text-caption-1-regular">纸稿图片暂时无法读取，可能已移除或版本变化；文字与草稿保留。<Button variant="ghost" size="xs" onClick={()=>{setFailed(false);setRevision(v=>v+1)}}>重试纸稿预览</Button></p>:url?<img key={url} src={url} className="cp-image-preview" alt="已附纸稿图片" onError={()=>setFailed(true)}/>:<p role="status" className="text-caption-1-regular">正在读取纸稿快照…</p>}
  <p className="text-caption-1-regular cp-muted">已保存的规范化纸稿快照；查看不会调用模型或提交作答。</p>
  {original?<><p className="text-caption-1-regular cp-muted">上传原图已留存：{original.original_width} × {original.original_height}；按EXIF方向校正并等比缩放，未裁剪。原图与模型用图分别保存。</p><Button variant="ghost" size="xs" disabled={downloading} onClick={()=>void downloadOriginal()}>{downloading?'正在读取原图…':'下载上传原图'}</Button></>:<p className="text-caption-1-regular cp-muted">此旧附件未记录原图留存，仅可核对规范化快照。</p>}
  {downloadError&&<p role="alert">{downloadError}</p>}
 </div>
}
