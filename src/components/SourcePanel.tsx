import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Check, Download, FileText, FolderOpen, Layers, LoaderCircle, Play, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { confirmSourceTranscription, explainEvidence, listEvidence, queueParse, updateSourceMaterial, uploadSources } from '../lib/api'
import type { AgentExplanation, EvidenceBlock, MaterialType, Source, SourceBatchFailure } from '../lib/api'
import { formatFileSize, formatProcessingDuration, sourceProcessingLabel, sourceStatusLabel } from '../lib/source'
import { WebSourcePanel } from './WebSourcePanel'
import { SourceRemovalDialog } from './SourceRemovalDialog'
import { SourceProgress } from './SourceProgress'
import { ReadingResume } from './ReadingResume'
import { filterMaterials, isPdf, materialsPreference, readerHref } from '../lib/materials'
import { Button, ButtonLink } from '../reader/boardui/button'
import { Input } from '../reader/boardui/input'
import { cx } from '../reader/boardui/cx'
import type { CourseSourcesState } from '../lib/useCourseSources'

interface SourcePanelProps {
  courseId: string
  state: CourseSourcesState
}

const materialLabels: Record<MaterialType, string> = {
  courseware: '课件 / 讲义',
  past_exam: '往年题 / 试卷',
  assignment: '作业 / 练习题',
  teacher_guidance: '教师题型 / 考核说明',
  notes: '笔记',
  other: '其他课程资料',
}

