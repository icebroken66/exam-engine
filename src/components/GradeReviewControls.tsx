import { useState } from 'react'
import { correctLearningAttempt, reviewLearningAttempt } from '../lib/api'
import type { LearningAttempt, LearningSession } from '../lib/api'
import { StudyContent } from './StudyContent'

const verdictLabel = (verdict: string) => verdict === 'correct' ? '正确' : verdict === 'incorrect' ? '未通过' : '待确认'

export function GradeReviewControls({ sessionId, attempt, onChanged, disabled = false }: {
  sessionId: string; attempt: LearningAttempt; onChanged: (session: LearningSession) => void; disabled?: boolean
}) {
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'ai' | 'human'>('ai')
  const [verdict, setVerdict] = useState<LearningAttempt['verdict']>('ungraded')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canReview = attempt.grading_layer.startsWith('evidence_model')
  async function submit() {
    setBusy(true); setError('')
    try {
      const result = mode === 'ai' && canReview
        ? await reviewLearningAttempt(sessionId, attempt.id, reason, attempt.review_history.length)
        : await correctLearningAttempt(sessionId, attempt, verdict, reason)
      setReason(''); onChanged(result)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
    finally { setBusy(false) }
  }
  return <div className="grade-controls">
    <details className="grade-review">
      <summary>对判分有疑问？复核或纠正</summary>
      <div className="review-form">
        <label>处理方式<select value={canReview ? mode : 'human'} disabled={busy || disabled} onChange={event => setMode(event.target.value as 'ai' | 'human')}>
          {canReview && <option value="ai">请 AI 独立复核</option>}
          <option value="human">人工纠正判分</option>
        </select></label>
        {(mode === 'human' || !canReview) && <>
          <label>核对后的结论<select value={verdict} onChange={event => setVerdict(event.target.value as LearningAttempt['verdict'])} disabled={busy || disabled}>
            <option value="ungraded">依据不足，标为待确认</option><option value="correct">回答正确</option><option value="incorrect">回答未通过</option>
          </select></label>
          <p className="notice">人工纠正将作为本轮学习的新判分依据。请对照题目和资料说明理由；原判分会保留。</p>
        </>}
        <label className="answer-field">{mode === 'ai' && canReview ? '复核理由' : '纠正依据'}
          <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={4000} disabled={busy || disabled} placeholder="说明遗漏的条件、等价解法或原文依据" />
        </label>
        {error && <p role="alert" className="learning-error">{error} 请刷新记录后核对最新判分。</p>}
        <button className="secondary-action" type="button" disabled={busy || disabled || reason.trim().length < 2} onClick={submit}>
          {busy ? '正在处理…' : mode === 'ai' && canReview ? '提交判分复核' : '保存人工纠正'}
        </button>
        <p className="state-note">结果保存后重算掌握状态。AI 复核仍可能出错；纠正已结束轮次可能使该轮重新待学。</p>
      </div>
    </details>
    {attempt.review_history.map(review => <details className="grade-review-history" key={review.id}>
      <summary>{review.method === 'human' ? '人工纠正记录' : 'AI 复核记录'} · {verdictLabel(review.previous.verdict)} → {verdictLabel(review.revised.verdict)}</summary>
      <p>理由：{review.reason}</p>
      <div className="grade-comparison"><section><strong>原判分 · {verdictLabel(review.previous.verdict)}</strong><StudyContent>{review.previous.feedback}</StudyContent></section>
        <section><strong>更新后 · {verdictLabel(review.revised.verdict)}</strong><StudyContent>{review.revised.feedback}</StudyContent></section></div>
    </details>)}
  </div>
}
