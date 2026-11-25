import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PREVIEW_VERSION } from './types'
import type { DocumentInfo } from './types'
GlobalWorkerOptions.workerSrc = workerUrl
export async function openPdf(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('本验证入口只打开 PDF。PPTX 请先人工导出 PDF；暂未支持自动转换。')
  const data = new Uint8Array(await file.arrayBuffer())
  return openPdfBytes(data, file.name)
}
export async function openPdfBytes(data: Uint8Array, name = 'fixture.pdf') {
  const digestInput = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput))).map(v => v.toString(16).padStart(2, '0')).join('')
  const loading = getDocument({ data, cMapUrl: '/reader-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/reader-assets/standard_fonts/', wasmUrl: '/reader-assets/wasm/' })
  try {
    const pdf = await loading.promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const v = p.getViewport({ scale: 1 }); pages.push({ width: v.width, height: v.height }) }
    const info: DocumentInfo = { id, name, originalFormat: 'pdf', previewFormat: 'pdf', previewVersion: PREVIEW_VERSION, pages }
    return { pdf, info }
  } catch (e) { await loading.destroy(); throw e }
}
