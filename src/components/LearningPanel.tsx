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
  getLearningSession,
  requestLearningHint,
  startLearningSession,
  submitLearningAttempt,
} from '../lib/api'
import type { LearningSession, LearningTask } from '../lib/api'

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
  needs_review: '待补充依据',
  retest_passed: '重测通过',
  mastered: '达到当前规则',
}

const eventLabels: Record<string, string> = {
  session_created: '建立学习会话',
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
        <span className="mini-label">课程依据下的参考答案</span>
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

export function LearningPanel({ courseId }: { courseId: string }) {
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
    startLearningSession(courseId)
      .then((value) => { if (active) setSession(value) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '学习会话启动失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

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

  if (loading) {
    return <section className="learning-panel learning-loading"><LoaderCircle className="spin" /> Agent 正在读取课程上下文并恢复学习状态…</section>
  }

  if (!session) {
    return (
      <section className="learning-panel learning-unavailable" id="learning">
        <Target size={30} />
        <span className="eyebrow">AGENT / 学习行动</span>
        <h2>Agent 还缺少课程上下文</h2>
        <p>{error || '先导入并解析一份课程资料，Agent 才能发起有依据的诊断。'}</p>
        <a className="secondary-action" href="#course-tools">去导入课程资料 <ArrowRight size={16} /></a>
      </section>
    )
  }

  const task = session.current_task
  const attempt = task?.latest_attempt
  const graded = Boolean(attempt && attempt.verdict !== 'ungraded')
  const canAnswer = Boolean(task && ['diagnosing', 'practicing', 'retesting'].includes(session.stage) && !graded)
  const canNext = session.stage === 'blocked' || session.stage === 'remediating' || Boolean(attempt && graded)
  const currentStage = stageIndex(session)
  const decision = [...session.recent_events].reverse().find((event) => event.kind === 'weakness_identified')

  return (
    <section className="learning-panel" id="learning" aria-labelledby="learning-title">
      <div className="learning-topline">
        <span><Bot size={17} /> LEARNING AGENT / A0</span>
        <span className="session-persisted"><ShieldCheck size={14} /> 作答与进度已持久化</span>
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
          {decision && <p className="decision-reason">决策依据：{String(decision.payload.reason)}</p>}
        </div>
      </div>

      {session.stage === 'diagnosing' && (
        <div className="diagnostic-meter">
          <span>诊断进度</span>
          <strong>{session.diagnostic_completed} / {session.diagnostic_total}</strong>
          <div><i style={{ width: `${session.diagnostic_total ? session.diagnostic_completed / session.diagnostic_total * 100 : 0}%` }} /></div>
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
            <span className="provenance-badge">{task.provenance === 'original' ? '已审核原题' : '基于资料生成'}</span>
          </div>

          <form onSubmit={submit}>
            {task.options.length > 0 ? (
              <div className="learning-options" role="radiogroup" aria-label="请选择答案">
                {task.options.map((option) => (
                  <label className={answer === option ? 'selected' : ''} key={option}>
                    <input type="radio" name="answer" value={option} checked={answer === option} onChange={(event) => setAnswer(event.target.value)} disabled={!canAnswer || busy === 'answer'} />
                    <span>{option}</span>
                  </label>
                ))}
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
                  <button className="text-action" type="button" onClick={showHint} disabled={Boolean(busy)}>
                    <Lightbulb size={16} /> {busy === 'hint' ? '正在读取提示…' : '给我一点提示'}
                  </button>
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
            <div className="subsection-heading"><span>学习状态</span><small>由真实作答计算</small></div>
            {session.points.map((point) => (
              <div className="point-state" key={point.knowledge_point}>
                <div><strong>{point.knowledge_point}</strong><span>{pointStatusLabels[point.status] || point.status}</span></div>
                <div className="mastery-track"><i style={{ width: `${Math.round(point.score * 100)}%` }} /></div>
                <small>当前证据分 {Math.round(point.score * 100)} · {point.evidence_count} 次有效作答</small>
              </div>
            ))}
            <p className="state-note">分数是本轮作答证据，不代表永久掌握。</p>
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
