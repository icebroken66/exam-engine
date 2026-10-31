import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Circle,
  ExternalLink,
  FileUp,
  Github,
  Library,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react'
import { createCourse, getHealth, listCourses } from './lib/api'
import type { Course, Health } from './lib/api'
import { examCountdown } from './lib/course'
import { SourcePanel } from './components/SourcePanel'
import { GitHubPanel } from './components/GitHubPanel'
import { SolvePanel } from './components/SolvePanel'
import { QuestionBankPanel } from './components/QuestionBankPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'

const workflow = [
  ['01', '汇集资料', '本地 / 1037 / GitHub'],
  ['02', '建立证据库', '页码、章节、完整性'],
  ['03', '诊断与补缺', '统计、练习、重测'],
  ['04', '模拟与对照', '模拟卷、考后三档对照'],
]

function App() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    Promise.allSettled([listCourses(), getHealth()]).then(([courseResult, healthResult]) => {
      if (courseResult.status === 'fulfilled') {
        setCourses(courseResult.value)
        setSelectedId(courseResult.value[0]?.id ?? null)
      } else {
        setError('暂时无法连接课程服务。请确认前后端均已启动。')
      }
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
      setLoading(false)
    })
  }, [])

  const selected = courses.find((course) => course.id === selectedId) ?? null

  function onCreated(course: Course) {
    setCourses((current) => [course, ...current])
    setSelectedId(course.id)
    setShowForm(false)
    setError('')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">急</div>
          <div><strong>期末急救引擎</strong><span>EXAM ENGINE / 0.1</span></div>
        </div>

        <div className="side-section-label">课程工作台</div>
        <button className="new-course-button" onClick={() => setShowForm(true)}>
          <Plus size={17} /> 新建课程
        </button>

        <nav className="course-nav" aria-label="我的课程">
          {loading && <p className="nav-muted">正在读取课程…</p>}
          {!loading && courses.length === 0 && <p className="nav-muted">还没有课程<br />从第一份资料开始。</p>}
          {courses.map((course, index) => (
            <button
              key={course.id}
              className={`course-nav-item ${selectedId === course.id ? 'active' : ''}`}
              onClick={() => setSelectedId(course.id)}
            >
              <span className="course-index">{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{course.name}</strong><small>{course.school}</small></span>
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <p>资料默认私有<br />结论必须可回到原文</p>
        </div>
      </aside>

      <main className="main-canvas">
        <header className="topbar">
          <span>课程证据系统 / 开发基线</span>
          <div className={`service-status ${health ? 'online' : ''}`}>
            <span className="status-dot" />
            {health ? `API 正常 · ${health.database}` : 'API 未连接'}
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {selected ? (
          <CourseWorkspace course={selected} />
        ) : (
          <EmptyWorkspace loading={loading} onCreate={() => setShowForm(true)} />
        )}

        <footer className="page-footer">
          <span>证据优先 · 缺口可见 · 统计必须可复算</span>
          <span>当前：资料、循证解题、校题与统计已连通</span>
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
          <span className="eyebrow">从资料开始，而不是从聊天开始</span>
          <h1>{loading ? '正在准备工作台。' : <>把一门课，<br />变成拿分计划。</>}</h1>
          <p>导入你已有的课件、真题和笔记。系统会保留原文证据、暴露资料缺口，再用诊断和重测安排复习。</p>
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
        <div><FileUp size={21} /><strong>本地文件</strong><span>课件 / 真题 / 笔记</span></div>
        <div><ExternalLink size={21} /><strong>1037 辅助导入</strong><span>官网登录下载后回传</span></div>
        <div><Github size={21} /><strong>GitHub</strong><span>确认目录与版本后导入</span></div>
      </section>
    </div>
  )
}

function CourseWorkspace({ course }: { course: Course }) {
  const [importVersion, setImportVersion] = useState(0)
  const [questionVersion, setQuestionVersion] = useState(0)

  return (
    <div className="workspace course-workspace">
      <section className="course-heading">
        <div>
          <span className="eyebrow">{course.school} / 课程 {course.id.slice(0, 8)}</span>
          <h1>{course.name}</h1>
          <p>{examCountdown(course.exam_date)} · 校本资料、原文证据与可复算统计</p>
        </div>
        <div className="completion-stamp"><strong>04</strong><span>展示步骤</span><small>真实可用链路</small></div>
      </section>

      <nav className="workflow-nav" aria-label="课程展示流程">
        <a href="#sources"><span>01</span><strong>资料与证据</strong><small>原件、解析、完整性</small></a>
        <a href="#solve"><span>02</span><strong>循证解题</strong><small>答案回到课程原文</small></a>
        <a href="#questions"><span>03</span><strong>人工校题</strong><small>版本与审核留痕</small></a>
        <a href="#analytics"><span>04</span><strong>考点统计</strong><small>SQL 可复算结果</small></a>
      </nav>

      <section className="course-grid" id="sources">
        <SourcePanel courseId={course.id} reloadToken={importVersion} />

        <aside className="next-brief">
          <span className="eyebrow">1037 / 辅助导入</span>
          <Library size={29} strokeWidth={1.5} />
          <h2>官网下载，<br />回到这里上传。</h2>
          <p>预览不完整或需要登录时，由你在官网自行登录并下载原件。上传后，系统会为文件建立独立解析状态。</p>
          <a href="https://1037.wiki" target="_blank" rel="noreferrer">
            打开 1037 官网 <ExternalLink size={15} />
          </a>
          <small>本产品不会接收你的 1037 密码，也不会绕过网站访问限制。</small>
          <GitHubPanel courseId={course.id} onImported={() => setImportVersion((version) => version + 1)} />
        </aside>
      </section>

      <SolvePanel key={course.id} courseId={course.id} onSaved={() => setQuestionVersion((version) => version + 1)} />
      <QuestionBankPanel courseId={course.id} reloadToken={questionVersion} onChanged={() => setQuestionVersion((version) => version + 1)} />
      <AnalyticsPanel courseId={course.id} reloadToken={questionVersion} />

      <section className="principle-band">
        <BookOpen size={22} />
        <p><strong>循证解题、结构化入库与人工校题已可试用。</strong>题目保留原文、版本与审核状态；真实模型、判题与完整复习闭环仍在后续任务中。</p>
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
          <p className="form-note">首版面向文字为主的课程。后续导入资料时，你可以逐份确认内容与完整性。</p>
          <button className="primary-action full-width" type="submit" disabled={submitting}>
            {submitting ? '正在创建…' : '创建并进入课程'} <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </div>
  )
}

export default App
