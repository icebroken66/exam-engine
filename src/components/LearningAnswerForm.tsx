import type { FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Lightbulb, LoaderCircle, RotateCcw, XCircle } from 'lucide-react'
import type { LearningSession, LearningTask } from '../lib/clients/learning'
import { StudyContent } from './StudyContent'
import { GradeReviewControls } from './GradeReviewControls'
import { GradingBadge, EvidenceAndAnswer } from './LearningAnswerFeedback'

type Props = {
  session: LearningSession
  task: LearningTask
  answer: string
  setAnswer: (value: string) => void
  submit: (event: FormEvent) => void
  next: () => void
  setSession: (session: LearningSession) => void
  busy: string
  tutoringBusy: boolean
  recoveryRequired: boolean
  graded: boolean
  displayedAnswer: string
  canAnswer: boolean
  canNext: boolean
}

export function LearningAnswerForm({ session, task, answer, setAnswer, submit, next, setSession, busy, tutoringBusy, recoveryRequired, graded, displayedAnswer, canAnswer, canNext }: Props) {
  const attempt = task.latest_attempt
  return (
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
  )
}
