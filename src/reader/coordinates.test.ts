import { describe, expect, it } from 'vitest'
import { anchor, anchorError, pointAt, regionBetween } from './coordinates'
import { PREVIEW_VERSION } from './types'
import { storageKey, validateSnapshot } from './storage'
import { initialReader } from './types'
const doc = { id: 'hash-a', name: 'same.pdf', originalFormat: 'pdf' as const, previewFormat: 'pdf' as const, previewVersion: PREVIEW_VERSION, pages: [{ width: 800, height: 600 }, { width: 600, height: 800 }] }
describe('reader anchor and storage boundary', () => {
  it('clips reverse drags to page boundaries', () => { expect(regionBetween(pointAt(-20, 900, { left: 20, top: 30, width: 800, height: 600 }), pointAt(900, -100, { left: 20, top: 30, width: 800, height: 600 }))).toEqual({ x: 0, y: 0, width: 1, height: 1 }) })
  it('rejects imprecise, out of bounds and wrong-version references', () => {
    const a = anchor(doc, 1, [{ x: .2, y: .2, width: .3, height: .4 }], '中文')
    expect(anchorError(a, doc)).toBeNull()
    for (const bad of [{ ...a, page: 3 }, { ...a, documentId: 'hash-b' }, { ...a, previewVersion: 'future' }, { ...a, regions: [] }, { ...a, regions: [{ x: .9, y: .9, width: .5, height: .5 }] }]) expect(anchorError(bad, doc)).toBeTruthy()
    expect(anchorError({ ...a, precision: 'page', regions: [] }, doc)).toBeNull()
  })
  it('isolates same names, changed bytes and preview versions', () => { expect(storageKey(doc)).not.toBe(storageKey({ ...doc, id: 'hash-b' })); expect(storageKey(doc)).not.toBe(storageKey({ ...doc, previewVersion: 'next' })); expect(storageKey(doc)).toBe(storageKey({ ...doc, name: 'renamed.pdf' })) })
  it('rejects unknown/corrupt snapshots rather than overwriting original data', () => {
    const s = { schema: 1, document: doc, annotations: [], reader: initialReader(), savedAt: '2026-11-23' }
    expect(validateSnapshot(s, doc)).toEqual(s)
    for (const corrupt of [{ ...s, schema: 99 }, { ...s, reader: { ...s.reader, page: 99 } }, { ...s, annotations: [{ id: 'x', schema: 1, kind: 'note', text: 'x', anchor: anchor(doc, 8, []) }] }, null]) expect(() => validateSnapshot(corrupt, doc)).toThrow()
  })
  it('reads legacy notes and validates optional note accents',()=>{
    const note={id:'note',schema:1,kind:'note',text:'旧笔记',updatedAt:'2026-11-23',anchor:anchor(doc,1,[{x:.2,y:.2,width:.25,height:.15}])}
    const saved={schema:1,document:doc,annotations:[note],reader:initialReader(),savedAt:'2026-11-23'}
    expect(validateSnapshot(saved,doc).annotations).toHaveLength(1)
    expect(validateSnapshot({...saved,annotations:[{...note,color:'#8c5ac4'}]},doc).annotations).toHaveLength(1)
    expect(()=>validateSnapshot({...saved,annotations:[{...note,color:'invalid'}]},doc)).toThrow()
  })
})
