import { useEffect, useRef, useState } from 'react'
import type { LearningSession, TutoringHistory } from '../lib/api'
import { acknowledgeTutoring, getTutoring, sendTutoring } from '../lib/api'
import { StudyContent } from './StudyContent'
import { LearningOperationStatus } from './LearningOperationStatus'

const actions: Record<string, string> = { probe: '探查思路', clarify: '澄清卡点', hint: '渐进提示', explain: '针对讲解', example: '举例说明', counterexample: '反例辨析', prerequisite: '先修补缺', check: '小检查（不计分）', verify: '回应异议与查证', continue: '回到当前题', pause: '建议暂停' }
const helpLabels: Record<string, string> = { none: '对话支持', direction: '方向提示', step: '步骤帮助', worked_answer: '完整示范' }

export function TutoringPanel({ session, disabled, onChanged, onBusy }: { session: LearningSession; disabled: boolean; onChanged: (session: LearningSession) => void; onBusy: (busy: boolean) => void }) {
  const task = session.current_task!
  const [history, setHistory] = useState<TutoringHistory | null>(null)
  const [message, setMessage] = useState(() => { try { return sessionStorage.getItem(`tutoring:${task.id}`) ?? '' } catch { return '' } })
  const [allowHelp, setAllowHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const live = useRef(true)
  const remoteRunning = useRef(false)
  const changed = useRef(onChanged); changed.current = onChanged
  const busyCallback = useRef(onBusy); busyCallback.current = onBusy
  function apply(result: TutoringHistory) {
    if (!live.current) return
    setHistory(result); changed.current(result.session)
    remoteRunning.current = result.turns.some(turn => turn.status === 'running')
    busyCallback.current(remoteRunning.current)
  }
  async function read() {
    setBusy(true); setError('')
    try { apply(await getTutoring(session.id, task.id)); setNotice('') }
    catch { if (live.current) { setHistory(null); setError('带学记录暂时无法读取。先重读，避免重复请求。') } }
    finally { if (live.current) setBusy(false) }
  }
  useEffect(() => {
    live.current = true
    void read()
    return () => { live.current = false; busyCallback.current(false) }
  // The parent remounts this component for a new task.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, task.id])
  useEffect(() => {
    if (!history) return
    for (const turn of history.turns) if (turn.status === 'saved' && !turn.delivered_at) {
      // A receipt is a bookkeeping write, never a paid generation retry.
      void acknowledgeTutoring(session.id, turn.id).catch(() => {})
    }
  }, [history, session.id])
  async function send() {
    if (!message.trim() || busy || disabled || !history || history.turns.some(turn => turn.status === 'running')) return
    remoteRunning.current = true
    setBusy(true); onBusy(true); setError(''); setNotice('')
    try {
      const result = await sendTutoring(session, crypto.randomUUID(), history.sequence, message, allowHelp)
      apply(result); setMessage('')
      try { sessionStorage.removeItem(`tutoring:${task.id}`) } catch { /* optional local draft */ }
    } catch {
      try { apply(await getTutoring(session.id, task.id)); setNotice('发送结果有变化或连接中断，已读取保存记录。请核对后继续，不会自动重发。') }
      catch { setHistory(null); setError('发送结果尚未确认，请先读取带学记录；你的文字仍保留。') }
    } finally { if (live.current) { setBusy(false); busyCallback.current(remoteRunning.current) } }
  }
  const running = history?.turns.some(turn => turn.status === 'running') ?? false
  const needsConsent = task.kind === 'retest' && !history?.retest_help_enabled
  function renderTurn(turn: TutoringHistory['turns'][number]) {
    return <article key={turn.id}>
      <div className="tutoring-student"><strong>你的交流</strong><StudyContent>{turn.student_message}</StudyContent></div>
      {turn.reply ? <div className="tutoring-reply"><strong>{actions[turn.reply.action] ?? turn.reply.action}{turn.mocked ? ' · MOCK 流程演示' : ''}</strong><span className="tutoring-help">本轮：{helpLabels[turn.reply.help_level] ?? turn.reply.help_level}</span>
        <StudyContent>{turn.reply.message}</StudyContent>
        {turn.reply.uncertainty && <p>仍待核对：{turn.reply.uncertainty}</p>}
        <details><summary>查看教学依据与待确认观察</summary><p>{turn.reply.reason}</p>{turn.reply.observation && <p>教学观察（不计掌握）：{turn.reply.observation}</p>}
          {turn.citations.map(citation => <blockquote key={citation.evidence_id}><p>{citation.excerpt}</p><a href={`/api/sources/${citation.source_id}/file?inline=true${citation.page_number ? `#page=${citation.page_number}` : ''}`} target="_blank" rel="noreferrer">{citation.source_name} · {citation.node_title}</a></blockquote>)}
        </details></div> : <p>{turn.status === 'running' ? '回复正在生成' : turn.error || '此回复已过期，未发布到当前题'}</p>}
    </article>
  }
  return <section className="tutoring-panel" aria-labelledby="tutoring-title">
    <h3 id="tutoring-title">围绕当前题带学</h3>
    <p className="tutoring-boundary">交流不提交答案、不计掌握；回复保存后计入本题帮助。</p>
    <details className="tutoring-guide"><summary>带学怎么用与独立性说明</summary>
      <p>讲你的思路、没懂的步骤，要求直接解释或质疑判分。小检查只作教学观察；帮助后答对不能算本题无提示独立成功。回复保存后可恢复，送达未确认也保守记录帮助。每条标签表示导师标记的当轮帮助；“对话支持”不会清除本题过去的帮助记录或恢复独立性。</p>
      <p>对判分有异议可使用题目区的“对判分有疑问？复核或纠正”；对话不会改写成绩。</p>
    </details>
    {needsConsent && <label className="tutoring-consent"><input type="checkbox" checked={allowHelp} disabled={busy || disabled} onChange={event => setAllowHelp(event.target.checked)} />我选择将本次独立重测转为带学，本题之后的作答不再计为无提示重测；不会自动判错或通过。</label>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <LearningOperationStatus operation="tutoring" />}
    {running && <p role="status">服务器仍在生成这条带学回复，请稍后读取记录。不要重复发送。</p>}
    <button type="button" className="secondary-action" disabled={busy || disabled} onClick={() => void read()}>读取带学记录</button>
    <div className="tutoring-turns">
      {history && history.turns.length > 1 && <details className="tutoring-older"><summary>较早交流（{history.turns.length - 1} 条）</summary>{history.turns.slice(0, -1).map(renderTurn)}</details>}
      <div id="latest-tutoring" tabIndex={-1} aria-label="最新交流">{history?.turns.slice(-1).map(renderTurn)}</div>
    </div>
    <label className="answer-field"><span>和导师交流当前题</span><textarea rows={3} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!needsConsent || allowHelp) void send() } }} value={message} disabled={busy || disabled || running} onChange={event => { setMessage(event.target.value); try { sessionStorage.setItem(`tutoring:${task.id}`, event.target.value) } catch { /* optional draft */ } }} placeholder="例如：我想先投影再选择，但第二步不知道还剩哪些列。" maxLength={4000} /></label>
    <button className="primary-action" type="button" disabled={busy || disabled || running || !history || !message.trim() || (needsConsent && !allowHelp)} onClick={() => void send()}>{busy ? '正在交流…' : '发送带学消息（不提交答案）'}</button>
    <small>Ctrl / ⌘ + Enter 发送交流；正式作答请返回题目区。</small>
  </section>
}
