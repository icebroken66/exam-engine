import { useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
export function PdfPage({ pdf, page, scale, thumbnail = false, onReady }: { pdf: PDFDocumentProxy; page: number; scale: number; thumbnail?: boolean; onReady?: (text: boolean, error?: string, extractedText?: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!thumbnail)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!thumbnail || !canvas.current) return
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '200px' })
    observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [thumbnail])
  useEffect(() => {
    if (!visible) return
    let stopped = false
    let task: RenderTask | undefined
    let layer: TextLayer | undefined
    setError('')
    void (async () => {
      const p = await pdf.getPage(page)
      if (stopped || !canvas.current || !text.current) return
      const viewport = p.getViewport({ scale })
      const c = canvas.current
      const ratio = window.devicePixelRatio || 1
      // Bound raster memory for large lecture pages; CSS geometry remains exact.
      const outputRatio = Math.min(ratio, Math.sqrt(16_000_000 / (viewport.width * viewport.height)))
      c.width = Math.ceil(viewport.width * outputRatio); c.height = Math.ceil(viewport.height * outputRatio)
      c.style.width = `${viewport.width}px`; c.style.height = `${viewport.height}px`
      text.current.replaceChildren()
      text.current.style.setProperty('--scale-factor', String(scale))
      text.current.style.setProperty('--total-scale-factor', String(scale))
      task = p.render({ canvas: c, viewport, transform: outputRatio === 1 ? undefined : [outputRatio, 0, 0, outputRatio, 0, 0] })
      await task.promise
      if (stopped || thumbnail) return
      const content = await p.getTextContent()
      if (stopped) return
      try { layer = new TextLayer({ textContentSource: content, container: text.current!, viewport }); await layer.render(); if (!stopped) { const extractedText = content.items.map(i => 'str' in i ? i.str : '').join(' ').trim(); onReady?.(extractedText.length > 0, undefined, extractedText) } }
      catch { if (!stopped) { text.current?.replaceChildren(); onReady?.(false) } }
    })().catch(e => { if (!stopped) { setError(String(e)); onReady?.(false, String(e)) } })
    return () => { stopped = true; task?.cancel(); layer?.cancel() }
  }, [pdf, page, scale, thumbnail, onReady, visible])
  return <div className="rl-pdf"><canvas ref={canvas} aria-label={thumbnail ? `第 ${page} 页缩略图` : `第 ${page} 页原件只读预览`} /><div ref={text} className="rl-text-layer" />{error && <div role="alert">页面渲染失败：{error}</div>}</div>
}
