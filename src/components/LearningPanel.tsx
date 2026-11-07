import { useEffect, useState } from 'react'
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
  requestLearningHint,
  startLearningSession,
  submitLearningAttempt,
} from '../lib/api'
import type { CourseContext, LearningSession, LearningTask } from '../lib/api'

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
  diagnostic_advanced: '进入下一道诊断',
  attempt_graded: '保存作答与判分依据',
  hint_requested: '学生请求提示',
  weakness_identified: 'Agent 确定当前薄弱点',
  practice_assigned: 'Agent 安排同类练习',
  remediation_repeated: '练习未通过，回到补缺',
  retest_scheduled: 'Agent 安排独立重测',
  retest_passed: '独立重测通过',
  retest_failed: '重测未通过，继续补缺',
  plan_updated: '更新下一步学习计划',
  grading_failed: '判分受阻，作答已保存',
  session_resumed: '恢复学习会话',
}

const stages = ['diagnosing', 'remediating', 'practicing', 'retesting']

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
  const label = attempt.grading_layer === 'deterministic'
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
        <p>{task.study_answer}</p>
      </div>
      {task.analysis && <div><span className="mini-label">针对性讲解</span><p>{task.analysis}</p></div>}
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

export function LearningPanel({ courseId, refreshVersion = 0 }: { courseId: string; refreshVersion?: number }) {
  const [context, setContext] = useState<CourseContext | null>(null)
  const [session, setSession] = useState<LearningSession | null>(null)
  const [answer, setAnswer] = useState('')
  const [hint, setHint] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState(Date.now())

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([getLearningContext(courseId), getCurrentLearningSession(courseId)])
      .then(([courseContext, currentSession]) => {
        if (!active) return
        setContext(courseContext)
        setSession(currentSession)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '课程准备失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId, refreshVersion])

  const taskId = session?.current_task?.id
  useEffect(() => {
    setAnswer('')
    setHint('')
    setError('')
    setStartedAt(Date.now())
  }, [taskId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!session || !answer.trim()) return
    setBusy('answer')
    setError('')
    try {
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      setSession(await submitLearningAttempt(session.id, answer, elapsed))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '作答提交失败，请重试')
      try {
        setSession(await getLearningSession(session.id))
      } catch {
        setError(`${reason instanceof Error ? reason.message : '作答提交失败'}；进度恢复失败，请刷新页面`)
      }
    } finally {
      setBusy('')
    }
  }

  async function next() {
    if (!session) return
    setBusy('next')
    setError('')
    try {
      setSession(await advanceLearningSession(session.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法进入下一步')
      researchRejectedQuestion(courseId, reason)
    } finally {
      setBusy('')
    }
  }

  async function restart() {
    setLoading(true)
    setError('')
    try {
      setSession(await startLearningSession(courseId, true))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法开始新一轮诊断')
      researchRejectedQuestion(courseId, reason)
    } finally {
      setLoading(false)
    }
  }

  async function showHint() {
    if (!session) return
    setBusy('hint')
    setError('')
    try {
      const result = await requestLearningHint(session.id)
      setHint(result.hint)
      setSession(result.session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法取得提示')
    } finally {
      setBusy('')
    }
  }

  async function beginDiagnostic() {
    setBusy('start')
    setError('')
    try {
      setSession(await startLearningSession(courseId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法生成诊断，请重试')
      researchRejectedQuestion(courseId, reason)
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
          <span><Bot size={17} /> LEARNING AGENT / COURSE PREPARATION</span>
          <span>真实资料锚点 / 逐题动态决策</span>
        </div>
        <div className="preparation-heading">
          <div className="agent-avatar"><Target size={23} /></div>
          <div>
            <span className="eyebrow">课程准备 / 无需预知考试范围</span>
            <h2 id="preparation-title">先提供你已有的资料，再由 Agent 整理复习范围。</h2>
            <p>一次上传整批课件、往年卷、作业或笔记即可，不必手工整理或录题。至少一份资料成功提取出具体考点后，才会生成学习计划。</p>
          </div>
        </div>
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
          <button className="primary-action" type="button" onClick={beginDiagnostic} disabled={!context?.can_start || Boolean(busy)}>
            {busy === 'start' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            {startLabel}
          </button>
          <a className="secondary-action" href="#course-tools">批量提供课程资料 <ArrowRight size={16} /></a>
        </div>
      </section>
    )
  }

  const task = session.current_task
  const attempt = task?.latest_attempt
  const graded = Boolean(attempt && attempt.verdict !== 'ungraded')
  const canAnswer = Boolean(task && ['diagnosing', 'practicing', 'retesting'].includes(session.stage) && !graded)
  const canNext = session.stage === 'blocked' || session.stage === 'remediating' || Boolean(attempt && graded)
  const currentStage = stageIndex(session)

  return (
    <section className="learning-panel" id="learning" aria-labelledby="learning-title">
      <div className="learning-topline">
        <span><Bot size={17} /> LEARNING AGENT / ADAPTIVE</span>
        <span className="session-persisted"><ShieldCheck size={14} /> 作答与进度已持久化</span>
      </div>

      <div className={`knowledge-mode-banner ${session.knowledge_mode}`}>
        <strong>{knowledgeModeLabels[session.knowledge_mode]}</strong>
        <span>{session.visible_limitation}</span>
        {session.scope_text && <small>本次范围：{session.scope_text}</small>}
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
          <span className="mini-label">AGENT 当前判断 · {stageLabels[session.stage as keyof typeof stageLabels] || session.stage}</span>
          <h2 id="learning-title">{session.agent_message}</h2>
          {task?.decision_reason && <p className="decision-reason">下一步依据：{task.decision_reason}</p>}
        </div>
      </div>

      {session.stage === 'diagnosing' && (
        <div className="diagnostic-meter">
          <span>短诊断 · 按最新资料动态调整，答错后另行补缺</span>
          <strong>已诊断 {session.diagnostic_completed} / 建议 {session.diagnostic_target} 个主题 · 已生成 {session.diagnostic_total} 道题</strong>
        </div>
      )}

      {error && <div className="learning-error" role="alert">{error}</div>}

      {session.stage === 'completed' ? (
        <div className="learning-complete">
          <CheckCircle2 size={38} />
          <div>
            <span className="eyebrow">RETEST PASSED</span>
            <h3>不是“看过了”，而是独立重测通过了。</h3>
            <p>本轮完成 {session.diagnostic_total} 道诊断、{session.practice_completed} 道练习和 {session.retest_passed} 次重测。下一步是间隔复习，再处理其他薄弱点。</p>
            <div className="learning-actions"><button className="secondary-action" type="button" onClick={restart}><RotateCcw size={15} /> 开始新一轮诊断</button></div>
          </div>
        </div>
      ) : task && session.stage === 'remediating' ? (
        <div className="remediation-card">
          <span className="task-kicker"><Target size={15} /> 当前薄弱点 · {task.knowledge_point}</span>
          <h3>先补上这个关键点，再练一道同类题。</h3>
          <p>Agent 选择这里，是因为保存的诊断作答中出现了真实错误，而不是按固定章节顺序播放。</p>
          <EvidenceAndAnswer task={task} />
          <div className="learning-actions">
            <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy)}>
              {busy === 'next' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
              {busy === 'next' ? 'Agent 正在出题…' : '开始同类练习'}
            </button>
          </div>
        </div>
      ) : task ? (
        <div className="learning-task-card">
          <div className="task-heading">
            <div>
              <span className="task-kicker">{taskLabel(task)} · {task.knowledge_point}</span>
              <h3>{task.stem}</h3>
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
          <div className="task-blueprint">
            <span>{task.sub_skill}</span>
            <span>{task.cognitive_level} · {task.difficulty_prior}</span>
          </div>
          <p className="task-limitation">{task.visible_limitation}</p>
          <p className="task-validation"><ShieldCheck size={13} /> 独立质量验证：{task.validation_status === 'validated' ? '通过' : task.validation_status}{task.validation_confidence !== null ? ` · ${Math.round(task.validation_confidence * 100)}%` : ''}</p>
          {graded && task.rubric.length > 0 && (
            <div className="task-rubric"><span className="mini-label">评分要点</span><ul>{task.rubric.map((point) => <li key={point}>{point}</li>)}</ul></div>
          )}

          <form onSubmit={submit}>
            {task.options.length > 0 ? (
              <div className="learning-options" role="group" aria-label={task.question_type === 'multiple_choice' ? '请选择全部正确答案' : '请选择答案'}>
                {task.options.map((option) => {
                  const selected = task.question_type === 'multiple_choice' ? answer.split('；').includes(option) : answer === option
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
                      <span>{option}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <label className="answer-field">
                <span>你的独立作答</span>
                <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="写出关键条件与结论，不要只写“懂了”。" rows={5} disabled={!canAnswer || busy === 'answer'} required />
              </label>
            )}

            {attempt && (
              <div className={`attempt-feedback ${attempt.verdict}`} aria-live="polite">
                <div className="feedback-heading">
                  {attempt.verdict === 'correct' ? <CheckCircle2 size={19} /> : attempt.verdict === 'incorrect' ? <XCircle size={19} /> : <RotateCcw size={19} />}
                  <strong>{attempt.verdict === 'correct' ? '回答正确' : attempt.verdict === 'incorrect' ? '这次回答未通过' : '需要补充作答依据'}</strong>
                  <GradingBadge task={task} />
                </div>
                <p>{attempt.feedback}</p>
                <small>第 {attempt.attempt_number} 次作答 · 使用提示 {attempt.hints_used} 次{attempt.confidence !== null ? ` · 判分置信度 ${Math.round(attempt.confidence * 100)}%` : ''}</small>
                {attempt.missing_points.length > 0 && <ul>{attempt.missing_points.map((point) => <li key={point}>{point}</li>)}</ul>}
              </div>
            )}

            {(graded || session.stage === 'remediating') && <EvidenceAndAnswer task={task} />}
            {hint && <div className="hint-box"><Lightbulb size={17} /><p>{hint}</p></div>}

            <div className="learning-actions">
              {canAnswer && (
                <>
                  <button className="primary-action" type="submit" disabled={!answer.trim() || Boolean(busy)}>
                    {busy === 'answer' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                    {busy === 'answer' ? '正在保存并判分…' : attempt?.verdict === 'ungraded' ? '补充后重新提交' : '提交独立作答'}
                  </button>
                  {task.kind !== 'retest' && (
                    <button className="text-action" type="button" onClick={showHint} disabled={Boolean(busy)}>
                      <Lightbulb size={16} /> {busy === 'hint' ? '正在读取提示…' : '给我一点提示'}
                    </button>
                  )}
                </>
              )}
              {canNext && session.stage !== 'blocked' && (
                <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy)}>
                  {busy === 'next' ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                  {busy === 'next' ? 'Agent 正在决策…' : session.next_action}
                </button>
              )}
              {session.stage === 'blocked' && (
                <button className="primary-action" type="button" onClick={next} disabled={Boolean(busy)}><RotateCcw size={17} /> 恢复当前学习任务</button>
              )}
            </div>
          </form>
        </div>
      ) : null}

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
