import { useEffect, useState } from 'react'
import { getCourseCoverage } from '../lib/api'
import type { CourseCoverage } from '../lib/api'
import { sourceStatusLabel } from '../lib/source'

export function CoveragePanel({ courseId, reloadToken = 0 }: { courseId: string; reloadToken?: number }) {
  const [coverage, setCoverage] = useState<CourseCoverage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [gapsOnly, setGapsOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setCoverage(null)
    getCourseCoverage(courseId).then(result => { if (active) setCoverage(result) })
      .catch(() => { if (active) setError('覆盖记录暂时无法读取，请重试；读取失败不表示没有缺口。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId, reloadToken, revision])
  const units = coverage?.units.filter(unit => (!gapsOnly || !unit.diagnostic_tasks.length) &&
    `${unit.source_name} ${unit.title} ${unit.topics.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? []
  const lastPage = Math.max(0, Math.ceil(units.length / 20) - 1)
  const currentPage = Math.min(page, lastPage)
  const visibleUnits = units.slice(currentPage * 20, (currentPage + 1) * 20)
  return <section className="coverage-panel" aria-labelledby="coverage-title">
    <h2 id="coverage-title">资料与学习覆盖记录</h2>
    <p>本轮完成不等于整门课学完。先查看哪些页面已有学习记录，哪些尚未检查。</p>
    {loading && <p role="status">正在读取覆盖记录…</p>}
    {error && <p role="alert">{error}</p>}
    <button className="secondary-action" disabled={loading} onClick={() => setRevision(value => value + 1)}>重新读取覆盖记录</button>
    {coverage && <>
      <p className="notice">{coverage.limitation}</p>
      <dl className="coverage-counts">
        <div><dt>已提供资料</dt><dd>{coverage.source_count} 份</dd></div>
        <div><dt>已列单元（含待解析占位）</dt><dd>{coverage.unit_count}</dd></div>
        <div><dt>文本可用单元</dt><dd>{coverage.text_available_units}</dd></div>
        <div><dt>有诊断作答引用的单元</dt><dd>{coverage.diagnostic_linked_units}</dd></div>
        <div><dt>有无提示重测通过引用的单元</dt><dd>{coverage.retest_linked_units}</dd></div>
      </dl>
      <label className="coverage-filter"><input type="checkbox" checked={gapsOnly} onChange={event => { setGapsOnly(event.target.checked); setPage(0) }} />只看尚无有效诊断作答引用的单元</label>
      <label className="coverage-search">查找资料、章节或已关联考点<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} /></label>
      {units.length > 0 && <div className="coverage-pagination" aria-label="覆盖记录分页">
        <span>共 {units.length} 个匹配单元 · 第 {currentPage + 1} / {lastPage + 1} 页（每页最多 20 项）</span>
        <button className="secondary-action" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
        <button className="secondary-action" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </div>}
      {!coverage.units.length && <p>尚无有效课程资料。请先上传资料，不能据此判断课程没有待学内容。</p>}
      {coverage.units.length > 0 && !units.length && <p>当前筛选下没有记录。已有引用仍不等于单元全部内容已经检查。</p>}
      <div className="coverage-units">{visibleUnits.map(unit => <article key={`${unit.source_id}:${unit.node_id ?? 'pending'}`}>
        <h3>{unit.source_name} · {unit.title}</h3>
        <p>{sourceStatusLabel(unit.source_status)} · {unit.text_status === 'available' ? '文本可用' : '文本尚不可用'} · 逐单元语义理解：未建立记录</p>
        <p>{unit.diagnostic_tasks.length ? `${unit.diagnostic_tasks.length} 道已判分诊断引用此单元（不代表全部内容已检查）` : '尚无有效诊断作答引用此单元'}；{unit.retest_tasks.length} 道无提示重测通过引用</p>
        {unit.topics.length > 0 && <p>题目关联考点：{unit.topics.join('、')}（不代表该单元全部考点）</p>}
        <p>关联题目 {unit.questions.length} 道，其中待确认 {unit.questions.filter(question => question.status === 'draft').length} 道</p>
        <a href={`/api/sources/${unit.source_id}/file?inline=true${unit.page_start ? `#page=${unit.page_start}` : ''}`} target="_blank" rel="noreferrer">打开原件{unit.page_start ? ` · 第 ${unit.page_start} 页` : ''}</a>
        <details><summary>查看依据与学习记录</summary>
          {!unit.evidence.length && <p>暂无可引用文本，排队、失败或待确认不表示用户未提供资料。</p>}
          {unit.evidence.map(block => <blockquote key={block.id}><p>{block.excerpt}</p><small>证据 {block.id}{block.page_number ? ` · 第 ${block.page_number} 页` : ''} · 文本节选</small></blockquote>)}
          {[...unit.diagnostic_tasks, ...unit.retest_tasks].map(task => <p key={task.id}><a href={`#/courses/${courseId}/learn?session=${task.session_id}`}>查看所在轮次</a> · {task.knowledge_point} · {task.sub_skill} · {task.verdict === 'correct' ? '通过' : '未通过'}</p>)}
        </details>
      </article>)}</div>
    </>}
  </section>
}
