import { useEffect, useState } from 'react'
import { RiBookOpenLine, RiSparklingLine } from '@remixicon/react'
import { ReaderLab } from '../ReaderLab'
import { Button } from '../boardui/button'
import { cx } from '../boardui/cx'
import { openCourseDocument } from '../courseStorage'
import { UnifiedAssistant } from '../../assistant/UnifiedAssistant'
export function Review(){
  const [courseDocument,setCourseDocument]=useState<Awaited<ReturnType<typeof openCourseDocument>>|null>(null),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0)
  const params=new URLSearchParams(location.search),courseId=params.get('course'),sourceId=params.get('source'),courseMode=!!(courseId||sourceId)
  useEffect(()=>{if(!courseMode)return;const controller=new AbortController();setLoadError('');setCourseDocument(null);if(!courseId||!sourceId){setLoadError('课程资料链接缺少身份参数');return}
    void openCourseDocument(courseId,sourceId,controller.signal).then(setCourseDocument).catch(e=>{if(!controller.signal.aborted)setLoadError(e instanceof Error ? e.message : '读取资料失败，请重试')});return()=>controller.abort()
  },[courseId,sourceId,reload])
  const [assistantOpen,setAssistantOpen]=useState(false),[assistantHost,setAssistantHost]=useState<HTMLDivElement|null>(null),[hasDocument,setHasDocument]=useState(false)
  return <div className="wb-review">
    <header className="wb-app-header"><a className="wb-brand" href={courseId?'/#/courses/'+encodeURIComponent(courseId)+'/materials':'/'} title="返回课程"><RiBookOpenLine aria-hidden/><strong>{courseId ? '返回课程资料' : '学习工作台'}</strong></a><div className="wb-app-location"><span>{courseDocument?.metadata.courseName||'资料阅读'}</span><span className="wb-local-badge">{courseMode?'课程资料':'本机工作区'}</span></div><Button className="wb-assistant-trigger" data-global-assistant-trigger size="small" variant="ghost" leadingIcon={RiSparklingLine} aria-pressed={assistantOpen} onClick={()=>setAssistantOpen(!assistantOpen)}>AI 学习助手</Button></header>
    <div className={cx('wb-app-body',assistantOpen&&'wb-app-assistant-open')}>
      {courseMode&&!courseDocument?<main className="rl-empty"><h1>{loadError?'课程资料暂时无法打开':'正在读取课程资料…'}</h1>{loadError&&<p role="alert">{loadError}</p>}<Button onClick={()=>setReload(n=>n+1)}>重试读取课程资料</Button><p>本机验证笔记不会自动上传，原有数据保留。</p></main>:<ReaderLab key={reload} workbench courseDocument={courseDocument?{...courseDocument,reload:()=>{if(window.confirm('重新载入会放弃尚未保存的当前内容。请先导出JSON备份，是否继续读取服务器版本？')){setHasDocument(false);setReload(n=>n+1)}}}:undefined} globalAssistant={{unified:!!courseId||params.get('assistantDebug')!=='1',open:assistantOpen,onOpenChange:setAssistantOpen,host:assistantHost,onDocumentChange:setHasDocument}}/>}
      <aside className="wb-global-assistant" aria-label="全局学习助手" hidden={!assistantOpen}>{courseId||params.get('assistantDebug')!=='1'?<UnifiedAssistant key={courseId||'__workspace__'} courseId={courseId||'__workspace__'} open={assistantOpen} onOpenChange={setAssistantOpen}/>:<><div ref={setAssistantHost} className="wb-assistant-host"/>{!hasDocument&&<><header className="rl-panel-header"><strong>AI 学习助手</strong><Button size="small" variant="ghost" onClick={()=>{setAssistantOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[data-global-assistant-trigger]')?.focus())}}>关闭面板</Button></header><div className="wb-quiet"><p>未连接 AI · 当前没有关联内容。</p><p>打开课件并选中内容，可以附带原文提问。</p><p>统一助手的做题适配尚未接入；此处为阅读与解释交互验证。</p></div></>}</>}</aside>
    </div>
  </div>
}
