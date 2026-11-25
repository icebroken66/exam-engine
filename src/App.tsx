import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive,
  ArrowRight,
  Circle,
  ExternalLink,
  FileUp,
  Github,
  Library,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { archiveCourse, createCourse, deleteCourse, getHealth, listCourses } from './lib/api'
import type { Course, Health } from './lib/api'
import { examCountdown } from './lib/course'
import { SourcePanel } from './components/SourcePanel'
import { GitHubPanel } from './components/GitHubPanel'
import { QuestionBankPanel } from './components/QuestionBankPanel'
import { CoveragePanel } from './components/CoveragePanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { LearningPanel } from './components/LearningPanel'
import { LearningHistoryPanel } from './components/LearningHistoryPanel'
import { useCourseSources } from './lib/useCourseSources'
import { SourceProgress } from './components/SourceProgress'
import { UnifiedAssistant } from './assistant/UnifiedAssistant'
import {CourseTree} from './components/CourseTree'
import {CourseOverview} from './components/CourseOverview'
import {allowWorkspaceNavigation,readPanels} from './lib/workspaceRoute'
import {Button} from './reader/boardui/button'
import {RiLayoutLeftLine,RiSparklingLine} from '@remixicon/react'
const CourseReader=lazy(()=>import('./components/CourseReader'))
import { ATTACH_EVENT } from './assistant/session'
import {TutoringHostContext,TUTORING_OPEN} from './assistant/TutoringHost'
import type {ConversationMessage} from './assistant/generation'
import {StudyContent} from './components/StudyContent'
import {SavedExplanationBacklinks} from './assistant/SavedExplanationBacklinks'
import {SavedExplanationList} from './assistant/SavedExplanationList'

const workflow = [
  ['01', '提供课程资料', '课件、往年卷、作业或笔记'],
  ['02', '确认复习范围', '从现有资料识别具体考点'],
  ['03', '诊断与补缺', '逐题作答，找到薄弱点'],
  ['04', '独立重测', '用新题检查是否真正掌握'],
]

