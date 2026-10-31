import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, FileText, History, LoaderCircle, Pencil, X } from 'lucide-react'
import {
  listQuestionRevisions,
  listQuestions,
  reviewQuestion,
  updateQuestion,
} from '../lib/api'
import type {
  CourseQuestion,
  QuestionProvenance,
  QuestionRevision,
  QuestionType,
} from '../lib/api'

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  short_answer: '简答题',
  calculation: '计算题',
  other: '其他',
}

interface EditDraft {
  stem: string
  question_type: QuestionType
  answer: string
  analysis: string
  knowledge_points: string
  provenance: QuestionProvenance
  origin_year: string
  change_note: string
}

function toDraft(question: CourseQuestion): EditDraft {
  return {
    stem: question.stem,
    question_type: question.question_type,
    answer: question.answer,
    analysis: question.analysis,
    knowledge_points: question.knowledge_points.join('，'),
    provenance: question.provenance,
    origin_year: question.origin_year?.toString() ?? '',
    change_note: '',
  }
}

interface QuestionBankPanelProps {
  courseId: string
  reloadToken?: number
  onChanged?: () => void
}

export function QuestionBankPanel({ courseId, reloadToken = 0, onChanged }: QuestionBankPanelProps) {
  const [questions, setQuestions] = useState<CourseQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [historyId, setHistoryId] = useState('')
  const [revisions, setRevisions] = useState<Record<string, QuestionRevision[]>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setEditingId('')
    setDraft(null)
    setHistoryId('')
    listQuestions(courseId).then((items) => {
      if (active) setQuestions(items)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '题库读取失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [courseId, reloadToken])

  function replaceQuestion(updated: CourseQuestion) {
    setQuestions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  async function saveEdit(event: FormEvent, question: CourseQuestion) {
    event.preventDefault()
    if (!draft) return
    setWorkingId(question.id)
    setError('')
    try {
      const updated = await updateQuestion(question.id, {
        stem: draft.stem,
        question_type: draft.question_type,
        answer: draft.answer,
        analysis: draft.analysis,
        knowledge_points: draft.knowledge_points.split(/[，,]/).map((point) => point.trim()).filter(Boolean),
        provenance: draft.provenance,
        origin_year: draft.origin_year ? Number(draft.origin_year) : null,
        evidence_ids: question.citations.map((citation) => citation.evidence_id),
        expected_version: question.version,
        change_note: draft.change_note,
      })
      replaceQuestion(updated)
      setEditingId('')
      setDraft(null)
      setRevisions((current) => {
        const next = { ...current }
        delete next[question.id]
        return next
      })
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '校题修改保存失败')
    } finally {
      setWorkingId('')
    }
  }

  async function verify(question: CourseQuestion) {
    setWorkingId(question.id)
    setError('')
    try {
      replaceQuestion(await reviewQuestion(question.id, question.version))
      setRevisions((current) => {
        const next = { ...current }
        delete next[question.id]
        return next
      })
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审核失败')
    } finally {
      setWorkingId('')
    }
  }

  async function toggleHistory(question: CourseQuestion) {
    if (historyId === question.id) {
      setHistoryId('')
      return
    }
    setHistoryId(question.id)
    setError('')
    try {
      const items = await listQuestionRevisions(question.id)
      setRevisions((current) => ({ ...current, [question.id]: items }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '修改历史读取失败')
    }
  }

  return (
    <section className="question-bank" id="questions" aria-labelledby="question-bank-title">
      <header className="question-bank-heading">
        <div>
          <span className="eyebrow">QUESTION BANK / HUMAN REVIEW</span>
          <h2 id="question-bank-title">先入库，再把题目校准。</h2>
          <p>Agent 生成只是草稿。题干、答案、解析、考点与来源属性均可修订，每次修改都会留下版本。</p>
        </div>
        <div className="question-count"><strong>{String(questions.length).padStart(2, '0')}</strong><span>结构化题目</span></div>
      </header>

      {error && <p className="question-bank-error" role="alert">{error}</p>}
      {loading && <p className="question-bank-empty">正在读取课程题库…</p>}
      {!loading && questions.length === 0 && (
        <div className="question-bank-empty">
          <FileText size={25} />
          <p>还没有结构化题目。先在上方完成一次循证解题，再保存到课程题库。</p>
        </div>
      )}

      <div className="question-list">
        {questions.map((question, index) => (
          <article className="question-record" key={question.id}>
            <header className="question-record-heading">
              <span className="question-number">Q{String(index + 1).padStart(2, '0')}</span>
              <div className="question-flags">
                <span>{TYPE_LABELS[question.question_type]}</span>
                <span>{question.provenance === 'original' ? '原题' : '改编题'}</span>
                <span className={question.status === 'verified' ? 'verified-flag' : 'draft-flag'}>
                  {question.status === 'verified' ? '已校题' : '待校题'}
                </span>
                <span>V{question.version}</span>
              </div>
            </header>

            <h3>{question.stem}</h3>
            <div className="question-knowledge">{question.knowledge_points.map((point) => <span key={point}>{point}</span>)}</div>

            {editingId !== question.id && (
              <>
                <details className="question-answer-details">
                  <summary>查看答案、解析与来源</summary>
                  <div className="question-answer-copy">
                    <strong>参考答案</strong><p>{question.answer}</p>
                    <strong>解析</strong><p>{question.analysis}</p>
                    <strong>课程原文依据</strong>
                    {question.citations.map((citation) => (
                      <div className="question-citation" key={citation.evidence_id}>
                        <span>{citation.source_name} · {citation.node_title}{citation.page_number ? ` · 第 ${citation.page_number} 页` : ''}</span>
                        <p>{citation.excerpt}</p>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="question-actions">
                  <button type="button" onClick={() => { setEditingId(question.id); setDraft(toDraft(question)); setError('') }}><Pencil size={14} /> 人工校题</button>
                  {question.status === 'draft' && (
                    <button type="button" className="verify-button" disabled={workingId !== ''} onClick={() => verify(question)}>
                      {workingId === question.id ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />} 确认校题通过
                    </button>
                  )}
                  <button type="button" onClick={() => toggleHistory(question)}><History size={14} /> 修改历史</button>
                </div>
              </>
            )}

            {editingId === question.id && draft && (
              <form className="review-editor" onSubmit={(event) => saveEdit(event, question)}>
                <div className="review-editor-heading">
                  <strong>编辑 V{question.version} · 保存后生成 V{question.version + 1}</strong>
                  <button type="button" aria-label="关闭校题编辑" onClick={() => { setEditingId(''); setDraft(null) }}><X size={16} /></button>
                </div>
                <label>题干<textarea value={draft.stem} onChange={(event) => setDraft({ ...draft, stem: event.target.value })} minLength={2} required /></label>
                <div className="review-field-row">
                  <label>题型<select value={draft.question_type} onChange={(event) => setDraft({ ...draft, question_type: event.target.value as QuestionType })}>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  <label>来源属性<select value={draft.provenance} onChange={(event) => setDraft({ ...draft, provenance: event.target.value as QuestionProvenance })}>
                    <option value="original">原题</option><option value="adapted">改编题</option>
                  </select></label>
                  <label>原题年份<input type="number" min="1900" max="2100" value={draft.origin_year} onChange={(event) => setDraft({ ...draft, origin_year: event.target.value })} placeholder="选填" /></label>
                </div>
                <label>参考答案<textarea value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} required /></label>
                <label>解析<textarea className="analysis-editor" value={draft.analysis} onChange={(event) => setDraft({ ...draft, analysis: event.target.value })} required /></label>
                <label>考点（用逗号分隔）<input value={draft.knowledge_points} onChange={(event) => setDraft({ ...draft, knowledge_points: event.target.value })} required /></label>
                <label>本次修改说明<input value={draft.change_note} onChange={(event) => setDraft({ ...draft, change_note: event.target.value })} maxLength={300} placeholder="例如：对照课件修正答案与解析" required /></label>
                <p>当前绑定的 {question.citations.length} 条证据会保留；编辑保存后题目自动回到“待校题”。</p>
                <button className="save-review-button" type="submit" disabled={workingId !== ''}>
                  {workingId === question.id ? <LoaderCircle className="spinning" size={15} /> : <Check size={15} />} 保存校题修改
                </button>
              </form>
            )}

            {historyId === question.id && (
              <section className="revision-history">
                <span className="result-label">REVISIONS / 修改历史</span>
                {!revisions[question.id] && <p>正在读取历史版本…</p>}
                {revisions[question.id]?.map((revision) => (
                  <div key={revision.id}>
                    <strong>V{revision.version} · {revision.snapshot.status === 'verified' ? '已校题' : '待校题'}</strong>
                    <span>{revision.change_note}</span>
                    <small>{new Date(revision.created_at).toLocaleString('zh-CN')}</small>
                  </div>
                ))}
              </section>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
