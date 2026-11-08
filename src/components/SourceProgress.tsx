import { useEffect, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import type { CourseSourcesState } from '../lib/useCourseSources'
import { formatProcessingDuration, sourceElapsedSeconds, sourceProcessingLabel } from '../lib/source'

export function SourceProgress({ state, onOpenSources }: { state: CourseSourcesState; onOpenSources?: () => void }) {
  const { sources, error, refreshing, refresh, lastUpdated } = state
  const active = sources.filter(source => ['queued', 'running'].includes(source.status))
  const attention = sources.filter(source => ['failed', 'needs_review', 'needs_transcription_review', 'uploaded'].includes(source.status))
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active.length) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active.length])
  if (!active.length && !attention.length && !error) return null
  return <section className="source-progress" aria-label="资料处理状态">
    <div className="source-progress-heading"><strong>{active.length ? `${active.length} 份资料正在处理` : attention.length ? `${attention.length} 份资料需要处理` : '资料状态暂时无法更新'}</strong>
      <button className="text-action" type="button" onClick={() => void refresh()} disabled={refreshing}><RotateCcw size={14} />{refreshing ? '正在刷新' : '刷新状态'}</button></div>
    {active.length > 0 && <p>可以离开此页或刷新，处理会在后台继续。试卷会逐题求解并验收，可能需要几分钟。</p>}
    <ul>{active.map(source => <li key={source.id}>
      <div><strong>{source.original_name}</strong><span><LoaderCircle className="spin" size={14} />{sourceProcessingLabel(source)}{source.status === 'running' && source.processing_started_at ? ` · 已用 ${formatProcessingDuration(sourceElapsedSeconds(source, now))}` : ''}</span></div>
      {source.processing_total > 0 && <progress value={source.processing_completed} max={source.processing_total} aria-label={`${source.original_name} 当前阶段进度`} />}
    </li>)}</ul>
    {!active.length && attention.length > 0 && <p>失败资料可重试；扫描转录需对照原件确认。已有可用资料会保留。</p>}
    {error && <p className="status-reconnect" role="status">{error}。正在自动重连，也可点击刷新。{lastUpdated ? `上次成功更新：${new Date(lastUpdated).toLocaleTimeString('zh-CN')}` : ''}</p>}
    {onOpenSources && <button type="button" className="secondary-action" onClick={onOpenSources}>查看资料与处理详情</button>}
  </section>
}
