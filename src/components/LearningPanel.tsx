import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Target,
  XCircle,
} from 'lucide-react'
import {
  advanceLearningSession,
  getCurrentLearningSession,
  getLearningContext,
  getLearningSession,
  startLearningSession,
  submitLearningAttempt,
} from '../lib/api'
import type { CourseContext, LearningSession, LearningTask } from '../lib/api'
import { TutoringPanel } from './TutoringPanel'
import { StudyContent } from './StudyContent'
import { LearningOperationStatus } from './LearningOperationStatus'
import { GradeReviewControls } from './GradeReviewControls'

const stageLabels = {
  diagnosing: '主动诊断',
  remediating: '针对补缺',
  practicing: '同类练习',
  retesting: '独立重测',
  blocked: '等待恢复',
  completed: '本轮完成',
}

const pointStatusLabels: Record<string, string> = {
  weak: '待加强',
  learning: '学习中',
  fragile: '提示依赖 / 不稳固',
  retest_pending: '等待独立重测',
  secure_for_now: '当前独立验证通过',
  needs_review: '待补充依据',
}

const knowledgeModeLabels = {
  course_specific: '课程定制 · 以真实资料为依据',
  hybrid: '课程定制 · 资料锚点 + 标注的补充',
  general: '无有效课程锚点 · 不能开始学习',
}

const confidenceLabels = { low: '证据较少', medium: '证据中等', high: '证据较充分' }

const eventLabels: Record<string, string> = {
  session_created: '建立学习会话',
  knowledge_mode_changed: '更新资料模式与课程上下文',
  diagnostic_refreshed: '新资料已加入未作答诊断，历史保持不变',
  course_context_updated: '新资料已纳入后续学习上下文',
  legacy_questions_excluded: '旧页标题题已退出当前学习判断',
  diagnostic_started: 'Agent 主动发起短诊断',
  diagnostic_generated: '准备好下一道诊断题',
  diagnostic_advanced: '进入下一道诊断',
  attempt_graded: '保存作答与判分依据',
  hint_requested: '学生请求提示',
  tutoring_saved: '带学回复已保存（不计掌握）',
  tutoring_received: '带学回复已送达',
  tutoring_retest_consent: '学生选择将重测转为带学',
  weakness_identified: 'Agent 确定当前薄弱点',
  practice_assigned: 'Agent 安排同类练习',
  remediation_repeated: '练习未通过，回到补缺',
  retest_scheduled: 'Agent 安排独立重测',
  retest_passed: '独立重测通过',
  retest_failed: '重测未通过，继续补缺',
  plan_updated: '更新下一步学习计划',
  grading_failed: '判分受阻，作答已保存',
  session_resumed: '恢复学习会话',
  grade_reviewed: '复核判分并重算学习状态',
  session_reopened: '判分变化，重新打开学习轮次',
}

const stages = ['diagnosing', 'remediating', 'practicing', 'retesting']

function focusLearningArea(selector: string) {
  const area = document.querySelector<HTMLElement>(selector)
  const target = area?.matches('form') ? area.querySelector<HTMLElement>('textarea:not(:disabled), input:not(:disabled)') ?? area : area
  target?.scrollIntoView({ block: 'start' })
  target?.focus({ preventScroll: true })
}

function stageIndex(session: LearningSession) {
  if (session.stage === 'completed') return 4
  return Math.max(0, stages.indexOf(session.stage))
}

function taskLabel(task: LearningTask) {
  if (task.kind === 'diagnostic') return '诊断题'
  return task.kind === 'practice' ? '同类练习' : '独立重测'
}

function researchRejectedQuestion(courseId: string, reason: unknown) {
  const message = reason instanceof Error ? reason.message : ''
  if (/证据|资料|验收|停止发布/.test(message)) {
    window.dispatchEvent(new CustomEvent('exam-engine:research-gap', { detail: { courseId, focus: message } }))
  }
}

function GradingBadge({ task }: { task: LearningTask }) {
  const attempt = task.latest_attempt
  if (!attempt) return null
  const label = attempt.grading_layer === 'human_correction' ? '人工纠正' : attempt.grading_layer === 'deterministic'
    ? '确定性判分'
    : attempt.mocked
      ? 'MOCK 流程判分'
      : '真实模型判分'
  return <span className={`grading-badge ${attempt.mocked ? 'mock' : ''}`}>{label}</span>
}

