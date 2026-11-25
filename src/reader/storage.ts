import { anchorError, validRegion } from './coordinates'
import { SCHEMA } from './types'
import type { DocumentInfo, Snapshot } from './types'
import { validZoom } from './view'
const DATABASE = 'fe-v01-reader'
export const storageKey = (doc: DocumentInfo) => `${doc.id}:${doc.previewVersion}`
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('snapshots')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('无法打开本机数据库'))
    req.onblocked = () => reject(new Error('数据库被其他页面阻塞，请关闭旧验证页'))
  })
}
export function validateSnapshot(value: unknown, doc: DocumentInfo): Snapshot {
  const s = value as Snapshot
  if (!s || s.schema !== SCHEMA) throw new Error('未知保存格式；原数据保留，已暂停自动保存。请先导出原始数据。')
  try {
    if (s.document.id !== doc.id || s.document.previewVersion !== doc.previewVersion || JSON.stringify(s.document.pages) !== JSON.stringify(doc.pages)) throw 0
    if (!Array.isArray(s.annotations) || !s.reader || !Number.isInteger(s.reader.page) || s.reader.page < 1 || s.reader.page > doc.pages.length) throw 0
    if (!validZoom(s.reader.zoom) || typeof s.reader.draft !== 'string' || typeof s.reader.panelOpen !== 'boolean') throw 0
    if (![s.reader.scroll.x, s.reader.scroll.y].every(n => Number.isFinite(n) && n >= 0)) throw 0
    for (const a of [s.reader.selection, s.reader.context]) if (a && anchorError(a, doc)) throw 0
    const ids = new Set<string>()
    for (const a of s.annotations) {
      if (!a.id || ids.has(a.id) || a.schema !== SCHEMA || anchorError(a.anchor, doc)) throw 0
      ids.add(a.id)
      if (a.kind === 'ink') { if (!a.points.length || !a.points.every(p => [p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) || ![1, 2, 4, 8].includes(a.width) || !/^#[0-9a-f]{6}$/i.test(a.color)) throw 0 }
      else if (a.kind === 'note') { if (typeof a.text !== 'string' || (a.collapsed !== undefined && typeof a.collapsed !== 'boolean') || (a.color !== undefined && !/^#[0-9a-f]{6}$/i.test(a.color)) || !a.anchor.regions.every(validRegion)) throw 0 }
      else if (a.kind !== 'highlight' || !/^#[0-9a-f]{6}$/i.test(a.color)) throw 0
    }
    return s
  } catch { throw new Error('保存数据损坏或坐标不兼容；原数据保留，已暂停自动保存。请导出原始数据排查。') }
}
export async function readSnapshot(doc: DocumentInfo): Promise<{ snapshot: Snapshot | null; raw: unknown; error?: string }> {
  const db = await database()
  try {
    const raw = await new Promise<unknown>((resolve, reject) => { const tx = db.transaction('snapshots'); const req = tx.objectStore('snapshots').get(storageKey(doc)); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    if (raw === undefined) return { snapshot: null, raw: null }
    try { return { snapshot: validateSnapshot(raw, doc), raw } } catch (e) { return { snapshot: null, raw, error: String(e) } }
  } finally { db.close() }
}
export async function saveSnapshot(s: Snapshot, injectFailure = false): Promise<void> {
  if (injectFailure) throw new Error('验证夹具：已注入存储写入失败')
  const db = await database()
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(s, storageKey(s.document)); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('事务已取消')) }) } finally { db.close() }
}
export function exportJson(value: unknown, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
