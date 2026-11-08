import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { StudyContent } from './StudyContent'
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
  options: string
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
    options: question.options.join('\n'),
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
  const [editingQuestion, setEditingQuestion] = useState<CourseQuestion | null>(null)
  const [historyId, setHistoryId] = useState('')
  const [revisions, setRevisions] = useState<Record<string, QuestionRevision[]>>({})
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const visible = questions.filter(question => (!query.trim() || `${question.stem} ${question.knowledge_points.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
    && (filter === 'all' || (filter === 'pending' ? !question.reviewed_at : filter === 'stem' ? !question.stem_reviewed_at : filter === 'answer' ? !question.answer_reviewed_at : Boolean(question.reviewed_at))))

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
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
    setHistoryId(current => current === updated.id ? '' : current)
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
        options: draft.options.split('\n').map(option => option.trim()).filter(Boolean),
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

  async function verify(question: CourseQuestion, scope: 'stem' | 'answer') {
    setWorkingId(question.id)
    setError('')
    try {
      replaceQuestion(await reviewQuestion(question.id, question.version, scope))
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
          <span className="eyebrow">资料题库</span>
          <h2 id="question-bank-title">核对题目与答案</h2>
          <p>往年卷会自动逐题入库。请对照原件确认题干与选项，再核对答案与解析；两项分别记录，不会把 AI 验收当作人工确认。修改后需重新确认，每次操作均保留版本。</p>
        </div>
        <div className="question-count"><strong>{String(questions.length).padStart(2, '0')}</strong><span>结构化题目</span></div>
      </header>

      {error && <p className="question-bank-error" role="alert">{error}</p>}
      {loading && <p className="question-bank-empty">正在读取课程题库…</p>}
      {!loading && questions.length === 0 && (
        <div className="question-bank-empty">
          <FileText size={25} />
          <p>暂无待核验的结构化题目。这里仅用于后台质量核验，不需要手动录题才能开始学习。</p>
        </div>
      )}

      <div className="question-filters"><label>查找题目<input value={query} onChange={event => setQuery(event.target.value)} placeholder="题干关键词或考点" /></label><label>确认状态<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部题目</option><option value="pending">尚未全部人工确认</option><option value="stem">题干待人工确认</option><option value="answer">答案待人工确认</option><option value="human">人工已确认</option></select></label><span>显示 {visible.length} / {questions.length} 道</span></div>
      {!loading && questions.length > 0 && !visible.length && <p className="notice">没有匹配的题目，请调整关键词或筛选条件。</p>}
      <div className="question-list">
        {visible.map((question) => (
          <article className="question-record" key={question.id}>
            <header className="question-record-heading">
              <span className="question-number">Q{String(questions.indexOf(question) + 1).padStart(2, '0')}</span>
              <div className="question-flags">
                <span>{TYPE_LABELS[question.question_type]}</span>
                <span>{question.provenance === 'original' ? '原题' : '改编题'}</span>
                <span>{question.answer_provenance === 'source' ? '原卷答案' : question.answer_provenance === 'ai' ? 'AI 参考答案' : question.answer_provenance === 'human' ? '人工校订答案' : '答案待确认'}</span>
                <span className={question.status === 'verified' ? 'verified-flag' : 'draft-flag'}>
                  {question.reviewed_at ? '人工校题通过' : question.status === 'verified' ? 'AI 验收通过' : '待校准'}
                </span>
                <span className={question.stem_reviewed_at ? 'verified-flag' : 'draft-flag'}>{question.stem_reviewed_at ? '题干已人工确认' : '题干待人工确认'}</span>
                <span className={question.answer_reviewed_at ? 'verified-flag' : 'draft-flag'}>{question.answer_reviewed_at ? '答案已人工确认' : '答案待人工确认'}</span>
                <span>V{question.version}</span>
              </div>
            </header>

            <div className="question-stem"><StudyContent>{question.stem}</StudyContent></div>
            {question.options.length > 0 && <ul className="question-options">{question.options.map(option => <li key={option}><StudyContent>{option}</StudyContent></li>)}</ul>}
            <div className="question-knowledge">{question.knowledge_points.map((point) => <span key={point}>{point}</span>)}</div>
            {question.extraction_issues.length > 0 && <p className="question-bank-error">待确认：{question.extraction_issues.join('；')}</p>}

            {editingId !== question.id && (
              <>
                <details className="question-answer-details">
                  <summary>查看答案、解析与来源</summary>
                  <div className="question-answer-copy">
                    <strong>{question.answer_provenance === 'ai' ? 'AI 参考答案（非原卷答案）' : '参考答案'}</strong><StudyContent>{question.answer || '尚未提供可靠答案'}</StudyContent>
                    <strong>解析</strong><StudyContent>{question.analysis}</StudyContent>
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
                  <button type="button" onClick={() => { setEditingId(question.id); setEditingQuestion(question); setDraft(toDraft(question)); setError('') }}><Pencil size={14} /> 人工校题</button>
                  {!question.stem_reviewed_at && <button type="button" className="verify-button" disabled={workingId !== ''} onClick={() => verify(question, 'stem')}><Check size={14} /> 确认题干与选项</button>}
                  {!question.answer_reviewed_at && <button type="button" className="verify-button" disabled={workingId !== '' || !question.answer.trim() || question.answer_provenance === 'missing'} onClick={() => verify(question, 'answer')}><Check size={14} /> 确认答案与解析</button>}
                  {question.source_id && <a className="question-original" href={`/api/sources/${question.source_id}/file?inline=true`} target="_blank" rel="noreferrer">打开原件对照</a>}
                  <button type="button" onClick={() => toggleHistory(question)}><History size={14} /> 修改历史</button>
                </div>
              </>
            )}

            {editingId === question.id && draft && (
              <form className="review-editor" onSubmit={(event) => saveEdit(event, editingQuestion ?? question)}>
                <div className="review-editor-heading">
                  <strong>编辑 V{editingQuestion?.version ?? question.version} · 保存后生成 V{(editingQuestion?.version ?? question.version) + 1}</strong>
                  <button type="button" aria-label="关闭校题编辑" onClick={() => { setEditingId(''); setDraft(null) }}><X size={16} /></button>
                </div>
                <label>题干<textarea aria-label="题干" value={draft.stem} onChange={(event) => setDraft({ ...draft, stem: event.target.value })} minLength={2} required /></label>
                <div className="review-field-row">
                  <label>题型<select value={draft.question_type} onChange={(event) => setDraft({ ...draft, question_type: event.target.value as QuestionType })}>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  <label>来源属性<select value={draft.provenance} onChange={(event) => setDraft({ ...draft, provenance: event.target.value as QuestionProvenance })}>
                    <option value="original">原题</option><option value="adapted">改编题</option>
                  </select></label>
                  <label>原题年份<input type="number" min="1900" max="2100" value={draft.origin_year} onChange={(event) => setDraft({ ...draft, origin_year: event.target.value })} placeholder="选填" /></label>
                </div>
                <label>选项（每行一个；非选择题可留空）<textarea aria-label="选项（每行一个；非选择题可留空）" value={draft.options} onChange={event => setDraft({ ...draft, options: event.target.value })} /></label>
                <p>题干、答案与解析支持 Markdown、代码块和 $公式$；保存后的预览会显示排版结果。</p>
                <label>参考答案<textarea aria-label="参考答案" value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} required /></label>
                <label>解析<textarea aria-label="解析" className="analysis-editor" value={draft.analysis} onChange={(event) => setDraft({ ...draft, analysis: event.target.value })} required /></label>
                <label>考点（用逗号分隔）<input value={draft.knowledge_points} onChange={(event) => setDraft({ ...draft, knowledge_points: event.target.value })} required /></label>
                <label>本次修改说明<input value={draft.change_note} onChange={(event) => setDraft({ ...draft, change_note: event.target.value })} maxLength={300} placeholder="例如：对照课件修正答案与解析" required /></label>
                <p>当前绑定的 {question.citations.length} 条证据会保留；编辑保存后题干与答案的人工确认均需重新核对，题目回到“待校题”。</p>
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
                    <strong>V{revision.version} · {revision.snapshot.reviewed_at ? '人工校题通过' : revision.snapshot.status === 'verified' ? ('reviewed_at' in revision.snapshot ? 'AI 验收通过' : '已通过 · 确认方式未记录') : '待校准'}</strong>
                    <span>{revision.change_note}</span>
                    {'stem_reviewed_at' in revision.snapshot && <small>题干：{revision.snapshot.stem_reviewed_at ? '人工已确认' : '待人工确认'} · 答案：{revision.snapshot.answer_reviewed_at ? '人工已确认' : '待人工确认'}</small>}
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
