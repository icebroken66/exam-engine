import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive,
  ArrowRight,
  ChevronRight,
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
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { LearningPanel } from './components/LearningPanel'
import { LearningHistoryPanel } from './components/LearningHistoryPanel'
import { useCourseSources } from './lib/useCourseSources'
import { SourceProgress } from './components/SourceProgress'

const workflow = [
  ['01', '提供课程资料', '课件、往年卷、作业或笔记'],
  ['02', '确认复习范围', '从现有资料识别具体考点'],
  ['03', '诊断与补缺', '逐题作答，找到薄弱点'],
  ['04', '独立重测', '用新题检查是否真正掌握'],
]

const views = [['learn', '开始学习'], ['materials', '课程资料'], ['questions', '题目校准'], ['history', '学习记录'], ['analytics', '考点概览']] as const
type View = typeof views[number][0]
function readRoute() {
  const [path, query] = window.location.hash.split('?')
  const match = path.match(/^#\/courses\/([^/]+)\/(\w+)$/)
  return { sessionId: new URLSearchParams(query).get('session'), courseId: match?.[1] ?? null, view: (views.some(([view]) => view === match?.[2]) ? match![2] : 'learn') as View }
}

function App() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => readRoute().courseId)
  const [view, setView] = useState<View>(() => readRoute().view)
  const [sessionId, setSessionId] = useState<string | null>(() => readRoute().sessionId)
  useEffect(() => {
    const sync = () => { const route = readRoute(); setSelectedId(route.courseId); setView(route.view); setSessionId(route.sessionId) }
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  function navigate(courseId: string | null, nextView: View = 'learn', nextSession: string | null = null) {
    setSelectedId(courseId); setView(nextView); setSessionId(nextSession)
    window.location.hash = courseId ? `/courses/${courseId}/${nextView}${nextSession ? `?session=${encodeURIComponent(nextSession)}` : ''}` : ''
  }
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
        navigate(chosen?.id ?? null, readRoute().view, chosen?.id === wanted ? readRoute().sessionId : null)
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
    <div className="app-shell">
      <aside className="sidebar">
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
          {activeCourses.map((course, index) => (
            <button
              key={course.id}
              className={`course-nav-item ${selectedId === course.id ? 'active' : ''}`}
              onClick={() => navigate(course.id)}
            >
              <span className="course-index">{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{course.name}</strong><small>{course.school}</small></span>
              <ChevronRight size={15} />
            </button>
          ))}
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
          <span>从课程资料到独立作答</span>
          <div className={`service-status ${health ? 'online' : ''}`}>
            <span className="status-dot" />
            {health ? '服务已连接' : 'API 未连接'}
          </div>
        </header>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="secondary-action" type="button" onClick={() => setConnectionVersion(value => value + 1)} disabled={loading}>重新连接</button></div>}

        {selected ? (
          <CourseWorkspace key={selected.id} course={selected} view={view} sessionId={sessionId} onNavigate={(nextView, nextSession) => navigate(selected.id, nextView, nextSession)} onArchived={onArchived} onDeleted={onDeleted} />
        ) : (
          <EmptyWorkspace loading={loading} onCreate={() => setShowForm(true)} />
        )}

        <footer className="page-footer">
          <span>证据优先 · 作答留痕 · 低置信不冒充掌握</span>
          <span>诊断 → 补缺 → 练习 → 独立重测</span>
        </footer>
      </main>

      {showForm && <CourseDialog onClose={() => setShowForm(false)} onCreated={onCreated} />}
    </div>
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
  view: View
  sessionId: string | null
  onNavigate: (view: View, sessionId?: string | null) => void
  onArchived: (course: Course) => void
  onDeleted: (courseId: string) => void
}

function CourseWorkspace({ course, view, sessionId, onNavigate, onArchived, onDeleted }: CourseWorkspaceProps) {
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
    <div className="workspace course-workspace">
      <section className="course-heading">
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

      <nav className="workspace-tabs" aria-label="课程功能">
        {views.map(([id, label]) => <a key={id} href={`#/courses/${course.id}/${id}`} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}>{label}</a>)}
      </nav>
      <div hidden={view !== 'learn'}>
        <SourceProgress state={sourceState} onOpenSources={() => onNavigate('materials')} />
        {sessionId && <div className="selected-round-banner"><span>正在继续选中的历史轮次</span><button className="secondary-action" onClick={() => onNavigate('learn')}>返回最近一轮</button></div>}
        <LearningPanel sessionId={sessionId} onOpenLatest={() => onNavigate('learn')} courseId={course.id} refreshVersion={learningVersion} onOpenSources={() => onNavigate('materials')} />
      </div>
      {(visited.has('materials') || view === 'materials') && <section hidden={view !== 'materials'} className="materials-view">
        <div className="view-heading"><div><h2>课程资料</h2><p>上传课件、往年卷或笔记，解析完成后回到学习页开始诊断。</p></div><button className="secondary-action" onClick={() => onNavigate('learn')}>返回学习 <ArrowRight size={16} /></button></div>
        <SourcePanel courseId={course.id} state={sourceState} />
        <details className="import-channels"><summary>其他资料来源 · GitHub / 1037</summary>
          <div className="import-channel-grid"><GitHubPanel courseId={course.id} onImported={onGithubImported} />
            <section><Library size={24} /><h3>1037 资料</h3><p>到官网下载课程资料，再通过上方入口上传。</p><a href="https://1037.wiki" target="_blank" rel="noreferrer">打开 1037 <ExternalLink size={14} /></a></section></div>
        </details>
      </section>}
      {(visited.has('questions') || view === 'questions') && <div hidden={view !== 'questions'}><div className="view-heading"><div><h2>题目校准</h2><p>核对提取的题目和参考答案，为后续学习提供可靠依据。</p></div></div><QuestionBankPanel courseId={course.id} reloadToken={questionVersion} onChanged={() => { setQuestionVersion(version => version + 1); refreshLearningContext() }} /></div>}
      {view === 'history' && <LearningHistoryPanel courseId={course.id} onResume={id => onNavigate('learn', id)} onChanged={refreshLearningContext} />}
      {view === 'analytics' && <><div className="view-heading"><div><h2>考点概览</h2><p>查看现有资料中的考点分布，结合学习记录安排复习。</p></div></div><AnalyticsPanel courseId={course.id} reloadToken={questionVersion} /></>}
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
