/** Review route with public source/SQLite; shares the normal assistant display. */
import {useEffect,useMemo,useState} from 'react'
import {RiBookOpenLine,RiSparklingLine,RiLayoutLeftLine} from '@remixicon/react'
import {Button} from '../../reader/boardui/button'
import {cx} from '../../reader/boardui/cx'
import CourseReader from '../../components/CourseReader'
import {ConversationPanel} from '../ConversationPanel'
import {conversationStore} from '../conversationStore'
import {command,workspaceApi} from '../workspace'
import type {Topic} from '../workspace'
type Fixture={course:{id:string;name:string};sources:{id:string;original_name:string;relative_path:string}[]}
export function AssistantReview(){
 const [fixture,setFixture]=useState<Fixture|null>(null),[error,setError]=useState(''),[source,setSource]=useState(''),[open,setOpen]=useState(true),[navigation,setNavigation]=useState(true),[step,setStep]=useState('first'),[busy,setBusy]=useState(false)
 useEffect(()=>{let active=true;void fetch('/api/courses').then(async r=>{if(!r.ok)throw new Error('评审服务暂不可用');const courses=await r.json();const course=courses.find((c:{name:string})=>c.name==='FE-V09公开评审课');if(!course)throw new Error('请先启动公开评审夹具服务，正式数据不会被改动');const s=await fetch('/api/courses/'+course.id+'/sources');if(!s.ok)throw new Error('公开资料读取失败');const sources=await s.json();if(active){setFixture({course,sources});setSource(sources[0]?.id||'')}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[])
 const store=useMemo(()=>fixture?conversationStore(fixture.course.id):null,[fixture?.course.id])
 async function scenario(next:string){if(!store)return;setStep(next);setOpen(true);setError('');if(next==='first'){store.newConversation();return}if(next!=='conflict')return;setBusy(true);try{store.newConversation();store.edit('课件里的互斥和同步有什么区别？');await store.flush();const topic=store.current().topic!;await workspaceApi<Topic>(store.courseId,'/topics/'+topic.id+'/composer','PUT',{...command(topic.revision),text:'另一窗口已保存：先讨论互斥，再看同步。'});store.edit('这份草稿要保留：能结合课件里的例子解释吗？');try{await store.flush()}catch{/* Expected CAS conflict in the explicit public review scenario. */}}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <div className="ar-page">
  <div className="ar-review-bar"><span className="text-caption-1-semibold">FE-V09 · 可操作样板</span><span className="text-caption-1-regular ar-muted">公开临时课程 · 与应用共用助手界面</span><div className="ar-scenarios">{[['first','首次使用'],['attachment','附带内容'],['history','历史恢复'],['conflict','保存冲突']].map(([id,label])=><Button key={id} variant={step===id?'secondary':'ghost'} size="xs" disabled={!store||busy} onClick={()=>void scenario(id)}>{label}</Button>)}</div></div>
  <div className={cx('ar-workspace',open&&'ar-with-assistant',navigation&&'ar-with-navigation')}>
   {navigation&&<aside className="ar-sidebar"><a className="ar-brand text-headline-medium" href="#"><span>学</span>课程学习工作台</a><p className="text-caption-1-regular ar-muted">我的课程</p><div className="ar-course"><RiBookOpenLine aria-hidden/><strong className="text-body-medium">操作系统原理</strong></div><div className="ar-source-list">{fixture?.sources.map(s=><Button variant="ghost" size="small" key={s.id} className={cx('ar-source',source===s.id&&'ar-source-active')} onClick={()=>setSource(s.id)}><span className="text-body-regular">{s.original_name}</span></Button>)}</div><span className="ar-private text-caption-1-regular">资料属于当前课程<br/>只有明确添加的内容会附带</span></aside>}
   <main className="ar-central"><header className="ar-app-header"><Button variant="ghost" size="small" iconOnly leadingIcon={RiLayoutLeftLine} aria-label="课程导航" onClick={()=>setNavigation(!navigation)}/><span className="text-body-regular ar-muted">操作系统原理 <span className="ar-path-separator">/</span> 资料阅读</span><Button variant="ghost" size="small" leadingIcon={RiSparklingLine} data-global-assistant-trigger aria-pressed={open} onClick={()=>setOpen(!open)}>AI 学习助手</Button></header>{error&&<p role="alert" className="ar-error text-body-regular">{error}</p>}{fixture&&source?<CourseReader key={source} courseId={fixture.course.id} sourceId={source} assistantOpen={open} onAssistantChange={setOpen}/>:<p className="text-body-regular ar-loading">{error?'请启动公开样板服务后刷新。':'正在打开公开课件…'}</p>}</main>
   {store&&<aside className="ar-assistant" hidden={!open}><ConversationPanel store={store} open={open} onClose={()=>setOpen(false)} view="reader" reviewStep={step}/></aside>}
  </div>
 </div>
}
