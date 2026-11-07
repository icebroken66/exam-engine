import { useEffect, useState } from 'react'
import { ExternalLink, Globe2, LoaderCircle, Search, Sparkles } from 'lucide-react'
import { importWebSource, researchWebSources, searchWebSources } from '../lib/api'
import type { WebResearchResult, WebResult } from '../lib/api'

interface WebSourcePanelProps {
  courseId: string
  hasAnchor: boolean
  onImported: () => void
}

const recommendationLabels = {
  recommended: 'Agent 推荐',
  optional: '可作参考',
  reject: '不建议使用',
}

export function WebSourcePanel({ courseId, hasAnchor, onImported }: WebSourcePanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WebResult[]>([])
  const [research, setResearch] = useState<WebResearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [researching, setResearching] = useState(false)
  const [importingUrl, setImportingUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setQuery('')
    setResults([])
    setResearch(null)
    setError('')
    setMessage('')
  }, [courseId])

  async function researchGap(focus?: string) {
    if (!hasAnchor || searching) return
    setSearching(true)
    setResearching(true)
    setError('')
    setMessage('')
    try {
      const response = await researchWebSources(courseId, focus)
      setQuery(response.query)
      setResults(response.results)
      setResearch(response)
      setMessage('Agent 已分析缺口、读取候选正文并评估相关性；请核对原文后确认是否导入。')
    } catch (reason) {
      setResults([])
      setResearch(null)
      setError(reason instanceof Error ? reason.message : 'Agent 资料补全失败，请补充本地资料')
    } finally {
      setSearching(false)
      setResearching(false)
    }
  }

  useEffect(() => {
    function handleResearchGap(event: Event) {
      const detail = (event as CustomEvent<{ courseId: string; focus: string }>).detail
      if (detail.courseId === courseId) void researchGap(detail.focus)
    }
    window.addEventListener('exam-engine:research-gap', handleResearchGap)
    return () => window.removeEventListener('exam-engine:research-gap', handleResearchGap)
  }, [courseId, hasAnchor])

  async function search() {
    if (query.trim().length < 2 || !hasAnchor || searching) return
    setSearching(true)
    setResearching(false)
    setResearch(null)
    setError('')
    setMessage('')
    try {
      const response = await searchWebSources(courseId, query.trim())
      setResults(response.results)
    } catch (reason) {
      setResults([])
      setError(reason instanceof Error ? reason.message : '公开检索失败，请补充本地资料')
    } finally {
      setSearching(false)
    }
  }

  async function importResult(result: WebResult) {
    if (importingUrl) return
    setImportingUrl(result.url)
    setError('')
    setMessage('')
    try {
      const imported = await importWebSource(courseId, result.url, result.title)
      setMessage(imported.deduplicated
        ? `《${imported.source.original_name}》的相同内容已在课程中，已保留本次公开来源。`
        : `《${imported.source.original_name}》已加入课程并自动解析，将参与后续学习判断。`)
      onImported()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '公开资料导入失败')
    } finally {
      setImportingUrl(null)
    }
  }

  return (
    <section className="web-source-panel" aria-label="公开网络资料补全">
      <div className="web-source-heading">
        <Globe2 size={17} />
        <div><strong>资料有缺口时，检索公开网络</strong><small>结果由你确认后入库，不代表本校本专业考试要求</small></div>
      </div>
      <div className="web-search-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') search() }}
          placeholder="输入具体缺口，如：数据模型 约束条件 定义"
          aria-label="检索公开课程资料"
          disabled={!hasAnchor || searching || importingUrl !== null}
        />
        <button type="button" onClick={search} disabled={!hasAnchor || query.trim().length < 2 || searching || importingUrl !== null}>
          {searching ? <LoaderCircle className="spinning" size={14} /> : <Search size={14} />}
          {searching ? '正在检索' : '检索'}
        </button>
      </div>
      <button className="web-research-action" type="button" onClick={() => researchGap(query.trim() || undefined)} disabled={!hasAnchor || searching || importingUrl !== null}>
        <Sparkles size={14} /> {researching ? 'Agent 正在分析证据缺口并检索…' : '让 Agent 分析缺口并检索'}
      </button>
      {research && (
        <div className="web-research-rationale" role="status">
          <strong>需要补充：{research.evidence_needed}</strong>
          <p>{research.rationale}</p>
          <small>Agent 检索词：{research.query}</small>
        </div>
      )}
      {!hasAnchor && <p className="web-source-note">先上传并解析至少一份有效课程资料，再使用网络补充。</p>}
      {error && <p className="web-source-error" role="alert">{error}</p>}
      {message && <p className="web-source-message" role="status">{message}</p>}
      {results.length > 0 && (
        <ul className="web-result-list" aria-label="公开网络检索结果">
          {results.map((result) => (
            <li key={result.url}>
              <div className="web-result-copy">
                <strong>{result.title}</strong>
                <a href={result.url} target="_blank" rel="noreferrer"><span>{result.url}</span><ExternalLink size={12} /></a>
                <p>{result.snippet}</p>
                {result.assessment && (
                  <div className={`web-source-assessment ${result.assessment.recommendation}`}>
                    <strong>{recommendationLabels[result.assessment.recommendation]} · 置信度 {Math.round(result.assessment.confidence * 100)}%</strong>
                    <p>{result.assessment.reason}</p>
                    <blockquote>{result.assessment.evidence_excerpt}</blockquote>
                  </div>
                )}
                {result.read_error && <p className="web-source-error">正文评估不可用：{result.read_error}</p>}
              </div>
              <button type="button" onClick={() => importResult(result)} disabled={importingUrl !== null}>
                {importingUrl === result.url ? <LoaderCircle className="spinning" size={13} /> : null}
                {importingUrl === result.url ? '正在导入' : '确认导入'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
