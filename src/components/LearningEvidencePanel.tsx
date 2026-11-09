import { useEffect, useState } from 'react'
import { getCourseLearningEvidence } from '../lib/api'
import type { CourseLearningEvidence } from '../lib/api'

const labels = { correct: '答对', incorrect: '未通过', ungraded: '尚未判分' }
const date = (value: string) => new Date(value).toLocaleString('zh-CN')

export function LearningEvidencePanel({ courseId, reloadToken, onOpen }: {
  courseId: string; reloadToken: number; onOpen: (sessionId: string, taskId: string) => void
}) {
  const [report, setReport] = useState<CourseLearningEvidence | null>(null)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setReport(null)
    getCourseLearningEvidence(courseId, page).then(value => { if (active) setReport(value) })
      .catch(() => { if (active) setError('学习依据暂时无法读取，请重试；读取失败不表示没有记录。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId, reloadToken, page, revision])
  return <section className="learning-evidence-panel" aria-labelledby="learning-evidence-title">
    <div className="view-heading"><div><h3 id="learning-evidence-title">下次复习依据</h3><p>回看各轮作答，决定哪些内容需要撤提示、补缺或隔天复测。</p></div>
      <button className="secondary-action" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新复习依据</button></div>
    {loading && <p role="status">正在读取复习依据…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p>每题取最新作答，共 {report.total} 条；可参考 {report.usable_count} 条，暂不复用 {report.excluded_count} 条，到期可复测 {report.due_count} 条。</p>
      <p className="state-note">{report.limitation}</p>
      {!report.total && <p>还没有正式作答记录。带学交流不会自动成为掌握证据。</p>}
      <div className="learning-evidence-list">{report.items.map(item => <article key={item.task_id}>
        <strong>{item.knowledge_point}</strong>
        {item.sub_skill && <p>{item.sub_skill}</p>}
        <p>{labels[item.verdict]} · 提示 {item.hints_used} 次 · {date(item.taken_at)}</p>
        <p className={item.usable ? 'state-note' : 'notice'}>{item.explanation}</p>
        {item.due_at && <p className="state-note">建议复测时间：{date(item.due_at)}</p>}
        <button className="secondary-action" onClick={() => onOpen(item.session_id, item.task_id)}>查看这次作答与纠错</button>
      </article>)}</div>
      {report.total > report.page_size && <div className="coverage-pagination" aria-label="复习依据分页">
        <button className="secondary-action" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页依据</button>
        <span>第 {page} / {Math.ceil(report.total / report.page_size)} 页</span>
        <button className="secondary-action" disabled={page * report.page_size >= report.total} onClick={() => setPage(value => value + 1)}>下一页依据</button>
      </div>}
    </>}
  </section>
}
