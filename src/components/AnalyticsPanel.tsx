import { useEffect, useState } from 'react'
import { BarChart3, Calculator, LoaderCircle } from 'lucide-react'
import { getCourseAnalytics } from '../lib/api'
import type { CourseAnalytics, QuestionType } from '../lib/api'

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  short_answer: '简答题',
  calculation: '计算题',
  other: '其他',
}

export function AnalyticsPanel({ courseId, reloadToken = 0 }: { courseId: string; reloadToken?: number }) {
  const [analytics, setAnalytics] = useState<CourseAnalytics | null>(null)
  const [halfLife, setHalfLife] = useState(3)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    getCourseAnalytics(courseId, halfLife).then((result) => {
      if (active) setAnalytics(result)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '课程统计读取失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [courseId, reloadToken, halfLife])

  const maxWeighted = Math.max(1, ...(analytics?.knowledge_points.map((point) => point.weighted_frequency) ?? []))

  return (
    <section className="analytics-panel" id="analytics" aria-labelledby="analytics-title">
      <header className="analytics-heading">
        <div>
          <span className="eyebrow">COURSE ANALYTICS / SQL AGGREGATION</span>
          <h2 id="analytics-title">常考什么，让题目自己说话。</h2>
          <p>只统计已校题的原题。考点频次、年份衰减和题型占比均由数据库聚合，可以逐题核对。</p>
        </div>
        <div className="analytics-stage"><strong>04</strong><span>考点统计</span><small>非模型估数</small></div>
      </header>

      <div className="analytics-toolbar">
        <div className="analytics-summary">
          <div><span>纳入统计原题</span><strong>{analytics?.included_original_question_count ?? 0}</strong></div>
          <div><span>已校题（含改编）</span><strong>{analytics?.verified_question_count ?? 0}</strong></div>
          <div><span>草稿未计入</span><strong>{analytics?.draft_question_count ?? 0}</strong></div>
          <div><span>改编题未计入</span><strong>{analytics?.adapted_question_count ?? 0}</strong></div>
        </div>
        <label>年份半衰期
          <select value={halfLife} onChange={(event) => setHalfLife(Number(event.target.value))}>
            <option value={2}>2 年</option><option value={3}>3 年</option><option value={5}>5 年</option>
          </select>
        </label>
      </div>

      {error && <p className="analytics-error" role="alert">{error}</p>}
      {loading && <div className="analytics-empty"><LoaderCircle className="spinning" size={22} /> 正在从题目表重新计算…</div>}
      {!loading && analytics && analytics.included_original_question_count === 0 && (
        <div className="analytics-empty"><BarChart3 size={26} /><p>还没有纳入统计的原题。请先在题库中填写原题年份，并完成人工校题。</p></div>
      )}

      {!loading && analytics && analytics.included_original_question_count > 0 && (
        <div className="analytics-grid">
          <section className="knowledge-stats">
            <div className="analytics-section-heading">
              <span className="result-label">KNOWLEDGE / 考点频率</span>
              <span>截至 {analytics.as_of_year} 年</span>
            </div>
            <div className="knowledge-table-head"><span>考点</span><span>原题数</span><span>衰减频次</span></div>
            {analytics.knowledge_points.map((point) => (
              <article className="knowledge-stat" key={point.id}>
                <div className="knowledge-stat-main">
                  <strong>{point.name}</strong>
                  <span>{point.question_count}</span>
                  <span>{point.weighted_frequency.toFixed(2)}</span>
                </div>
                <div className="frequency-track"><span style={{ width: `${Math.max(2, point.weighted_frequency / maxWeighted * 100)}%` }} /></div>
                <details>
                  <summary>核对计算与 {point.questions.length} 道贡献题目</summary>
                  <div className="contribution-details">
                    {point.yearly_contributions.map((item) => (
                      <p key={item.year}>{item.year} 年：{item.question_count} 题 × 衰减 {item.decay_factor} = {item.weighted_count}</p>
                    ))}
                    {point.unknown_year_count > 0 && <p>{point.unknown_year_count} 道题缺少年份，仅计入原题数，不参与衰减频次。</p>}
                    <ul>
                      {point.questions.map((question) => (
                        <li key={question.id}><span>{question.origin_year ?? '年份未知'} · {TYPE_LABELS[question.question_type]}</span>{question.stem}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              </article>
            ))}
          </section>

          <section className="type-skeleton">
            <div className="analytics-section-heading">
              <span className="result-label">TYPES / 题型骨架</span>
              <span>按原题数占比</span>
            </div>
            {analytics.question_types.map((item) => (
              <article className="type-stat" key={item.question_type}>
                <div><strong>{TYPE_LABELS[item.question_type]}</strong><span>{item.question_count} 题 · {(item.share * 100).toFixed(1)}%</span></div>
                <div className="type-track"><span style={{ width: `${item.share * 100}%` }} /></div>
                <small>{item.yearly_counts.map((year) => `${year.year ?? '年份未知'}：${year.question_count} 题`).join(' / ')}</small>
              </article>
            ))}
            <div className="formula-note">
              <Calculator size={18} />
              <p>年份权重 = 2<sup>−max(0, {analytics.as_of_year} − 原题年份) / {analytics.half_life_years}</sup>。缺年份不猜测、不加权。</p>
            </div>
          </section>
        </div>
      )}
      {analytics && analytics.unknown_year_question_count > 0 && (
        <p className="analytics-footnote">本课程有 {analytics.unknown_year_question_count} 道纳入统计的原题缺少年份；请在校题编辑器中补齐后再查看衰减频次。</p>
      )}
    </section>
  )
}
