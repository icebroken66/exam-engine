import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { FileCheck2, GitBranch, Github, LoaderCircle, Search } from 'lucide-react'
import { importGithub, previewGithub } from '../lib/api'
import type { GitHubImportResult, GitHubPreview } from '../lib/api'
import { formatFileSize } from '../lib/source'

export function GitHubPanel({ courseId, onImported }: { courseId: string; onImported: () => void }) {
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [path, setPath] = useState('')
  const [preview, setPreview] = useState<GitHubPreview | null>(null)
  const [result, setResult] = useState<GitHubImportResult | null>(null)
  const [rights, setRights] = useState(false)
  const [working, setWorking] = useState<'preview' | 'import' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setUrl('')
    setRef('')
    setPath('')
    setPreview(null)
    setResult(null)
    setRights(false)
    setError('')
  }, [courseId])

  function clearConfirmation() {
    setPreview(null)
    setResult(null)
    setRights(false)
    setError('')
  }

  async function inspect(event: FormEvent) {
    event.preventDefault()
    setWorking('preview')
    setError('')
    setResult(null)
    try {
      const next = await previewGithub(courseId, { url, ref: ref || null, path })
      setPreview(next)
      setRights(false)
    } catch (reason) {
      setPreview(null)
      setError(reason instanceof Error ? reason.message : 'GitHub 目录读取失败')
    } finally {
      setWorking(null)
    }
  }

  async function confirmImport() {
    if (!preview || !rights) return
    setWorking('import')
    setError('')
    try {
      const imported = await importGithub(courseId, {
        url,
        ref: ref || null,
        path,
        expected_commit_sha: preview.commit_sha,
        rights_confirmed: true,
      })
      setResult(imported)
      onImported()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub 导入失败，请重试')
    } finally {
      setWorking(null)
    }
  }

  return (
    <section className="github-import" aria-labelledby="github-import-title">
      <span className="eyebrow">GITHUB / 公开仓库</span>
      <Github size={27} strokeWidth={1.5} />
      <h2 id="github-import-title">先确认目录，<br />再按版本导入。</h2>
      <p>支持仓库首页或 /tree/ 地址。单次最多 20 个文件、共 100 MB；不会获取私有仓库。</p>
      <form onSubmit={inspect}>
        <label>仓库或目录地址
          <input
            value={url}
            onChange={(event) => { setUrl(event.target.value); clearConfirmation() }}
            placeholder="https://github.com/owner/repo"
            required
            type="url"
          />
        </label>
        <div className="github-location-row">
          <label>分支 / 提交
            <input value={ref} onChange={(event) => { setRef(event.target.value); clearConfirmation() }} placeholder="默认分支" />
          </label>
          <label>仓库内路径
            <input value={path} onChange={(event) => { setPath(event.target.value); clearConfirmation() }} placeholder="可选" />
          </label>
        </div>
        <button className="github-preview-button" type="submit" disabled={working !== null}>
          {working === 'preview' ? <LoaderCircle className="spinning" size={15} /> : <Search size={15} />}
          {working === 'preview' ? '正在读取目录' : '预览可导入文件'}
        </button>
      </form>

      {error && <p className="github-error" role="alert">{error}</p>}
      {preview && (
        <div className="github-preview">
          <div className="github-version">
            <GitBranch size={14} />
            <strong>{preview.repository}</strong>
            <span>{preview.ref} · {preview.commit_sha.slice(0, 10)}</span>
            <small>{preview.path || '仓库根目录'} · {preview.files.length} 个文件 · {formatFileSize(preview.total_bytes)}</small>
          </div>
          <ul>
            {preview.files.map((file) => <li key={file.path} title={file.path}><span>{file.path}</span><small>{formatFileSize(file.size)}</small></li>)}
          </ul>
          {(preview.skipped_unsupported > 0 || preview.skipped_oversize > 0) && (
            <p className="github-skipped">已排除 {preview.skipped_unsupported} 个不支持文件、{preview.skipped_oversize} 个空文件或超大文件。</p>
          )}
          <label className="rights-check">
            <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />
            <span>我确认有权导入并使用这些资料，并已核对目录、文件和提交版本。</span>
          </label>
          <button className="github-confirm-button" type="button" disabled={!rights || working !== null || preview.files.length === 0} onClick={confirmImport}>
            {working === 'import' ? <LoaderCircle className="spinning" size={15} /> : <FileCheck2 size={15} />}
            {working === 'import' ? '正在导入原件' : '确认版本并导入'}
          </button>
        </div>
      )}
      {result && (
        <div className="github-result" role="status">
          新增 {result.imported_count} 份，复用 {result.deduplicated_count} 份。可在左侧继续解析。
          {result.failures.map((failure) => <p key={failure.path}>{failure.path}：{failure.message}</p>)}
        </div>
      )}
    </section>
  )
}
