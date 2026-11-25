import { useEffect, useState } from 'react'
import type { Source } from '../lib/api'
import { isPdf, readerHref, type ReadingSummary } from '../lib/materials'
import { Button, ButtonLink } from '../reader/boardui/button'
import { PREVIEW_VERSION } from '../reader/types'

export function ReadingResume({courseId, sources, updated}: {courseId: string; sources: Source[]; updated: number | null}) {
  const [items, setItems] = useState<ReadingSummary[]>([]), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setItems([]); setError('')
    void fetch('/api/courses/' + encodeURIComponent(courseId) + '/reading-summaries', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])})
      .then(async response => { if (!response.ok) throw new Error(); return response.json() })
      .then(data => { if (!controller.signal.aborted) { if (data.courseId !== courseId || !Array.isArray(data.items)) throw new Error(); setItems(data.items) } })
      .catch(() => {if (!controller.signal.aborted) setError('继续阅读暂时无法读取，可从资料列表手动打开。')})
    return () => controller.abort()
  }, [courseId, updated, retry])
  const recent = items.find(item => item.previewVersion === PREVIEW_VERSION && Number.isInteger(item.page) && item.page > 0 && sources.some(source => source.id === item.sourceId && source.sha256 === item.sha256 && isPdf(source)))
  if (error) return <p className="resume-error" role="status">{error} <Button size="small" variant="ghost" onClick={() => setRetry(n => n + 1)}>重试继续阅读</Button></p>
  if (!recent) return null
  return <section className="reading-resume" aria-label="继续阅读"><div><span>最近保存的阅读</span><strong>{recent.name}</strong><small>已保存到第 {recent.page} 页 · {new Date(recent.updatedAt).toLocaleString('zh-CN')} · 打开时重新校验原件</small></div><ButtonLink href={readerHref(courseId, recent.sourceId)}>继续阅读</ButtonLink></section>
}
