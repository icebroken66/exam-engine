import { useEffect, useState } from 'react'
import { getLearningHistory, listLearningSessions } from '../lib/api'
import type { LearningSessionHistory, LearningSessionSummary } from '../lib/api'
import { GradeReviewControls } from './GradeReviewControls'
import { StudyContent } from './StudyContent'

const stages: Record<string, string> = { completed: '已完成', diagnosing: '诊断中', practicing: '练习中', remediating: '补缺中', retesting: '重测中', blocked: '待恢复' }
const verdicts: Record<string, string> = { correct: '正确', incorrect: '未通过', ungraded: '待确认' }
const date = (value: string) => new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).toLocaleString('zh-CN')

export function LearningHistoryPanel({ courseId, onChanged, onResume }: { courseId: string; onChanged: () => void; onResume: (sessionId: string) => void }) {
  const [sessions, setSessions] = useState<LearningSessionSummary[]>([])
  const [selected, setSelected] = useState('')
  const [history, setHistory] = useState<LearningSessionHistory | null>(null)
  const [taskId, setTaskId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    listLearningSessions(courseId).then(items => {
      if (!active) return
      setSessions(items); setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '')
      if (!items.length) setLoading(false)
    }).catch(reason => { if (active) { setError(reason.message); setLoading(false) } })
    return () => { active = false }
  }, [courseId, version])
  useEffect(() => {
    if (!selected) return
    let active = true
    setLoading(true); setError(''); setHistory(null)
    getLearningHistory(selected).then(result => {
      if (!active) return
      setHistory(result); setTaskId(current => result.tasks.some(item => item.task.id === current) ? current : result.tasks[0]?.task.id ?? '')
    }).catch(reason => { if (active) setError(reason.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selected, version])
  const entry = history?.tasks.find(item => item.task.id === taskId)
  return <section className="history-panel" aria-labelledby="history-title">
    <div className="view-heading"><div><h2 id="history-title">学习记录</h2><p>回看每道题与每次作答，也可以复核和纠正历史判分。</p></div>
      <button className="secondary-action" onClick={() => setVersion(value => value + 1)}>刷新记录</button></div>
    {error && <p className="learning-error" role="alert">{error}</p>}
    {sessions.length > 0 && <label className="history-session-select">选择学习轮次<select value={selected} onChange={event => setSelected(event.target.value)}>
      {sessions.map((session, index) => <option key={session.id} value={session.id}>第 {sessions.length - index} 轮 · {date(session.created_at)} · {stages[session.stage] ?? session.stage}</option>)}
    </select></label>}
    {history && history.session.stage !== 'completed' && <div className="selected-round-banner"><span>这轮学习尚未完成，可以回到原题继续。</span><button className="primary-action" onClick={() => onResume(selected)}>继续这一轮</button></div>}
    {loading ? <p role="status">正在读取学习记录…</p> : !sessions.length ? <div className="empty-state"><h3>还没有学习记录</h3><p>开始诊断并提交作答后，完整记录会保存在这里。</p></div> : history && <div className="history-layout">
      <nav className="history-task-list" aria-label="历史题目">{history.tasks.map(({ task, attempts }, index) => <button key={task.id} className={taskId === task.id ? 'active' : ''} onClick={() => setTaskId(task.id)} aria-current={taskId === task.id ? 'true' : undefined}>
        <span>{String(index + 1).padStart(2, '0')} · {task.kind === 'diagnostic' ? '诊断' : task.kind === 'practice' ? '练习' : '重测'}</span><strong>{task.knowledge_point}</strong><small>{attempts.length ? verdicts[attempts.at(-1)!.verdict] : '未作答'} · {attempts.length} 次作答</small>
      </button>)}</nav>
      {entry && <article className="history-detail" key={entry.task.id}>
        <span className="mini-label">题目 · {entry.task.knowledge_point}</span><StudyContent>{entry.task.stem}</StudyContent>{entry.task.source_removed && <p className="notice">这道题引用的资料已从课程移除。题目与作答仅作历史追溯，后续学习使用当前有效资料。</p>}
        {entry.task.options.length > 0 && <ul>{entry.task.options.map(option => <li key={option}><StudyContent>{option}</StudyContent></li>)}</ul>}
        {!entry.attempts.length && <p className="notice">这道题尚未作答。请到「开始学习」继续，参考答案在判分后开放。</p>}
        {entry.attempts.map(attempt => <section className="history-attempt" key={attempt.id}>
          <div className="feedback-heading"><strong>第 {attempt.attempt_number} 次作答 · {verdicts[attempt.verdict]}</strong><span className="grading-badge">{attempt.grading_layer === 'human_correction' ? '人工纠正' : attempt.grading_layer === 'deterministic' ? '确定性判分' : attempt.mocked ? '模拟判分' : '模型判分'}</span></div>
          <h4>我的作答</h4><StudyContent>{attempt.answer}</StudyContent><h4>判分反馈</h4><StudyContent>{attempt.feedback}</StudyContent>
          <p className="state-note">使用提示 {attempt.hints_used} 次{attempt.confidence !== null ? ` · 判分置信度 ${Math.round(attempt.confidence * 100)}%` : ''}</p>
          <GradeReviewControls sessionId={selected} attempt={attempt} onChanged={() => { onChanged(); setVersion(value => value + 1) }} />
        </section>)}
        {entry.task.study_answer && <details className="history-reference"><summary>参考答案与原文依据</summary><StudyContent>{entry.task.study_answer}</StudyContent><StudyContent>{entry.task.analysis || ''}</StudyContent>{entry.task.citations.map(citation => <blockquote key={citation.evidence_id}><StudyContent>{citation.excerpt}</StudyContent><cite>{citation.source_name} · {citation.node_title}{citation.page_number ? ` · 第 ${citation.page_number} 页` : ''}</cite></blockquote>)}</details>}
      </article>}
    </div>}
  </section>
}
