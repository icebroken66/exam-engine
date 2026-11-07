import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Check, Download, FileText, FolderOpen, Layers, LoaderCircle, Play, Plus, Sparkles, Upload, X } from 'lucide-react'
import { confirmSourceTranscription, explainEvidence, getCourseCompleteness, listEvidence, listSources, queueParse, updateSourceMaterial, uploadSources } from '../lib/api'
import type { AgentExplanation, CourseCompleteness, EvidenceBlock, MaterialType, Source, SourceBatchFailure } from '../lib/api'
import { formatFileSize, sourceStatusLabel } from '../lib/source'
import { WebSourcePanel } from './WebSourcePanel'

interface SourcePanelProps {
  courseId: string
  reloadToken?: number
  onChanged?: () => void
}

const materialLabels: Record<MaterialType, string> = {
  courseware: '课件 / 讲义',
  past_exam: '往年题 / 试卷',
  assignment: '作业 / 练习题',
  teacher_guidance: '教师题型 / 考核说明',
  notes: '笔记',
  other: '其他课程资料',
}

export function SourcePanel({ courseId, reloadToken = 0, onChanged }: SourcePanelProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [completeness, setCompleteness] = useState<CourseCompleteness | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploadFailures, setUploadFailures] = useState<SourceBatchFailure[]>([])
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
  const folderInputRef = useRef<HTMLInputElement>(null)
  const totalBytes = files.reduce((total, item) => total + item.size, 0)

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  function selectFiles(selected: FileList | File[]) {
    setFiles(Array.from(selected))
    setUploadFailures([])
    setMessage('')
    setError('')
  }

  function clearFiles() {
    setFiles([])
    if (inputRef.current) inputRef.current.value = ''
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!working) selectFiles(event.dataTransfer.files)
  }

  async function changeMaterial(source: Source, materialType: MaterialType) {
    setError('')
    try {
      const updated = await updateSourceMaterial(source.id, materialType)
      setSources((current) => current.map((item) => item.id === updated.id ? updated : item))
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料类型更新失败')
    }
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    clearFiles()
    setUploadFailures([])
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
        if (items.every((source) => !['queued', 'running'].includes(source.status))) onChanged?.()
      }).catch(() => undefined)
    }, 700)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [courseId, hasActiveTask, sources, onChanged])

  async function refreshCompleteness() {
    try {
      setCompleteness(await getCourseCompleteness(courseId))
    } catch {
      setError('资料已更新，但课程完整性报告暂时无法刷新')
    }
  }

  async function submitUpload() {
    if (files.length === 0 || files.length > 100 || !rights) return
    setWorking(true)
    setError('')
    setMessage('')
    setUploadFailures([])
    try {
      const result = await uploadSources(courseId, files)
      setSources(await listSources(courseId))
      const details = [
        `本批接收 ${result.imported_count} 份新资料`,
        result.deduplicated_count ? `复用 ${result.deduplicated_count} 份相同内容` : '',
        result.failures.length ? `${result.failures.length} 份未导入，不影响其他文件` : '',
      ].filter(Boolean).join('；')
      setMessage(`${details}。可用文件将自动解析并进入后续学习判断。`)
      setUploadFailures(result.failures)
      clearFiles()
      setRights(false)
      await refreshCompleteness()
      onChanged?.()
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
      setMessage(`《${source.original_name}》已重新加入自动解析队列。`)
      await refreshCompleteness()
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新解析失败')
    }
  }

  async function confirmTranscription(source: Source) {
    setWorking(true)
    setError('')
    try {
      const updated = await confirmSourceTranscription(source.id)
      setSources((current) => current.map((item) => item.id === source.id ? updated : item))
      setMessage(`《${source.original_name}》的转录已确认并进入课程证据。`)
      await refreshCompleteness()
      onChanged?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '转录确认失败')
    } finally {
      setWorking(false)
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

      <div className="upload-composer" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg"
          onChange={(event) => event.target.files && selectFiles(event.target.files)}
        />
        <input
          ref={folderInputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg"
          onChange={(event) => event.target.files && selectFiles(event.target.files)}
        />
        <div className="file-picker-actions">
          <button className="file-picker" type="button" onClick={() => inputRef.current?.click()} disabled={working}>
            <Plus size={18} />
            <span>选择多份资料</span>
            <small>可一次多选，不必逐份等待</small>
          </button>
          <button className="file-picker" type="button" onClick={() => folderInputRef.current?.click()} disabled={working}>
            <FolderOpen size={18} />
            <span>选择整个文件夹</span>
            <small>保留资料相对目录</small>
          </button>
        </div>
        <p className="file-picker-hint">也可把多份文件拖到这里。支持 PDF / Office / 文本 / 图片；每份最大 50 MB，每批最多 100 份。</p>
        {files.length > 0 && (
          <>
            <div className="selected-file-summary">
              <span>待导入 {files.length} 份 · {formatFileSize(totalBytes)}</span>
              <button type="button" onClick={clearFiles} disabled={working}>清空选择</button>
            </div>
            <ul className="selected-file-list" aria-label="本批待导入资料">
              {files.slice(0, 12).map((item) => (
                <li key={`${item.webkitRelativePath || item.name}-${item.size}-${item.lastModified}`}>
                  <span title={item.webkitRelativePath || item.name}>{item.webkitRelativePath || item.name}</span>
                  <small>{formatFileSize(item.size)}</small>
                </li>
              ))}
              {files.length > 12 && <li><span>其余 {files.length - 12} 份资料将在同一批导入</span></li>}
            </ul>
          </>
        )}
        <label className="rights-check">
          <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />
          <span>我确认有权提供并将这些资料用于个人学习；本批资料默认仅归属当前课程。</span>
        </label>
        <button className="upload-button" type="button" disabled={files.length === 0 || files.length > 100 || !rights || working} onClick={submitUpload}>
          {working ? <LoaderCircle className="spinning" size={16} /> : <Upload size={16} />}
          {working ? '正在上传并安排整批解析' : files.length > 100 ? '请分批导入，每批最多 100 份' : `批量导入 ${files.length || ''} 份并自动解析`}
        </button>
      </div>

      {message && <p className="source-message" role="status">{message}</p>}
      {uploadFailures.length > 0 && (
        <ul className="upload-failures" aria-label="未导入文件">
          {uploadFailures.map((failure) => <li key={failure.filename}><strong>{failure.filename}</strong>：{failure.message}</li>)}
        </ul>
      )}
      {error && <p className="source-error" role="alert">{error}</p>}

      <WebSourcePanel
        courseId={courseId}
        hasAnchor={sources.some((source) => ['ready', 'needs_review'].includes(source.status))}
        onImported={async () => {
          setSources(await listSources(courseId))
          await refreshCompleteness()
          onChanged?.()
        }}
      />

      <div className="source-list">
        {loading && <p className="source-empty">正在读取资料清单…</p>}
        {!loading && sources.length === 0 && (
          <div className="source-empty"><FileText size={22} /><p>还没有资料。可直接上传课件、真题或笔记，无需先整理或录入题目。</p></div>
        )}
        {sources.map((source) => (
          <article className="source-record" key={source.id}>
            <div className="source-file-icon"><FileText size={19} /></div>
            <div className="source-record-copy">
              <strong title={source.original_name}>{source.original_name}</strong>
              <small>{source.extension.slice(1).toUpperCase()} · {formatFileSize(source.size_bytes)} · SHA {source.sha256.slice(0, 8)}</small>
              <label className="source-material-type" title={source.material_rationale}>
                <span>资料类型{source.material_confidence < 0.8 ? '（请核对）' : ''}</span>
                <select value={source.material_type} onChange={(event) => changeMaterial(source, event.target.value as MaterialType)} aria-label={`${source.original_name} 的资料类型`}>
                  {Object.entries(materialLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              {source.origins.map((origin) => origin.kind === 'web' ? (
                <small className="source-origin" key={origin.id} title={origin.path}>
                  公开网络 · <a href={origin.path} target="_blank" rel="noreferrer">{origin.path}</a>
                </small>
              ) : (
                <small className="source-origin" key={origin.id} title={`${origin.repository} · ${origin.ref} · ${origin.commit_sha} · ${origin.path}`}>
                  GitHub {origin.repository} @ {origin.commit_sha.slice(0, 8)} · {origin.path}
                </small>
              ))}
              {source.status === 'needs_transcription_review' && source.processing_note && (
                <small className="source-processing-note">{source.processing_note}</small>
              )}
            </div>
            <span className={`source-state state-${source.status}`}>{sourceStatusLabel(source.status)}</span>
            <div className="source-actions">
              <a href={`/api/sources/${source.id}/file`} title="下载原件" aria-label={`下载 ${source.original_name}`}><Download size={15} /></a>
              {['ready', 'needs_review', 'needs_transcription_review'].includes(source.status) && (
                <button type="button" onClick={() => showEvidence(source)}><Layers size={14} /> 证据</button>
              )}
              {['failed', 'needs_review', 'needs_transcription_review'].includes(source.status) && (
                <button type="button" onClick={() => startParse(source)} title="重新自动解析">
                  <Play size={14} /> 重试
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
          <a className="source-original-link" href={`/api/sources/${evidenceSourceId}/file?inline=true`} target="_blank" rel="noreferrer">打开原件对照</a>
          {evidenceSource?.status === 'needs_transcription_review' && (
            <>
              <p className="source-error" role="alert">以下是视觉模型转录候选，可能遗漏公式、表格或遮挡文字。确认前不会参与范围分析或出题。</p>
              <button className="agent-explain-button" type="button" disabled={working || evidenceLoading || evidence.length === 0} onClick={() => confirmTranscription(evidenceSource)}>
                {working ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}
                {working ? '正在确认并启用' : '已对照原件，确认转录并启用'}
              </button>
            </>
          )}
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
