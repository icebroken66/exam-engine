import { useCallback, useEffect, useRef, useState } from 'react'
import { getCourseCompleteness, listSources } from './api'
import type { CourseCompleteness, Source } from './api'

export interface CourseSourcesState {
  sources: Source[]
  completeness: CourseCompleteness | null
  loading: boolean
  error: string
  refreshing: boolean
  lastUpdated: number | null
  refresh: () => Promise<void>
}

// Progress updates are cheap reads. Only changes to usable inputs refresh the
// learning context, which may require a model call.
function inputSignature(sources: Source[]) {
  return JSON.stringify(sources.map(source => [source.id, source.status, source.material_type, source.processing_finished_at]).sort())
}

export function useCourseSources(courseId: string, onChanged: () => void): CourseSourcesState {
  const [sources, setSources] = useState<Source[]>([])
  const [completeness, setCompleteness] = useState<CourseCompleteness | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  const changedRef = useRef(onChanged)
  useEffect(() => { changedRef.current = onChanged }, [onChanged])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    let pending: Promise<void> | null = null
    let signature: string | null = null
    let currentSources: Source[] = []
    let retryDelay = 1500
    const controller = new AbortController()
    setLoading(true); setSources([]); setCompleteness(null); setError(''); setLastUpdated(null)
    const refresh = (): Promise<void> => {
      if (!active) return Promise.resolve()
      if (pending) return pending
      window.clearTimeout(timer)
      setRefreshing(true)
      pending = (async () => {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        const [items, report] = await Promise.allSettled([listSources(courseId, signal), getCourseCompleteness(courseId, signal)])
        if (!active) return
        const errors: string[] = []
        if (items.status === 'fulfilled') {
          currentSources = items.value
          setSources(currentSources); setLastUpdated(Date.now())
          const next = inputSignature(currentSources)
          if (signature !== null && next !== signature) changedRef.current()
          signature = next
        } else errors.push('资料状态连接中断，已保留上次结果')
        if (report.status === 'fulfilled') setCompleteness(report.value)
        else errors.push('完整性报告暂时无法刷新')
        setError(errors.join('；'))
        setLoading(false); setRefreshing(false)
        // Continue after failures even if no initial source list was received.
        // The delay grows to avoid hammering a disconnected service.
        if (errors.length || currentSources.some(source => ['queued', 'running'].includes(source.status))) {
          timer = window.setTimeout(() => { void refresh() }, retryDelay)
        }
        retryDelay = errors.length ? Math.min(10000, retryDelay * 2) : 1500
      })().finally(() => { pending = null })
      return pending
    }
    refreshRef.current = async () => {
      if (pending) await pending
      await refresh()
    }
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    void refresh()
    return () => {
      active = false; controller.abort(); window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus)
    }
  }, [courseId])
  const refresh = useCallback(() => refreshRef.current(), [])
  return { sources, completeness, loading, error, refreshing, lastUpdated, refresh }
}
