import { useEffect, useRef, useState } from 'react'
import { Check, Download, FileText, Layers, LoaderCircle, Play, Plus, Sparkles, Upload, X } from 'lucide-react'
import { explainEvidence, getCourseCompleteness, listEvidence, listSources, queueParse, uploadSource } from '../lib/api'
import type { AgentExplanation, CourseCompleteness, EvidenceBlock, Source } from '../lib/api'
import { formatFileSize, sourceStatusLabel } from '../lib/source'

export function SourcePanel({ courseId, reloadToken = 0 }: { courseId: string; reloadToken?: number }) {
  const [sources, setSources] = useState<Source[]>([])
  const [completeness, setCompleteness] = useState<CourseCompleteness | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rights, setRights] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [evidence, setEvidence] = useState<EvidenceBlock[]>([])
  const [evidenceSourceId, setEvidenceSourceId] = useState<string | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [explanations, setExplanations] = useState<Record<string, AgentExplanation>>({})
  const [explainingId, setExplainingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setFile(null)
    setRights(false)
    setEvidence([])
    setEvidenceSourceId(null)
    setExplanations({})
    setCompleteness(null)
    listSources(courseId).then((items) => {
      if (active) setSources(items)
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '资料读取失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    getCourseCompleteness(courseId).then((report) => {
      if (active) setCompleteness(report)
    }).catch(() => {
      if (active) setError('课程完整性报告暂时无法读取')
    })
    return () => { active = false }
  }, [courseId, reloadToken])

  const hasActiveTask = sources.some((source) => ['queued', 'running'].includes(source.status))
  useEffect(() => {
    if (!hasActiveTask) return
    let active = true
    const timer = window.setTimeout(() => {
      Promise.all([listSources(courseId), getCourseCompleteness(courseId)]).then(([items, report]) => {
        if (!active) return
        setSources(items)
        setCompleteness(report)
      }).catch(() => undefined)
    }, 700)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [courseId, hasActiveTask, sources])

  async function refreshCompleteness() {
    try {
      setCompleteness(await getCourseCompleteness(courseId))
    } catch {
      setError('资料已更新，但课程完整性报告暂时无法刷新')
    }
  }

  async function submitUpload() {
    if (!file || !rights) return
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const result = await uploadSource(courseId, file)
      setSources((current) => result.deduplicated ? current : [result.source, ...current])
      setMessage(result.deduplicated ? '内容已存在，已复用课程中的原件。' : `已保存《${result.source.original_name}》，可以加入解析队列。`)
      setFile(null)
      setRights(false)
      if (inputRef.current) inputRef.current.value = ''
      await refreshCompleteness()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  async function startParse(source: Source) {
    setError('')
    setMessage('')
    try {
      await queueParse(source.id)
      setSources((current) => current.map((item) => item.id === source.id ? { ...item, status: 'queued' } : item))
      setMessage(`《${source.original_name}》已加入解析队列，后台 worker 正在处理。`)
      await refreshCompleteness()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加入队列失败')
    }
  }

  async function showEvidence(source: Source) {
    setEvidenceSourceId(source.id)
    setEvidenceLoading(true)
    setError('')
    try {
      setEvidence(await listEvidence(source.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '证据读取失败')
    } finally {
      setEvidenceLoading(false)
    }
  }

  async function explain(block: EvidenceBlock) {
    setExplainingId(block.id)
    setError('')
    try {
      const result = await explainEvidence(courseId, block.id)
      setExplanations((current) => ({ ...current, [block.id]: result }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '证据讲解生成失败')
    } finally {
      setExplainingId(null)
    }
  }

  const evidenceSource = sources.find((source) => source.id === evidenceSourceId)

  return (
    <div className="source-panel">
      <div className="section-heading"><span>课程资料清单</span><span>{String(sources.length).padStart(2, '0')} FILES</span></div>

      {completeness && (
        <section className="completeness-ledger" aria-label="课程资料完整性">
          <div className="completeness-heading">
            <strong>{completeness.complete ? '资料解析完整' : `${completeness.attention_sources} 份资料需要关注`}</strong>
            <span>解析完整性 / 非考点覆盖率</span>
          </div>
          <dl className="completeness-stats">
            <div><dt>全部资料</dt><dd>{completeness.total_sources}</dd></div>
            <div><dt>可用资料</dt><dd>{completeness.ready_sources}</dd></div>
            <div><dt>原文证据</dt><dd>{completeness.evidence_blocks}</dd></div>
            <div><dt>待处理</dt><dd>{completeness.attention_sources}</dd></div>
          </dl>
          {completeness.issues.length === 0 ? (
            <p className="completeness-note">{completeness.total_sources === 0 ? '尚未上传资料，上传后可在这里核对解析结果。' : '所有资料均已提取文本，未发现空白章节或页面。'}</p>
          ) : (
            <ul className="completeness-issues">
              {completeness.issues.map((issue) => (
                <li key={`${issue.source_id}-${issue.code}-${issue.node_id ?? 'source'}`}>
                  <strong title={issue.source_name}>{issue.source_name}</strong>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="upload-composer">
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg"
          onChange={(event) => { setFile(event.target.files?.[0] ?? null); setMessage(''); setError('') }}
        />
        <button className="file-picker" type="button" onClick={() => inputRef.current?.click()}>
          <Plus size={18} />
          <span>{file ? file.name : '选择本地资料'}</span>
          <small>{file ? formatFileSize(file.size) : 'PDF / Office / 文本 / 图片，最大 50 MB'}</small>
        </button>
        <label className="rights-check">
          <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />
          <span>我确认有权提供并将此资料用于个人学习；默认仅用于当前课程。</span>
        </label>
        <button className="upload-button" type="button" disabled={!file || !rights || working} onClick={submitUpload}>
          {working ? <LoaderCircle className="spinning" size={16} /> : <Upload size={16} />}
          {working ? '正在保存原件' : '上传并保存原件'}
        </button>
      </div>

      {message && <p className="source-message" role="status">{message}</p>}
      {error && <p className="source-error" role="alert">{error}</p>}

      <div className="source-list">
        {loading && <p className="source-empty">正在读取资料清单…</p>}
        {!loading && sources.length === 0 && (
          <div className="source-empty"><FileText size={22} /><p>还没有资料。先上传一份课件、真题或笔记。</p></div>
        )}
        {sources.map((source) => (
          <article className="source-record" key={source.id}>
            <div className="source-file-icon"><FileText size={19} /></div>
            <div className="source-record-copy">
              <strong title={source.original_name}>{source.original_name}</strong>
              <small>{source.extension.slice(1).toUpperCase()} · {formatFileSize(source.size_bytes)} · SHA {source.sha256.slice(0, 8)}</small>
              {source.origins.map((origin) => (
                <small className="source-origin" key={origin.id} title={`${origin.repository} · ${origin.ref} · ${origin.commit_sha} · ${origin.path}`}>
                  GitHub {origin.repository} @ {origin.commit_sha.slice(0, 8)} · {origin.path}
                </small>
              ))}
            </div>
            <span className={`source-state state-${source.status}`}>{sourceStatusLabel(source.status)}</span>
            <div className="source-actions">
              <a href={`/api/sources/${source.id}/file`} title="下载原件" aria-label={`下载 ${source.original_name}`}><Download size={15} /></a>
              {['ready', 'needs_review'].includes(source.status) && (
                <button type="button" onClick={() => showEvidence(source)}><Layers size={14} /> 证据</button>
              )}
              {['uploaded', 'failed', 'needs_review'].includes(source.status) && (
                <button type="button" onClick={() => startParse(source)} title="加入解析队列">
                  <Play size={14} /> {source.status === 'uploaded' ? '解析' : '重试'}
                </button>
              )}
              {['queued', 'running'].includes(source.status) && <span className="queued-mark"><Check size={14} /> 处理中</span>}
            </div>
          </article>
        ))}
      </div>

      {evidenceSourceId && (
        <section className="evidence-viewer" aria-label="原文证据">
          <div className="evidence-heading">
            <div><span className="eyebrow">SOURCE EVIDENCE</span><strong>{evidenceSource?.original_name ?? '资料证据'}</strong></div>
            <button type="button" onClick={() => setEvidenceSourceId(null)} aria-label="关闭证据"><X size={16} /></button>
          </div>
          {evidenceLoading && <p className="source-empty">正在读取证据…</p>}
          {!evidenceLoading && evidence.length === 0 && <p className="source-empty">暂无文本证据，请检查原件或重新解析。</p>}
          {evidence.map((block) => (
            <article className="evidence-block" key={block.id}>
              <div><strong>{block.node_title}</strong><span>{block.page_number ? `第 ${block.page_number} 页` : '文本段落'} · #{block.id.slice(0, 8)}</span></div>
              <p>{block.text}</p>
              <button className="agent-explain-button" type="button" disabled={explainingId !== null} onClick={() => explain(block)}>
                {explainingId === block.id ? <LoaderCircle className="spinning" size={14} /> : <Sparkles size={14} />}
                {explainingId === block.id ? '正在生成讲解' : explanations[block.id] ? '重新生成证据讲解' : '生成证据讲解'}
              </button>
              {explanations[block.id] && (
                <section className="agent-explanation" aria-label="Agent 证据讲解">
                  <span className="agent-provider">{explanations[block.id].mocked ? 'MOCK / 非真实模型' : 'MODEL / 真实模型'} · {explanations[block.id].model}</span>
                  <p>{explanations[block.id].summary}</p>
                  <ul>{explanations[block.id].key_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
                  <small>证据 #{block.id.slice(0, 8)} · 用量记录 #{explanations[block.id].usage_id.slice(0, 8)}</small>
                </section>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
