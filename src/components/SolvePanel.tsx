import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUpRight, BookOpenCheck, FileText, LoaderCircle, Save, Sparkles } from 'lucide-react'
import { createQuestion, solveQuestion } from '../lib/api'
import type { AgentSolution, QuestionProvenance } from '../lib/api'

const DEMO_QUESTION = '什么是死锁？产生死锁需要满足哪些必要条件？'

export function SolvePanel({ courseId, onSaved }: { courseId: string; onSaved?: () => void }) {
  const [question, setQuestion] = useState('')
  const [solution, setSolution] = useState<AgentSolution | null>(null)
  const [working, setWorking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState('')
  const [provenance, setProvenance] = useState<QuestionProvenance>('original')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (question.trim().length < 2) return
    setWorking(true)
    setError('')
    setSavedId('')
    try {
      setSolution(await solveQuestion(courseId, question.trim()))
    } catch (reason) {
      setSolution(null)
      setError(reason instanceof Error ? reason.message : '解题失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  async function saveSolution() {
    if (!solution) return
    setSaving(true)
    setError('')
    try {
      const saved = await createQuestion(courseId, {
        stem: solution.question,
        question_type: 'short_answer',
        answer: solution.answer,
        analysis: `${solution.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n${solution.analysis}`,
        knowledge_points: solution.knowledge_points,
        provenance,
        origin_year: null,
        evidence_ids: solution.citations.map((citation) => citation.evidence_id),
      })
      setSavedId(saved.id)
      onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存题目失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="solve-workbench" id="solve" aria-labelledby="solve-title">
      <header className="solve-heading">
        <div>
          <span className="eyebrow">AGENT / EVIDENCE-BOUND SOLVING</span>
          <h2 id="solve-title">把一道题，解到原文里。</h2>
          <p>先检索当前课程资料，再组织答案、步骤与考点。每条依据都保留来源，不让引用脱离原件。</p>
        </div>
        <div className="solve-stage"><strong>02</strong><span>循证解题</span><small>可演示链路</small></div>
      </header>

      <div className="solve-grid">
        <form className="question-composer" onSubmit={submit}>
          <div className="composer-heading">
            <label htmlFor={`question-${courseId}`}>题目输入</label>
            <button type="button" onClick={() => { setQuestion(DEMO_QUESTION); setError('') }}>填入演示题</button>
          </div>
          <textarea
            id={`question-${courseId}`}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="粘贴一道课后题或真题。例如：什么是死锁？产生死锁需要满足哪些条件？"
            minLength={2}
            maxLength={10000}
            required
          />
          <div className="composer-footer">
            <span>仅检索本课程已解析资料 · {question.length} / 10000</span>
            <button className="solve-button" type="submit" disabled={working || question.trim().length < 2}>
              {working ? <LoaderCircle className="spinning" size={16} /> : <Sparkles size={16} />}
              {working ? '正在检索并解题' : '检索资料并解题'}
            </button>
          </div>
          {error && <p className="solve-error" role="alert">{error}</p>}
          <p className="solve-note">当前未配置真实模型时，将明确显示 Mock 演示结果；复杂计算与推理解答需接入真实模型。</p>
        </form>

        <div className="solution-canvas" aria-live="polite">
          {!solution && !working && (
            <div className="solution-empty">
              <BookOpenCheck size={31} strokeWidth={1.4} />
              <strong>答案不会脱离资料单独出现</strong>
              <p>提交题目后，这里会依次呈现结论、解题过程、考点与课程原文。</p>
              <ol>
                <li><span>01</span> 明确答案</li>
                <li><span>02</span> 解题步骤</li>
                <li><span>03</span> 原文依据</li>
              </ol>
            </div>
          )}
          {working && (
            <div className="solution-empty solution-loading">
              <LoaderCircle className="spinning" size={30} />
              <strong>正在建立题目与课程资料的对应关系</strong>
              <p>检索证据 → 生成结构化解答 → 回填可核验引用</p>
            </div>
          )}
          {solution && !working && (
            <article className="solution-result">
              <div className="solution-meta">
                <span className={solution.mocked ? 'mock-badge' : 'model-badge'}>
                  {solution.mocked ? 'MOCK / 流程演示' : 'MODEL / 真实模型'} · {solution.model}
                </span>
                <span>用量 #{solution.usage_id.slice(0, 8)}</span>
              </div>

              <section className="answer-section">
                <span className="result-label">ANSWER / 答案</span>
                <p>{solution.answer}</p>
              </section>

              <div className="knowledge-row">
                <span className="result-label">涉及考点</span>
                <div>{solution.knowledge_points.map((point) => <span key={point}>{point}</span>)}</div>
              </div>

              <div className="reasoning-grid">
                <section>
                  <span className="result-label">STEPS / 解题步骤</span>
                  <ol className="solution-steps">
                    {solution.steps.map((step, index) => (
                      <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>
                    ))}
                  </ol>
                </section>
                <section className="analysis-section">
                  <span className="result-label">ANALYSIS / 分析</span>
                  <p>{solution.analysis}</p>
                </section>
              </div>

              <section className="citation-section">
                <div className="citation-heading">
                  <span className="result-label">SOURCES / 课程原文依据</span>
                  <span>{solution.citations.length} 条匹配证据</span>
                </div>
                {solution.citations.map((citation, index) => (
                  <article className="solution-citation" key={citation.evidence_id}>
                    <div className="citation-source">
                      <FileText size={17} />
                      <div>
                        <strong>{String(index + 1).padStart(2, '0')} · {citation.source_name}</strong>
                        <span>{citation.node_title}{citation.page_number ? ` · 第 ${citation.page_number} 页` : ''} · 证据 #{citation.evidence_id.slice(0, 8)}</span>
                      </div>
                      <a href={`/api/sources/${citation.source_id}/file`} title="下载原始资料" aria-label={`下载 ${citation.source_name}`}><ArrowUpRight size={17} /></a>
                    </div>
                    <blockquote>{citation.excerpt}</blockquote>
                  </article>
                ))}
              </section>

              <section className="save-question-row">
                <div>
                  <span className="result-label">QUESTION BANK / 结构化入库</span>
                  <p>保存后仍为待校题，不会直接作为已核验题目使用。</p>
                </div>
                <label>来源属性
                  <select value={provenance} onChange={(event) => setProvenance(event.target.value as QuestionProvenance)} disabled={saving || Boolean(savedId)}>
                    <option value="original">原题</option>
                    <option value="adapted">改编题</option>
                  </select>
                </label>
                <button type="button" onClick={saveSolution} disabled={saving || Boolean(savedId)}>
                  {saving ? <LoaderCircle className="spinning" size={15} /> : <Save size={15} />}
                  {savedId ? '已保存 · 待人工校题' : saving ? '正在入库' : '保存到课程题库'}
                </button>
              </section>
            </article>
          )}
        </div>
      </div>
    </section>
  )
}
