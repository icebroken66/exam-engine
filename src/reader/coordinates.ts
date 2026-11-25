import type { Anchor, DocumentInfo, Point, Region } from './types'
export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
export function pointAt(x: number, y: number, bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Point {
  return { x: clamp((x - bounds.left) / bounds.width), y: clamp((y - bounds.top) / bounds.height) }
}
export function regionBetween(a: Point, b: Point): Region { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } }
export function validRegion(r: Region): boolean { return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001 }
export function anchorError(a: Anchor, doc: DocumentInfo): string | null {
  if (a.documentId !== doc.id || a.previewVersion !== doc.previewVersion) return '引用资料或预览版本不匹配，未跳转。'
  if (!Number.isInteger(a.page) || a.page < 1 || a.page > doc.pages.length) return '引用页码无效，未跳转。'
  if (a.space !== 'normalized-top-left') return '引用坐标空间不支持，未跳转。'
  if (a.precision !== 'page' && (!a.regions.length || !a.regions.every(validRegion))) return '引用区域不存在或越界，未跳转。'
  return null
}
export function anchor(doc: DocumentInfo, page: number, regions: Region[], text?: string): Anchor { return { documentId: doc.id, previewVersion: doc.previewVersion, page, space: 'normalized-top-left', regions, text, precision: text ? 'text' : 'region' } }
export const regionStyle = (r: Region) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` })