function EvidenceAndAnswer({ task }: { task: LearningTask }) {
  if (!task.study_answer) return null
  return (
    <div className="learning-explanation">
      <div>
        <span className="mini-label">{task.source_track === 'course' ? '课程依据下的参考答案' : '通用知识参考答案 · 非校本原题'}</span>
        <StudyContent>{task.study_answer}</StudyContent>
      </div>
      {task.analysis && <div><span className="mini-label">针对性讲解</span><StudyContent>{task.analysis}</StudyContent></div>}
      {task.citations.length > 0 && (
        <div className="learning-citations">
          <span className="mini-label"><FileText size={13} /> 回到课程原文</span>
          {task.citations.map((citation) => (
            <blockquote key={citation.evidence_id}>
              <p>{citation.excerpt}</p>
              <cite>{citation.source_name} · {citation.node_title}{citation.page_number ? ` · 第 ${citation.page_number} 页` : ''}</cite>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  )
}

export function LearningPanel({ courseId, refreshVersion = 0, onOpenSources, sessionId, onOpenLatest }: { courseId: string; refreshVersion?: number; onOpenSources: () => void; sessionId?: string | null; onOpenLatest: () => void }) {
  const [context, setContext] = useState<CourseContext | null>(null)
  const [session, setSession] = useState<LearningSession | null>(null)
  const [answer, setAnswerState] = useState('')
  function setAnswer(value: string) {
    setAnswerState(value)
    if (session?.current_task?.id) { try { sessionStorage.setItem(`answer:${session.current_task.id}`, value) } catch { /* Storage may be disabled. */ } }
  }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [tutoringBusy, setTutoringBusy] = useState(false)
  const [error, setError] = useState('')
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const [startedAt, setStartedAt] = useState(Date.now())
  const [loadError, setLoadError] = useState('')
  const [loadVersion, setLoadVersion] = useState(0)
  const lastLoadKey = useRef('')

  useEffect(() => {
    const key = `${courseId}:${sessionId ?? ''}:${refreshVersion}:${loadVersion}`
    if (busy || lastLoadKey.current === key) return
    lastLoadKey.current = key
    let active = true
    let finished = false
    setLoading(true)
    setSession(null); setContext(null); setLoadError(''); setError(''); setRecoveryRequired(false); setRecoveryNotice('')
    const readSession = sessionId ? getLearningSession(sessionId) : getCurrentLearningSession(courseId)
    readSession.then(async current => {
      if (!active) return
      if (current) {
        if (current.course_id !== courseId) setLoadError('该轮次不属于当前课程，请返回最近一轮')
        else setSession(current)
        // An existing task can be displayed directly. Scope analysis belongs to
        // preparing a course or advancing it, not reading a saved answer.
        return
      }
      try {
        const prepared = await getLearningContext(courseId)
        if (active) setContext(prepared)
      } catch { if (active) setLoadError('复习范围暂时无法读取') }
    }).catch(async () => {
      if (!active) return
      setLoadError('学习进度暂时无法读取，请先重试，避免重复开始')
      try {
        const prepared = await getLearningContext(courseId)
        if (active) setContext(prepared)
      } catch { /* Keep the progress recovery action available. */ }
    }).finally(() => { finished = true; if (active) setLoading(false) })
    return () => { active = false; if (!finished) lastLoadKey.current = '' }
  }, [courseId, refreshVersion, sessionId, loadVersion, busy])

  const loadRecovery = loadError && <div className="load-recovery" role="alert"><p>{loadError}。</p><button type="button" className="secondary-action" onClick={() => setLoadVersion(value => value + 1)}>重新读取课程与进度</button></div>

  const taskId = session?.current_task?.id
  useEffect(() => {
    let draft = ''
    try { draft = taskId ? sessionStorage.getItem(`answer:${taskId}`) ?? '' : '' } catch { /* Storage may be disabled. */ }
    setAnswerState(draft)
    setError('')
    setStartedAt(Date.now())
  }, [taskId])

  async function recoverProgress(previous: LearningSession | null, reason?: unknown, currentCourse = false) {
    const failure = reason instanceof TypeError || (reason instanceof DOMException && ['TimeoutError', 'AbortError'].includes(reason.name))
      ? '网络连接中断或等待超时，操作结果暂未确认'
      : reason instanceof Error ? reason.message : '连接中断，操作结果暂未确认'
    try {
      const latest = currentCourse ? await getCurrentLearningSession(courseId) : previous ? await getLearningSession(previous.id) : null
      if (latest) setSession(latest)
      setRecoveryRequired(false)
      const changed = latest && (!previous || latest.id !== previous.id || latest.progress_version !== previous.progress_version)
      if (changed) {
        setError('')
        setRecoveryNotice('已读取服务器保存的最新进度。请核对当前题目和判分后继续；原题草稿仍保留。')
      } else {
        setError(`${failure}。已核对服务器记录，暂未发现进度变化；请确认当前题目后再操作。`)
      }
    } catch {
      setError(`${failure}。暂时无法核对保存结果，请先重新读取进度，避免重复提交。`)
      setRecoveryRequired(true)
    }
  }

  async function reloadSavedProgress() {
    if (busy) return
    setBusy('recovery')
    try { await recoverProgress(session, undefined, !session) }
    finally { setBusy('') }
  }

  const operationStatus = busy && <LearningOperationStatus operation={busy} />
  const recoveryStatus = <>
    {recoveryNotice && <p className="recovery-notice" role="status">{recoveryNotice}</p>}
    {recoveryRequired && <div className="load-recovery" role="alert"><p>操作结果尚未确认，已暂停提交和下一步。作答草稿保留在当前标签页。</p><button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={reloadSavedProgress}>重新读取已保存进度</button></div>}
  </>

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!session || !answer.trim() || busy || tutoringBusy || recoveryRequired) return
    setBusy('answer')
    setError(''); setRecoveryNotice('')
    try {
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      setSession(await submitLearningAttempt(session, answer, elapsed))
    } catch (reason) {
      await recoverProgress(session, reason)
    } finally {
      setBusy('')
    }
  }

  async function next() {
    if (!session || busy || tutoringBusy || recoveryRequired) return
    setRecoveryNotice('')
    setBusy('next')
    setError('')
    try {
      setSession(await advanceLearningSession(session))
    } catch (reason) {
      researchRejectedQuestion(courseId, reason)
      await recoverProgress(session, reason)
    } finally {
      setBusy('')
    }
  }

  async function restart() {
    if (busy || tutoringBusy || recoveryRequired) return
    setBusy('start'); setRecoveryNotice('')
    setError('')
    try {
      setSession(await startLearningSession(courseId, true))
      if (sessionId) onOpenLatest()
    } catch (reason) {
      researchRejectedQuestion(courseId, reason)
      await recoverProgress(session, reason, true)
    } finally {
      setBusy('')
    }
  }

  async function beginDiagnostic() {
    if (busy || tutoringBusy || recoveryRequired) return
    setRecoveryNotice('')
    setBusy('start')
    setError('')
    try {
      setSession(await startLearningSession(courseId))
    } catch (reason) {
      researchRejectedQuestion(courseId, reason)
      await recoverProgress(null, reason, true)
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return <section className="learning-panel learning-loading"><LoaderCircle className="spin" /> Agent 正在识别课程资料并准备复习计划…</section>
  }

  if (!session) {
    const sourceLabel = context?.scope_source === 'course_evidence'
      ? '根据课程资料自动识别'
      : context?.scope_source === 'user'
        ? '沿用你此前补充的范围说明'
        : '等待真实课程资料'
    const awaitingAnchor = !context || context.preparation_status === 'awaiting_anchor'
    const startLabel = busy === 'start'
      ? '正在生成并验证第一题…'
      : context?.preparation_status === 'assessing_materials'
        ? '等待本批资料解析完成'
        : awaitingAnchor
          ? '请先提供至少一份有效资料'
          : context?.preparation_status === 'needs_more_evidence'
            ? '当前资料不足，请先补充'
            : '确认计划，开始动态诊断'
    return (
      <section className="learning-panel course-preparation" id="learning" aria-labelledby="preparation-title">
        <div className="learning-topline">
          <span><Bot size={17} /> 课程准备</span>
          <span>真实资料锚点 / 逐题动态决策</span>
        </div>
        <div className="preparation-heading">
          <div className="agent-avatar"><Target size={23} /></div>
          <div>
            <span className="eyebrow">课程准备 / 无需预知考试范围</span>
            <h2 id="preparation-title">{context?.can_start ? '复习范围已整理好，确认后开始诊断。' : context?.parsing_sources ? '资料正在分析，完成后会自动更新复习范围。' : '先提供你已有的资料，再整理复习范围。'}</h2>
            <p>一次上传整批课件、往年卷、作业或笔记即可，不必手工整理或录题。至少一份资料成功提取出具体考点后，才会生成学习计划。</p>
          </div>
        </div>
        <ol className="preparation-steps" aria-label="开始学习的步骤">
          <li className={!context?.total_sources ? 'current' : 'done'}><span>1</span><strong>提供资料</strong><small>上传已有课件、试卷或笔记</small></li>
          <li className={context?.total_sources && !context.can_start ? 'current' : context?.can_start ? 'done' : ''}><span>2</span><strong>等待分析</strong><small>后台解析，自动识别复习范围</small></li>
          <li className={context?.can_start ? 'current' : ''}><span>3</span><strong>开始诊断</strong><small>确认范围后，逐题独立作答</small></li>
        </ol>
        {loadRecovery}
        {operationStatus}
        {recoveryStatus}
        {context ? (
          <div className="preparation-content">
            <div className={`knowledge-mode-banner ${context.knowledge_mode}`}>
              <strong>{knowledgeModeLabels[context.knowledge_mode]}</strong>
              <span>{context.visible_limitation}</span>
            </div>
            <section className="scope-plan" aria-label="自动识别的复习范围">
              <span className="mini-label">建议复习范围 · {sourceLabel}</span>
              <h3>{context.scope_text}</h3>
              <div className="scope-topics">{context.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
            </section>
            <div className="preparation-facts">
              <span><strong>{context.usable_sources}</strong> 份有效资料</span>
              <span><strong>{context.parsing_sources}</strong> 份正在解析</span>
              <span><strong>{context.failed_sources}</strong> 份需要处理</span>
            </div>
            {context.missing_materials.length > 0 && (
              <p className="preparation-missing">资料缺口：{context.missing_materials.join('、')}。Agent 会优先利用现有资料，再明确请求必要补充。</p>
            )}
          </div>
        ) : <p className="learning-error" role="alert">{error || '暂时无法准备课程，请刷新重试。'}</p>}
        {context && error && <div className="learning-error preparation-error" role="alert">{error}</div>}
        <div className="preparation-actions">
          <button className="primary-action" type="button" onClick={beginDiagnostic} disabled={!context?.can_start || Boolean(busy) || tutoringBusy || recoveryRequired || Boolean(loadError)}>
            {busy === 'start' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            {startLabel}
          </button>
          <button type="button" className={context?.can_start ? 'secondary-action' : 'primary-action'} onClick={onOpenSources}>{context?.parsing_sources ? '查看资料处理进度' : context?.total_sources ? '检查或补充课程资料' : '上传第一份课程资料'} <ArrowRight size={16} /></button>
        </div>
      </section>
    )
  }

  const task = session.current_task
  const attempt = task?.latest_attempt
  const graded = Boolean(attempt && attempt.verdict !== 'ungraded')
  const displayedAnswer = graded && attempt ? attempt.answer : answer
  const canAnswer = Boolean(task && !task.source_removed && ['diagnosing', 'practicing', 'retesting'].includes(session.stage) && !graded)
  const canNext = session.stage === 'blocked' || session.stage === 'remediating' || Boolean(attempt && graded)
  const currentStage = stageIndex(session)

  return (
    <section className="learning-panel" id="learning" aria-labelledby="learning-title">
      <div className="learning-topline">
        <span><Bot size={17} /> 当前学习</span>
        <span className="session-persisted"><ShieldCheck size={14} /> 作答与进度已持久化</span>
      </div>

      {loadRecovery}
      {operationStatus}
      {recoveryStatus}
      <div className={`knowledge-mode-banner ${session.knowledge_mode}`}>
        <strong>{knowledgeModeLabels[session.knowledge_mode]}</strong>
        <span>{session.visible_limitation}</span>
        {session.scope_text && <details className="scope-details"><summary>查看本轮复习范围</summary><p>{session.scope_text}</p></details>}
      </div>

      <div className="learning-progress" aria-label="学习闭环进度">
        {['短诊断', '找薄弱点并补缺', '同类练习', '独立重测'].map((label, index) => (
          <div className={`${index < currentStage ? 'done' : ''} ${index === currentStage ? 'current' : ''}`} key={label}>
            {index < currentStage ? <Check size={14} /> : <Circle size={11} />}
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="agent-decision">
        <div className="agent-avatar"><Bot size={23} /></div>
        <div>
          <span className="mini-label">当前安排 · {stageLabels[session.stage as keyof typeof stageLabels] || session.stage}</span>
          <h2 id="learning-title">{session.stage === 'completed' ? '本轮学习已完成' : session.stage === 'remediating' ? '先补上薄弱点，再继续练习' : session.stage === 'blocked' ? '当前学习需要恢复' : graded ? '核对作答反馈，再继续下一步' : '先独立作答，再看反馈'}</h2>
          <details className="decision-details"><summary>查看当前学习安排与原因</summary>
            <p className="decision-reason">{session.agent_message}</p>
            {task?.decision_reason && task.decision_reason !== session.agent_message && <p className="decision-reason">{task.decision_reason}</p>}
          </details>
        </div>
      </div>

      {session.stage === 'diagnosing' && (
        <div className="diagnostic-meter">
          <span>短诊断 · 按最新资料动态调整，答错后另行补缺</span>
          <strong>已诊断 {session.diagnostic_completed} / 建议 {session.diagnostic_target} 个主题 · 已生成 {session.diagnostic_total} 道题</strong>
        </div>
      )}

      {error && <div className="learning-error" role="alert">{error}</div>}

      {task && session.stage !== 'completed' && session.stage !== 'remediating' && <nav className="learning-jumps" aria-label="当前题快捷导航">
        <button type="button" onClick={() => focusLearningArea('#current-question')}>当前题</button>
        <button type="button" onClick={() => focusLearningArea('#formal-answer')}>正式作答</button>
        {!task.source_removed && <>
          <button type="button" onClick={() => focusLearningArea('.tutoring-panel textarea')}>带学交流</button>
          <button type="button" onClick={() => focusLearningArea('#latest-tutoring')}>最新交流</button>
        </>}
      </nav>}

      {session.stage === 'completed' ? (
        <div className="learning-complete">
          <CheckCircle2 size={38} />
          <div>
            <span className="eyebrow">本轮结果</span>
            <h3>本轮学习已完成</h3>
            <p>已诊断 {session.diagnostic_completed} 个主题，完成 {session.practice_completed} 道练习，通过 {session.retest_passed} 次独立重测。可在学习记录中回看题目与作答，或开始新一轮诊断。</p>
            <p>这只是本轮结果，不代表整门课已覆盖或长期掌握。<a href={`#/courses/${courseId}/analytics`}>查看未检查的资料与覆盖记录</a></p>
            <div className="learning-actions"><button className="secondary-action" type="button" onClick={restart} disabled={Boolean(busy) || tutoringBusy || recoveryRequired}><RotateCcw size={15} /> 开始新一轮诊断</button></div>
          </div>
        </div>
      ) : task && session.stage === 'remediating' ? (
        <div className="remediation-card">
          <span className="task-kicker"><Target size={15} /> 当前薄弱点 · {task.knowledge_point}</span>
          <h3>先补上这个关键点，再练一道同类题。</h3>
          <p>Agent 选择这里，是因为保存的诊断作答中出现了真实错误，而不是按固定章节顺序播放。</p>
          <EvidenceAndAnswer task={task} />
          <div className="learning-actions">
            <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy) || tutoringBusy || recoveryRequired}>
              {busy === 'next' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
              {busy === 'next' ? 'Agent 正在出题…' : '开始同类练习'}
            </button>
          </div>
        </div>
      ) : !task ? (
        <div className="learning-empty">
          <h3>本轮还没有准备好可作答的题目</h3>
          <p>首次出题可能仍在处理中，也可能中途失败。先读取已保存进度；确认没有结果后，可以重试准备当前轮次，不会另建一轮。</p>
          <div className="learning-actions">
            <button className="secondary-action" type="button" disabled={Boolean(busy)} onClick={reloadSavedProgress}>读取已保存进度</button>
            {sessionId ? <button className="secondary-action" type="button" onClick={onOpenLatest}>返回最近一轮</button> : <button className="primary-action" type="button" disabled={Boolean(busy) || tutoringBusy || recoveryRequired} onClick={beginDiagnostic}>重试准备当前轮次</button>}
          </div>
        </div>
      ) : task ? (
        <div className="learning-task-card">
          <div className="task-heading" id="current-question" tabIndex={-1}>
            <div>
              <span className="task-kicker">{taskLabel(task)} · {task.knowledge_point}</span>
              <StudyContent>{task.stem}</StudyContent>
            </div>
            <span className="provenance-badge">
              {task.provenance === 'original'
                ? task.answer_provenance === 'ai'
                  ? '真实原题 · AI 参考答案'
                  : task.answer_provenance === 'human' ? '真实原题 · 人工校订答案' : '真实原题 · 原卷答案'
                : task.provenance === 'adapted'
                  ? '真实原题改编'
                  : task.source_track === 'general' ? '通用生成题' : '无合适原题 · 循证原创'}
            </span>
          </div>
          <details className="task-quality"><summary>题目质量与适用范围</summary><div className="task-blueprint">
            <span>{task.sub_skill}</span>
            <span>{task.cognitive_level} · {task.difficulty_prior}</span>
          </div>
          <p className="task-limitation">{task.visible_limitation}</p>
          <p className="task-validation"><ShieldCheck size={13} /> 独立质量验证：{task.validation_status === 'validated' ? '通过' : task.validation_status}{task.validation_confidence !== null ? ` · ${Math.round(task.validation_confidence * 100)}%` : ''}</p></details>
          {task.source_removed && <p className="notice" role="status">这道题引用的资料已移除，已有记录保留。请依据剩余资料重新安排；没有有效资料时需先补传。</p>}
          {graded && task.rubric.length > 0 && (
            <div className="task-rubric"><span className="mini-label">评分要点</span><ul>{task.rubric.map((point) => <li key={point}>{point}</li>)}</ul></div>
          )}

          <form onSubmit={submit} id="formal-answer" tabIndex={-1}>
            {graded && attempt && <div className="saved-answer" role="region" aria-label="已保存的作答"><span className="mini-label">已保存的作答</span><StudyContent>{attempt.answer}</StudyContent><small>以下判分对应这份服务器记录。</small></div>}
            {task.options.length > 0 ? (
              <div className="learning-options" role="group" aria-label={task.question_type === 'multiple_choice' ? '请选择全部正确答案' : '请选择答案'}>
                {task.options.map((option) => {
                  const selected = task.question_type === 'multiple_choice' ? displayedAnswer.split('；').includes(option) : displayedAnswer === option
                  return (
                    <label className={selected ? 'selected' : ''} key={option}>
                      <input
                        type={task.question_type === 'multiple_choice' ? 'checkbox' : 'radio'}
                        name="answer"
                        value={option}
                        checked={selected}
                        onChange={(event) => {
                          if (task.question_type !== 'multiple_choice') return setAnswer(event.target.value)
                          const current = answer.split('；').filter(Boolean)
                          setAnswer(event.target.checked ? [...current, option].join('；') : current.filter((item) => item !== option).join('；'))
                        }}
                        disabled={!canAnswer || busy === 'answer'}
                      />
                      <StudyContent>{option}</StudyContent>
                    </label>
                  )
                })}
              </div>
            ) : !graded ? (
              <label className="answer-field">
                <span>{task.help_exposures > 0 ? '你的正式作答（已接受帮助）' : '你的独立作答'}</span>
                <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写出关键条件与结论，不要只写“懂了”。" rows={5} disabled={!canAnswer || busy === 'answer'} required />
              </label>
            ) : null}

            {attempt && (
              <div className={`attempt-feedback ${attempt.verdict}`} aria-live="polite">
                <div className="feedback-heading">
                  {attempt.verdict === 'correct' ? <CheckCircle2 size={19} /> : attempt.verdict === 'incorrect' ? <XCircle size={19} /> : <RotateCcw size={19} />}
                  <strong>{attempt.verdict === 'correct' ? '回答正确' : attempt.verdict === 'incorrect' ? '这次回答未通过' : '需要补充作答依据'}</strong>
                  <GradingBadge task={task} />
                </div>
                <StudyContent>{attempt.feedback}</StudyContent>
                <small>第 {attempt.attempt_number} 次作答 · 使用提示 {attempt.hints_used} 次{attempt.confidence !== null ? ` · 判分置信度 ${Math.round(attempt.confidence * 100)}%` : ''}</small>
                {attempt.missing_points.length > 0 && <ul>{attempt.missing_points.map((point) => <li key={point}>{point}</li>)}</ul>}
              </div>
            )}

            {attempt && <GradeReviewControls key={attempt.id} sessionId={session.id} attempt={attempt} onChanged={setSession} disabled={Boolean(busy) || tutoringBusy || recoveryRequired} />}

            {(graded || session.stage === 'remediating') && <EvidenceAndAnswer task={task} />}

            <div className="learning-actions">
              {canAnswer && (
                <>
                  <button className="primary-action" type="submit" disabled={!answer.trim() || Boolean(busy) || tutoringBusy || recoveryRequired}>
                    {busy === 'answer' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                    {busy === 'answer' ? '正在保存并判分…' : attempt?.verdict === 'ungraded' ? '补充后重新提交' : task.help_exposures > 0 ? '提交正式作答（已接受帮助）' : '提交独立作答'}
                  </button>
                  {task.kind !== 'retest' && (
                    <button className="text-action" type="button" onClick={() => { const input = document.querySelector<HTMLTextAreaElement>('.tutoring-panel textarea'); input?.scrollIntoView({ behavior: 'smooth', block: 'center' }); input?.focus({ preventScroll: true }) }} disabled={Boolean(busy) || tutoringBusy || recoveryRequired}>
                      <Lightbulb size={16} /> 围绕当前题求助
                    </button>
                  )}
                </>
              )}
              {canNext && session.stage !== 'blocked' && (
                <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy) || tutoringBusy || recoveryRequired}>
                  {busy === 'next' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                  {busy === 'next' ? 'Agent 正在决策…' : session.next_action}
                </button>
              )}
              {session.stage === 'blocked' && (
                <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy) || tutoringBusy || recoveryRequired}><RotateCcw size={17} /> {task.source_removed ? '依据剩余资料重新安排' : '恢复当前学习任务'}</button>
              )}
            </div>
          </form>
        </div>
      ) : null}

      {task && session.stage !== 'completed' && !task.source_removed && <TutoringPanel key={task.id} session={session} onChanged={setSession} onBusy={setTutoringBusy} disabled={Boolean(busy) || recoveryRequired} />}

      {session.points.length > 0 && (
        <div className="learning-state-grid">
          <div className="point-state-list">
            <div className="subsection-heading"><span>学习状态</span><small>掌握状态与证据充分度分开</small></div>
            {session.points.map((point) => (
              <div className="point-state" key={point.knowledge_point}>
                <div><strong>{point.knowledge_point}</strong><span>{pointStatusLabels[point.status] || point.status}</span></div>
                <div className="mastery-track"><i style={{ width: `${Math.round(point.score * 100)}%` }} /></div>
                <small>{confidenceLabels[point.evidence_confidence]} · {point.evidence_count} 次有效作答 · 独立证据分 {Math.round(point.score * 100)}{point.hint_dependent ? ' · 当前仍依赖提示' : ''}</small>
              </div>
            ))}
            <p className="state-note">提示后答对与即时巩固不会冒充独立掌握；一次重测也不代表永久掌握。</p>
          </div>
          <div className="agent-event-list">
            <div className="subsection-heading"><span>Agent 行动记录</span><small>可回放</small></div>
            {session.recent_events.slice(-5).map((event) => (
              <div className="agent-event" key={event.id}><Circle size={8} /><span>{eventLabels[event.kind] || event.kind}</span></div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