const views = [['overview', '课程总览'], ['materials', '课程资料'], ['learn', '练习题目'], ['questions', '题目校准'], ['saved', '已保存讲解'], ['history', '学习记录'], ['analytics', '考点概览']] as const
type View = typeof views[number][0] | 'reader'
function readRoute() {
  const [path, query] = window.location.hash.split('?')
  const match = path.match(/^#\/courses\/([^/]+)(?:\/(\w+))?$/)
  return { sourceId:new URLSearchParams(query).get('source'), sessionId: new URLSearchParams(query).get('session'), courseId: match?.[1] ?? null, view: ((match?.[2]==='reader'||views.some(([view]) => view === match?.[2])) ? match![2] : new URLSearchParams(query).has('session') ? 'learn' : 'overview') as View }
}

function App() {
  const [tutoringHost,setTutoringHost]=useState<HTMLDivElement|null>(null)
  const legacyAssistantDebug=new URLSearchParams(location.search).get('assistantDebug')==='1'
  const [hasTutoring,setHasTutoring]=useState(false)
  const [assistantTab,setAssistantTab]=useState<'notes'|'tutoring'>('notes')
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => readRoute().courseId)
  const [panels,setPanels]=useState(readPanels)
  const [narrow,setNarrow]=useState(()=>innerWidth<1250)
  const assistantOpen=panels.right
  const setAssistantOpen=(right:boolean)=>{window.dispatchEvent(new Event('reader:cancel-gesture'));setPanels(p=>({...p,right}))}
  const leftOpen=panels.left&&!(narrow&&assistantOpen)
  useEffect(()=>{const resize=()=>setNarrow(innerWidth<1250);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[])
  useEffect(()=>{try{localStorage.setItem('exam-engine:panels:v1',JSON.stringify({schema:1,...panels}))}catch{}},[panels])
  const [sourceId,setSourceId]=useState<string|null>(()=>readRoute().sourceId)
  useEffect(()=>{const attach=(e:Event)=>{if((e as CustomEvent).detail?.courseId===selectedId){setAssistantTab('notes');setAssistantOpen(true)}};const tutor=()=>{setAssistantTab(legacyAssistantDebug?'tutoring':'notes');setAssistantOpen(true);requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>(legacyAssistantDebug?'.tutoring-panel textarea':'.cp-panel textarea')?.focus())};const closeForAnswer=()=>setAssistantOpen(false);window.addEventListener('exam-engine:close-assistant-for-answer',closeForAnswer);window.addEventListener(ATTACH_EVENT,attach);window.addEventListener(TUTORING_OPEN,tutor);return()=>{window.removeEventListener('exam-engine:close-assistant-for-answer',closeForAnswer);window.removeEventListener(ATTACH_EVENT,attach);window.removeEventListener(TUTORING_OPEN,tutor)}},[selectedId])
  const [view, setView] = useState<View>(() => readRoute().view)
  const [sessionId, setSessionId] = useState<string | null>(() => readRoute().sessionId)

  function navigate(courseId: string | null, nextView: View = 'overview', nextSession: string | null = null) {
    if(!allowWorkspaceNavigation())return
    setSourceId(null);setSelectedId(courseId); setView(nextView); setSessionId(nextSession)
    window.location.hash = courseId ? `/courses/${courseId}/${nextView}${nextSession ? `?session=${encodeURIComponent(nextSession)}` : ''}` : ''
  }
  useEffect(()=>{let previous=location.hash;let restoring=false;const click=(e:MouseEvent)=>{const target=e.target instanceof Element?e.target.closest('a'):null;if(target&&target.getAttribute('href')?.startsWith('#/courses/')&&!allowWorkspaceNavigation())e.preventDefault()};const sync=()=>{if(!restoring&&!allowWorkspaceNavigation()){restoring=true;location.hash=previous;return}restoring=false;previous=location.hash;const route=readRoute();setSelectedId(route.courseId);setView(route.view);setSessionId(route.sessionId);setSourceId(route.sourceId)};document.addEventListener('click',click,true);window.addEventListener('hashchange',sync);return()=>{document.removeEventListener('click',click,true);window.removeEventListener('hashchange',sync)}},[])

  const [unsupported,setUnsupported]=useState<{name:string;id:string}|null>(null)
  useEffect(()=>{const show=(e:Event)=>setUnsupported((e as CustomEvent).detail);window.addEventListener('course:unsupported',show);return()=>window.removeEventListener('course:unsupported',show)},[])
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [courseBusy, setCourseBusy] = useState('')
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [connectionVersion, setConnectionVersion] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    Promise.allSettled([listCourses(true), getHealth()]).then(([courseResult, healthResult]) => {
      if (!active) return
      if (courseResult.status === 'fulfilled') {
        setCourses(courseResult.value)
        const wanted = readRoute().courseId
        const chosen = courseResult.value.find(course => !course.archived_at && course.id === wanted) ?? courseResult.value.find(course => !course.archived_at)
        if (!wanted) navigate(chosen?.id ?? null, readRoute().view, readRoute().sessionId)
      } else {
        setError('暂时无法连接课程服务。请确认前后端均已启动。')
      }
      setHealth(healthResult.status === 'fulfilled' ? healthResult.value : null)
      setLoading(false)
    })
    return () => { active = false }
  }, [connectionVersion])

  const activeCourses = courses.filter((course) => !course.archived_at)
  const archivedCourses = courses.filter((course) => course.archived_at)
  const selected = activeCourses.find((course) => course.id === selectedId) ?? null

  function onCreated(course: Course) {
    setCourses((current) => [course, ...current])
    navigate(course.id)
    setShowForm(false)
    setError('')
  }

  function onArchived(course: Course) {
    const next = activeCourses.find((item) => item.id !== course.id)
    setCourses((current) => current.map((item) => item.id === course.id ? course : item))
    navigate(next?.id ?? null)
  }

  function onDeleted(courseId: string) {
    const remaining = courses.filter((course) => course.id !== courseId)
    setCourses(remaining)
    navigate(remaining.find((course) => !course.archived_at)?.id ?? null)
  }

  async function restore(course: Course) {
    setCourseBusy(course.id)
    setError('')
    try {
      const restored = await archiveCourse(course.id, false)
      setCourses((current) => current.map((item) => item.id === course.id ? restored : item))
      navigate(restored.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '课程恢复失败，请重试')
    } finally {
      setCourseBusy('')
    }
  }

  return (
    <TutoringHostContext.Provider value={{host:tutoringHost,available:setHasTutoring}}><div className="app-shell" data-reader={view==='reader'} data-left-open={leftOpen} data-assistant-open={assistantOpen}>
      <aside className="sidebar" hidden={!leftOpen}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">急</div>
          <div><strong>期末急救引擎</strong><span>课程学习工作台</span></div>
        </div>

        <div className="side-section-label">课程工作台</div>
        <button className="new-course-button" onClick={() => setShowForm(true)}>
          <Plus size={17} /> 新建课程
        </button>

        <nav className="course-nav" aria-label="我的课程">
          {loading && <p className="nav-muted">正在读取课程…</p>}
          {!loading && activeCourses.length === 0 && <p className="nav-muted">还没有进行中的课程<br />从一门新课开始。</p>}
          <CourseTree courses={activeCourses} courseId={selectedId} sourceId={view==='reader'?sourceId:null} onNavigate={hash=>{if(allowWorkspaceNavigation())window.location.hash=hash}}/>
          {archivedCourses.length > 0 && (
            <details className="archived-courses">
              <summary>已归档课程 <span>{archivedCourses.length}</span></summary>
              {archivedCourses.map((course) => (
                <div className="archived-course-row" key={course.id}>
                  <span><strong>{course.name}</strong><small>{course.school}</small></span>
                  <button type="button" disabled={Boolean(courseBusy)} onClick={() => restore(course)} aria-label={`恢复课程 ${course.name}`}>
                    {courseBusy === course.id ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />} 恢复
                  </button>
                </div>
              ))}
            </details>
          )}
        </nav>

        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <p>资料默认私有<br />结论必须可回到原文</p>
        </div>
      </aside>

      <main className="main-canvas">
        <header className="topbar">
          <Button size="small" variant="ghost" leadingIcon={RiLayoutLeftLine} data-navigation-trigger aria-pressed={leftOpen} onClick={()=>{window.dispatchEvent(new Event('reader:cancel-gesture'));if(narrow&&assistantOpen)setAssistantOpen(false);setPanels(p=>({...p,left:!leftOpen}))}}>{leftOpen?'收起课程导航':'展开课程导航'}</Button>
          {narrow&&assistantOpen&&panels.left&&<span className="panel-notice">窄窗口暂收课程栏，宽屏自动恢复</span>}
          <Button variant="ghost" size="small" className="ua-trigger" leadingIcon={RiSparklingLine} data-global-assistant-trigger aria-pressed={assistantOpen} onClick={()=>setAssistantOpen(!assistantOpen)}>AI 学习助手</Button>
          <div className={`service-status ${health ? 'online' : ''}`}>
            <span className="status-dot" />
            {health ? '服务已连接' : 'API 未连接'}
          </div>
        </header>

        {unsupported&&<div className="panel-notice" role="status">{unsupported.name}：当前格式不支持工作台阅读，可下载原件；PPTX 可人工导出 PDF 后导入。<a href={'/api/sources/'+encodeURIComponent(unsupported.id)+'/file'}>下载原件</a><Button variant="ghost" size="small" onClick={()=>setUnsupported(null)}>关闭格式说明</Button></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="secondary-action" type="button" onClick={() => setConnectionVersion(value => value + 1)} disabled={loading}>重新连接</button></div>}

        {selected ? (
          <CourseWorkspace key={selected.id} course={selected} sourceId={sourceId} assistantOpen={assistantOpen} onAssistantChange={setAssistantOpen} view={view} sessionId={sessionId} onNavigate={(nextView, nextSession) => navigate(selected.id, nextView, nextSession)} onArchived={onArchived} onDeleted={onDeleted} />
        ) : (
          selectedId && !loading ? <div className="workspace" role="alert">课程不存在或已归档。请从左侧选择课程，或恢复归档课程。</div> : <EmptyWorkspace loading={loading} onCreate={() => setShowForm(true)} />
        )}

        <footer className="page-footer">
          <span>证据优先 · 作答留痕 · 低置信不冒充掌握</span>
          <span>诊断 → 补缺 → 练习 → 独立重测</span>
        </footer>
      </main>

      <aside className="app-unified-assistant" hidden={!assistantOpen} aria-label="AI 学习助手侧栏">
        {legacyAssistantDebug&&hasTutoring&&view==='learn'&&<div className="assistant-task-tabs" role="group" aria-label="助手功能"><Button size="small" variant="ghost" aria-pressed={assistantTab==='notes'} onClick={()=>setAssistantTab('notes')}>问题记录与上下文</Button><Button size="small" variant="ghost" aria-pressed={assistantTab==='tutoring'} onClick={()=>setAssistantTab('tutoring')}>带学对话</Button></div>}
        <div className="assistant-task-body" hidden={legacyAssistantDebug&&hasTutoring&&view==='learn'&&assistantTab==='tutoring'}><UnifiedAssistant key={selectedId||'__workspace__'} courseId={selectedId||'__workspace__'} open={assistantOpen&&!(legacyAssistantDebug&&hasTutoring&&view==='learn'&&assistantTab==='tutoring')} onOpenChange={setAssistantOpen}/></div>
        {legacyAssistantDebug&&<div className="assistant-task-body" hidden={!hasTutoring||view!=='learn'||assistantTab!=='tutoring'}><header className="assistant-task-header"><strong>AI 学习助手 · 当前题</strong><Button size="small" variant="ghost" onClick={()=>{setAssistantOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-global-assistant-trigger]')?.focus())}}>关闭题目带学</Button></header><div ref={setTutoringHost}/></div>}
      </aside>
      {showForm && <CourseDialog onClose={() => setShowForm(false)} onCreated={onCreated} />}
    </div></TutoringHostContext.Provider>
  )
}

function EmptyWorkspace({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return (
    <div className="workspace empty-workspace">
      <section className="intro-grid">
        <div className="intro-copy">
          <span className="eyebrow">从复习目标开始，而不是从整理资料开始</span>
          <h1>{loading ? '正在准备工作台。' : <>把一门课，<br />变成拿分计划。</>}</h1>
          <p>只需填写学校和课名，再批量提供已有的课件、往年卷、作业或笔记。Agent 负责整理资料、识别复习范围，不要求你先知道考什么。</p>
          {!loading && (
            <button className="primary-action" onClick={onCreate}>
              创建第一门课程 <ArrowRight size={19} />
            </button>
          )}
        </div>
        <div className="workflow-ledger">
          <div className="ledger-heading"><span>完整闭环</span><span>04 STAGES</span></div>
          {workflow.map(([number, title, detail]) => (
            <div className="ledger-row" key={number}>
              <span className="ledger-number">{number}</span>
              <div><strong>{title}</strong><small>{detail}</small></div>
              <Circle size={12} />
            </div>
          ))}
        </div>
      </section>
      <section className="source-strip">
        <div><FileUp size={21} /><strong>本地文件</strong><span>上传后自动解析</span></div>
        <div><ExternalLink size={21} /><strong>1037 辅助导入</strong><span>官网登录下载后回传</span></div>
        <div><Github size={21} /><strong>GitHub</strong><span>导入后自动建立证据</span></div>
      </section>
    </div>
  )
}

interface CourseWorkspaceProps {
  course: Course
  sourceId:string|null
  assistantOpen:boolean
  onAssistantChange:(open:boolean)=>void
  view: View
  sessionId: string | null
  onNavigate: (view: View, sessionId?: string | null) => void
  onArchived: (course: Course) => void
  onDeleted: (courseId: string) => void
}

function CourseWorkspace({ course, sourceId, assistantOpen, onAssistantChange, view, sessionId, onNavigate, onArchived, onDeleted }: CourseWorkspaceProps) {
  const [explanation,setExplanation]=useState<{course_id:string;topic_id?:string;request_id:string;message:ConversationMessage;question:string;origin:string}|null>(null)
  const [explanationError,setExplanationError]=useState('')
  const citationLookup=useRef<AbortController|null>(null)
  const [citationLoading,setCitationLoading]=useState(false)
  function cancelCitationLookup(){citationLookup.current?.abort();citationLookup.current=null;setCitationLoading(false)}
  function closeExplanation(){cancelCitationLookup();setExplanation(null);setExplanationError('')}
  useEffect(()=>{
    const cancel=()=>{citationLookup.current?.abort();citationLookup.current=null;setCitationLoading(false)}
    const show=(event:Event)=>{const value=(event as CustomEvent).detail;if(value?.course_id===course.id&&value.message?.role==='assistant'){cancel();setExplanation(value);setExplanationError('')}}
    window.addEventListener('assistant:show-explanation',show);window.addEventListener('hashchange',cancel)
    return()=>{citationLookup.current?.abort();citationLookup.current=null;window.removeEventListener('assistant:show-explanation',show);window.removeEventListener('hashchange',cancel)}
  },[course.id])
  function returnToExplanationOrigin(){
    if(!explanation)return
    cancelCitationLookup()
    try{const origin=new URL(explanation.origin,location.href),originHash=origin.hash,current=new URLSearchParams(location.hash.split('?')[1]||''),previous=new URLSearchParams(originHash.split('?')[1]||'');if(origin.origin===location.origin&&originHash.includes('/reader?')&&current.get('source')===previous.get('source')){window.dispatchEvent(new Event('assistant:citation-back'));setExplanation(null);return}if(origin.origin===location.origin){if(originHash.includes('/learn')){if(location.hash!==origin.hash)location.hash=origin.hash;window.dispatchEvent(new Event('exam-engine:focus-learning-origin'));setExplanation(null);return}location.href=origin.href;setExplanation(null)}}catch{}
  }
  async function locateExplanation(evidenceId:string){
    if(!explanation)return
    cancelCitationLookup()
    const controller=new AbortController(),origin=location.href
    citationLookup.current=controller;setCitationLoading(true);setExplanationError('')
    try{
      const response=await fetch('/api/courses/'+encodeURIComponent(course.id)+'/assistant/v2/requests/'+encodeURIComponent(explanation.request_id)+'/citations/'+encodeURIComponent(evidenceId),{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})
      if(!response.ok){const body=await response.json().catch(()=>null);throw new Error(body?.detail?.message||'来源已失效或无法定位')}
      const result=await response.json()
      if(controller.signal.aborted||citationLookup.current!==controller||location.href!==origin)return
      if(result.action?.kind!=='document'||result.action.course_id!==course.id)throw new Error('该依据没有本课程资料页定位')
      const a=result.action,target='#/courses/'+encodeURIComponent(a.course_id)+'/reader?source='+encodeURIComponent(a.source_id)+'&citation_page='+a.page+'&citation_sha='+encodeURIComponent(a.source_sha256)+'&citation_version='+encodeURIComponent(a.preview_version)
      if(location.hash!==target)location.hash=target;else window.dispatchEvent(new CustomEvent('assistant:citation-location',{detail:a}))
    }catch(e){if(!controller.signal.aborted&&citationLookup.current===controller&&location.href===origin)setExplanationError(e instanceof Error?e.message:String(e))}
    finally{if(citationLookup.current===controller){citationLookup.current=null;setCitationLoading(false)}}
  }
  const [learningVersion, setLearningVersion] = useState(0)
  const [questionVersion, setQuestionVersion] = useState(0)
  const [visited, setVisited] = useState<Set<View>>(() => new Set([view]))
  useEffect(() => { setVisited(current => current.has(view) ? current : new Set([...current, view])) }, [view])
  const [showDelete, setShowDelete] = useState(false)
  const [managing, setManaging] = useState(false)
  const [managementError, setManagementError] = useState('')

  const refreshLearningContext = useCallback(() => {
    setLearningVersion(version => version + 1)
    setQuestionVersion(version => version + 1)
  }, [])
  const sourceState = useCourseSources(course.id, refreshLearningContext)

  function onGithubImported() {
    void sourceState.refresh()
  }

  async function archive() {
    setManaging(true)
    setManagementError('')
    try {
      onArchived(await archiveCourse(course.id, true))
    } catch (reason) {
      setManagementError(reason instanceof Error ? reason.message : '课程归档失败，请重试')
    } finally {
      setManaging(false)
    }
  }

  return (
    <div className="workspace course-workspace" data-reading={view==='reader'}>
      <section className="course-heading" hidden={view==='reader'}>
        <div>
          <span className="eyebrow">{course.school}</span>
          <h1>{course.name}</h1>
          <p>{examCountdown(course.exam_date)} · 按自己的节奏完成复习</p>
        </div>
        <div className="course-heading-actions">
          <div className="course-management" aria-label="课程管理">
            <button type="button" onClick={archive} disabled={managing}>
              {managing ? <LoaderCircle className="spin" size={14} /> : <Archive size={14} />} 归档课程
            </button>
            <button className="delete-course-button" type="button" onClick={() => { setShowDelete(true); setManagementError('') }}>
              <Trash2 size={14} /> 永久删除
            </button>
          </div>
        </div>
      </section>
      {managementError && <div className="learning-error" role="alert">{managementError}</div>}

      <nav hidden={view==='reader'} className="workspace-tabs" aria-label="课程功能">
        {views.map(([id, label]) => <a key={id} href={`#/courses/${course.id}/${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}>{label}</a>)}
      </nav>
      {view==='overview'&&<CourseOverview course={course} state={sourceState}/>}
      {view==='saved'&&<SavedExplanationList key={course.id} courseId={course.id}/>}
      {view==='reader'&&sourceId&&<SavedExplanationBacklinks key={'saved-source-'+sourceId} courseId={course.id} sourceId={sourceId}/>}
      {view==='reader'&&(sourceId?<Suspense fallback={<p role="status">正在加载阅读器…</p>}><CourseReader key={sourceId} courseId={course.id} sourceId={sourceId} assistantOpen={assistantOpen} onAssistantChange={onAssistantChange}/></Suspense>:<p role="alert">资料链接缺少来源身份。<a href={'#/courses/'+course.id+'/materials'}>返回课程资料</a></p>)}
      <div hidden={view !== 'learn'}>
        <SourceProgress state={sourceState} onOpenSources={() => onNavigate('materials')} />
        {sessionId && <div className="selected-round-banner"><span>正在继续选中的历史轮次</span><button className="secondary-action" onClick={() => onNavigate('learn')}>返回最近一轮</button></div>}
        {(visited.has('learn') || view === 'learn') && <LearningPanel sessionId={sessionId} onOpenLatest={() => onNavigate('learn')} courseId={course.id} refreshVersion={learningVersion} onOpenSources={() => onNavigate('materials')} />}
      </div>
      {(visited.has('materials') || view === 'materials') && <section hidden={view !== 'materials'} className="materials-view">
        <div className="view-heading"><div><h2>课程资料</h2><p>查找资料、阅读与批注；正常 PDF 无需等待 AI 解析。</p></div><button className="secondary-action" onClick={() => onNavigate('learn')}>练习题目 <ArrowRight size={16} /></button></div>
        <SourcePanel courseId={course.id} state={sourceState} />
        <details className="import-channels"><summary>其他资料来源 · GitHub / 1037</summary>
          <div className="import-channel-grid"><GitHubPanel courseId={course.id} onImported={onGithubImported} />
            <section><Library size={24} /><h3>1037 资料</h3><p>到官网下载课程资料，再通过上方入口上传。</p><a href="https://1037.wiki" target="_blank" rel="noreferrer">打开 1037 <ExternalLink size={14} /></a></section></div>
        </details>
      </section>}
      {(visited.has('questions') || view === 'questions') && <div hidden={view !== 'questions'}><div className="view-heading"><div><h2>题目校准</h2><p>核对提取的题目和参考答案，为后续学习提供可靠依据。</p></div></div><QuestionBankPanel courseId={course.id} reloadToken={questionVersion} onChanged={() => { setQuestionVersion(version => version + 1); refreshLearningContext() }} /></div>}
      {view === 'history' && <LearningHistoryPanel courseId={course.id} onResume={id => onNavigate('learn', id)} onChanged={refreshLearningContext} />}
      {view === 'analytics' && <><div className="view-heading"><div><h2>考点概览</h2><p>查看现有资料中的考点分布，结合学习记录安排复习。</p></div></div><CoveragePanel courseId={course.id} reloadToken={questionVersion} /><AnalyticsPanel courseId={course.id} reloadToken={questionVersion} /></>}
      {explanation&&<section className="assistant-explanation" aria-label="中央关联讲解"><header><div><span className="eyebrow">临时学习内容</span><h2>关联讲解</h2></div><div className="assistant-explanation-actions"><button type="button" className="secondary-action" onClick={returnToExplanationOrigin}>返回提问位置</button><button type="button" className="secondary-action" onClick={closeExplanation}>关闭讲解</button></div></header><p className="assistant-explanation-question">关联问题：{explanation.question||'（历史问题正文不可用）'}</p><p className="assistant-explanation-question">{explanation.message.mocked?'模拟样本':'已发布回答'} · 不产生新请求</p>{explanation.message.claims.map((claim,index)=><article key={index} className="assistant-explanation-claim"><StudyContent allowLinks={false}>{claim.text}</StudyContent>{claim.kind==='model_explanation'&&<small>模型解释／推导，未经外部资料核验。</small>}{claim.evidence_ids.length>0&&<div className="assistant-explanation-citations">{claim.evidence_ids.map(id=>{const citation=explanation.message.citations?.find(c=>c.evidence_id===id);return <button type="button" key={id} disabled={!citation?.actionable||citationLoading} onClick={()=>void locateExplanation(id)}>{citation?.title||'核对依据'}{citation?.page?' · 第 '+citation.page+' 页':''} · 核对并定位</button>})}</div>}</article>)}{!explanation.message.context_active&&<p role="status">部分原始上下文已失效；以下是保留的历史讲解，不能当作当前有效依据，也不能定位失效来源。</p>}{citationLoading&&<p role="status">正在核对来源…关闭讲解或离开页面会取消定位。</p>}{explanationError&&<p className="assistant-explanation-error" role="alert">{explanationError}</p>}<p className="assistant-explanation-note">临时讲解不会修改原题、原件或个人批注；保存及撤销请使用助手回答消息上的明确保存操作。</p></section>}
      {showDelete && <DeleteCourseDialog course={course} onClose={() => setShowDelete(false)} onDeleted={onDeleted} />}
    </div>
  )
}

function DeleteCourseDialog({ course, onClose, onDeleted }: { course: Course; onClose: () => void; onDeleted: (courseId: string) => void }) {
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (confirmation !== course.name) return
    setBusy(true)
    setError('')
    try {
      await deleteCourse(course.id, confirmation)
      onDeleted(course.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '课程删除失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => !busy && event.target === event.currentTarget && onClose()}>
      <section className="course-dialog delete-course-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-course-title">
        <div className="dialog-heading">
          <div><span className="eyebrow">DANGER / PERMANENT DELETE</span><h2 id="delete-course-title">永久删除「{course.name}」？</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={20} /></button>
        </div>
        <form onSubmit={submit}>
          <p className="delete-warning">此操作无法撤销。课程资料原件、证据、题目、学习会话、作答与统计记录都会永久删除。若只是想收起课程，请使用“归档课程”。</p>
          <label>输入完整课程名称 <span>「{course.name}」</span> 以确认
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus autoComplete="off" required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="delete-dialog-actions">
            <button className="secondary-action" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="danger-action" type="submit" disabled={busy || confirmation !== course.name}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
              {busy ? '正在永久删除…' : '确认永久删除'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CourseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (course: Course) => void }) {
  const [school, setSchool] = useState('华中科技大学')
  const [name, setName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      onCreated(await createCourse({ school, name, exam_date: examDate || null }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="course-dialog" role="dialog" aria-modal="true" aria-labelledby="course-dialog-title">
        <div className="dialog-heading">
          <div><span className="eyebrow">NEW COURSE / 01</span><h2 id="course-dialog-title">创建一门课</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <form onSubmit={submit}>
          <label>学校<input value={school} onChange={(event) => setSchool(event.target.value)} required minLength={2} autoFocus /></label>
          <label>课程名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：操作系统原理" required minLength={2} /></label>
          <label>考试日期 <span>（可稍后补充）</span><input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="form-note">不需要填写考试范围。创建后请批量提供已有资料，Agent 会在有效解析后展示复习计划，经你确认再开始动态诊断。</p>
          <button className="primary-action full-width" type="submit" disabled={submitting}>
            {submitting ? '正在创建…' : '创建课程并添加资料'} <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </div>
  )
}

export default App