export function SourcePanel({ courseId, state }: SourcePanelProps) {
  const { sources, completeness, loading, refresh } = state
  const [preference, setPreference] = useState(() => materialsPreference(courseId))
  useEffect(() => { try { sessionStorage.setItem('materials-view:' + courseId, JSON.stringify(preference)) } catch { /* Optional UI preference. */ } }, [courseId, preference])
  const filtered = filterMaterials(sources, preference.query, preference.filter)
  const [files, setFiles] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<Source[]>([])
  const [uploadFailures, setUploadFailures] = useState<SourceBatchFailure[]>([])
  const [rights, setRights] = useState(false)
  const [working, setWorking] = useState(false)
  const [actionId, setActionId] = useState('')
  const [removing, setRemoving] = useState<Source | null>(null)
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
  })

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
      await updateSourceMaterial(source.id, materialType)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料类型更新失败')
    }
  }

  async function submitUpload() {
    if (working || files.length === 0 || files.length > 100 || !rights) return
    setWorking(true)
    setError('')
    setMessage('')
    setUploadFailures([])
    try {
      const result = await uploadSources(courseId, files)
      const details = [
        `本批接收 ${result.imported_count} 份新资料`,
        result.deduplicated_count ? `复用 ${result.deduplicated_count} 份相同内容` : '',
        result.failures.length ? `${result.failures.length} 份未导入，不影响其他文件` : '',
      ].filter(Boolean).join('；')
      setMessage(`${details}。可用文件将自动解析并进入后续学习判断。`)
      setUploadFailures(result.failures)
      setUploaded(result.results.map(item => item.source))
      const failedNames = new Set(result.failures.map(failure => failure.filename))
      const remaining = files.filter(file => failedNames.has(file.webkitRelativePath || file.name) || failedNames.has(file.name))
      if (remaining.length) setFiles(remaining)
      else { clearFiles(); setRights(false) }
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  async function startParse(source: Source) {
    setError('')
    setMessage('')
    setActionId(source.id)
    try {
      await queueParse(source.id)
      setMessage(`《${source.original_name}》已重新加入自动解析队列。`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新解析失败')
    } finally { setActionId('') }
  }

  async function confirmTranscription(source: Source) {
    setWorking(true)
    setError('')
    try {
      await confirmSourceTranscription(source.id)
      setMessage(`《${source.original_name}》的转录已确认并进入课程证据。`)
      await refresh()
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

  const uploadComposer = (
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
        <p className="file-picker-hint">也可把多份文件拖到这里。支持 PDF / Office / 文本 / 图片；每份最大 50 MB，每批最多 100 份。重新上传相同文件可恢复已移除资料与已有记录。</p>
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
          <input type="checkbox" checked={rights} disabled={working} onChange={(event) => setRights(event.target.checked)} />
          <span>我确认有权提供并将这些资料用于个人学习；本批资料默认仅归属当前课程。</span>
        </label>
        <button className="upload-button" type="button" disabled={files.length === 0 || files.length > 100 || !rights || working} onClick={submitUpload}>
          {working ? <LoaderCircle className="spinning" size={16} /> : <Upload size={16} />}
          {working ? '正在上传并安排整批解析' : files.length > 100 ? '请分批导入，每批最多 100 份' : `批量导入 ${files.length || ''} 份并自动解析`}
        </button>
      </div>  )

  return (
    <div className="source-panel">
      <div className="section-heading"><span>课程资料清单</span><span>{sources.length} 份资料</span></div>
      <ReadingResume courseId={courseId} sources={sources} updated={state.lastUpdated} />
      {state.error && <p className="status-reconnect" role="alert">{state.error} <Button size="small" variant="ghost" onClick={() => void refresh()}>刷新资料</Button></p>}



      {message && <p className="source-message" role="status">{message}</p>}
      {uploaded.length > 0 && <div className="upload-received" role="status">本批资料已接收：{uploaded.map(source => isPdf(source) ? <ButtonLink key={source.id} size="small" href={readerHref(courseId,source.id)}>{'阅读 ' + source.original_name}</ButtonLink> : <a key={source.id} href={'/api/sources/' + source.id + '/file'}>{'下载 ' + source.original_name}</a>)}</div>}
      {uploadFailures.length > 0 && (
        <ul className="upload-failures" aria-label="未导入文件">
          {uploadFailures.map((failure) => <li key={failure.filename}><strong>{failure.filename}</strong>：{failure.message}</li>)}
        </ul>
      )}
      {error && <p className="source-error" role="alert">{error}</p>}


      {sources.length === 0 && !loading && <details className="material-secondary" open><summary>添加课程资料</summary><p>支持 PDF、DOCX、PPTX、文本和图片。工作台目前阅读 PDF；其他格式可下载原件，PPTX 可人工导出 PDF 再导入。</p>{uploadComposer}
</details>}
      {sources.length > 0 && <div className="materials-search" aria-label="查找资料">
        <Input label="按文件名搜索" placeholder="搜索文件名（不含正文）" value={preference.query} onChange={query => setPreference(p => ({...p, query}))} />
        <div className="materials-filters" role="group" aria-label="资料筛选">{([['all','全部'],['readable','可阅读'],['processing','需处理']] as const).map(([filter,label]) => <Button key={filter} size="small" variant="ghost" className={cx(preference.filter === filter && 'material-filter-active')} aria-pressed={preference.filter === filter} onClick={() => setPreference(p => ({...p,filter}))}>{label}</Button>)}</div>
        {(preference.query || preference.filter !== 'all') && <Button size="small" variant="ghost" onClick={() => setPreference({query:'',filter:'all'})}>清除筛选</Button>}
      </div>}
      <div className="source-list">
        {loading && <p className="source-empty">正在读取资料清单…</p>}
        {!loading && sources.length === 0 && (
          <div className="source-empty"><FileText size={22} /><p>还没有资料。可直接上传课件、真题或笔记，无需先整理或录入题目。</p></div>
        )}
        {!loading && sources.length > 0 && filtered.length === 0 && <p className="source-empty" role="status">没有匹配文件名和筛选条件的资料。请清除筛选后重试。</p>}
        {filtered.map((source) => (
          <article className="source-record" key={source.id}>
            <div className="source-file-icon"><FileText size={19} /></div>
            <div className="source-record-copy">
              {isPdf(source) ? <a className="material-title" href={readerHref(courseId, source.id)} title={source.original_name}>{source.original_name}</a> : <strong title={source.original_name}>{source.original_name}</strong>}
              <small>{source.extension.replace('.', '').toUpperCase()} · {isPdf(source) ? '可阅读 · 打开时校验' : '当前格式不支持阅读 · 可下载原件'}{source.relative_path ? ' · ' + source.relative_path : ''}</small>
              {source.status === 'failed' && <small className="source-processing-note">AI 解析失败；PDF 原件仍可尝试阅读。{source.processing_note}</small>}
              <details className="material-details"><summary>资料详情与处理</summary>
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
              {source.processing_note && !['queued', 'running'].includes(source.status) && (
                <small className="source-processing-note">{source.processing_note}</small>
              )}
              {!['queued', 'running'].includes(source.status) && source.processing_duration_seconds > 0 && (
                <small className="source-origin">最近处理耗时 {formatProcessingDuration(source.processing_duration_seconds)}</small>
              )}
              </details>
            </div>
            <span className={`source-state state-${source.status}`}>{sourceStatusLabel(source.status)}</span>
            <div className="source-actions">
              {isPdf(source)&&<ButtonLink size="small" href={readerHref(courseId, source.id)} aria-label={'阅读 ' + source.original_name}>阅读</ButtonLink>}
              <button type="button" className="remove-source-action" disabled={working || Boolean(actionId)} onClick={() => setRemoving(source)} aria-label={`移除 ${source.original_name}`}><Trash2 size={14} /> 移除</button>
              <a href={`/api/sources/${source.id}/file`} title="下载原件" aria-label={`下载 ${source.original_name}`}><Download size={15} /></a>
              {['ready', 'needs_review', 'needs_transcription_review'].includes(source.status) && (
                <button type="button" onClick={() => showEvidence(source)}><Layers size={14} /> 证据</button>
              )}
              {['uploaded', 'failed', 'needs_review', 'needs_transcription_review'].includes(source.status) && (
                <button type="button" onClick={() => startParse(source)} disabled={Boolean(actionId) || working} title="重新自动解析">
                  <Play size={14} /> {actionId === source.id ? '正在安排…' : source.status === 'uploaded' ? '开始解析' : '重试'}
                </button>
              )}
              {['queued', 'running'].includes(source.status) && <span className="queued-mark"><LoaderCircle className="spinning" size={14} /> {sourceProcessingLabel(source)}</span>}
            </div>
          </article>
        ))}
      </div>

      {sources.length > 0 && <details className="material-secondary"><summary>添加资料</summary>{uploadComposer}
</details>}
      <details className="material-secondary"><summary>解析状态与完整性</summary><SourceProgress state={state} />      {completeness && (
        <section className="completeness-ledger" aria-label="课程资料完整性">
          <div className="completeness-heading">
            <strong>{completeness.total_sources === 0 ? '等待提供课程资料' : completeness.complete ? '资料解析完整' : `${completeness.attention_sources} 份资料需要关注`}</strong>
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
</details>
      <details className="material-secondary"><summary>网络补全资料</summary>      <WebSourcePanel
        courseId={courseId}
        hasAnchor={sources.some((source) => ['ready', 'needs_review'].includes(source.status))}
        onImported={() => { void refresh() }}
      />
</details>
      {removing && <SourceRemovalDialog source={removing} onClose={() => setRemoving(null)} onRemoved={() => {
        if (evidenceSourceId === removing.id) { setEvidenceSourceId(null); setEvidence([]) }
        setMessage(`《${removing.original_name}》已从课程移除，历史记录与原件保留。`)
        setRemoving(null)
        void refresh()
      }} />}
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
