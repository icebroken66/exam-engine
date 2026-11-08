import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Trash2, X } from 'lucide-react'
import { getSourceRemovalImpact, removeSource } from '../lib/api'
import type { Source, SourceRemovalImpact } from '../lib/api'

export function SourceRemovalDialog({ source, onClose, onRemoved }: {
  source: Source; onClose: () => void; onRemoved: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [impact, setImpact] = useState<SourceRemovalImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setImpact(null)
    getSourceRemovalImpact(source.id).then(result => {
      if (active) setImpact(result)
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '无法读取影响，请重试')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [source.id, version])

  async function confirm() {
    if (!impact || loading || busy || impact.blocked_reason) return
    setBusy(true); setError('')
    try {
      await removeSource(source.id, impact.signature)
      onRemoved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除失败，请重新查看影响后重试')
      // Require a fresh preview after a conflict or an ambiguous network result.
      setImpact(null)
    } finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="course-dialog source-removal-dialog" aria-labelledby="remove-source-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="dialog-heading">
      <h2 id="remove-source-title">从课程移除资料</h2>
      <button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭移除确认"><X size={20} /></button>
    </div>
    <p className="removal-source-name">{source.original_name}</p>
    <p>移除后，这份资料及关联题目不再用于范围分析、校题清单和后续出题。人工校订过的关联题目也会一起停用。</p>
    <p>原件、题目版本和已有作答记录会保留，供历史追溯；这不会彻底销毁文件。重新上传相同文件可恢复资料，已解析结果会复用。</p>
    {loading && <p role="status"><LoaderCircle className="spinning" size={16} /> 正在核对影响…</p>}
    {impact && <>
      <dl className="removal-impact">
        <div><dt>停用的原文证据</dt><dd>{impact.evidence_count} 条</dd></div>
        <div><dt>停用的关联题目</dt><dd>{impact.question_count} 道</dd></div>
        <div><dt>保留的历史任务</dt><dd>{impact.history_task_count} 道</dd></div>
        <div><dt>需重新安排的未答题</dt><dd>{impact.pending_task_count} 道</dd></div>
      </dl>
      {impact.pending_task_count > 0 && <p className="notice">引用该资料的未答题将停止，作答草稿留在当前浏览器。回到学习页可依据剩余有效资料重新安排；若没有其他资料，需要先补传。</p>}
      {impact.blocked_reason && <p className="form-error" role="alert">{impact.blocked_reason}</p>}
      {impact.removed && <p className="notice">这份资料已经移除。关闭后刷新清单即可。</p>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="delete-dialog-actions">
      <button className="secondary-action" onClick={onClose} disabled={busy}>取消</button>
      {!loading && (!impact || impact.blocked_reason) && <button className="secondary-action" onClick={() => setVersion(value => value + 1)} disabled={busy}>重新查看影响</button>}
      <button className="danger-action" onClick={confirm} disabled={loading || busy || !impact || Boolean(impact.blocked_reason) || impact.removed}>
        {busy ? <LoaderCircle className="spinning" size={16} /> : <Trash2 size={16} />}{busy ? '正在移除…' : '确认从课程移除'}
      </button>
    </div>
  </dialog>
}
