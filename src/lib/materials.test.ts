import {describe, expect, it} from 'vitest'
import type {Source} from './api'
import {filterMaterials, isPdf, readerHref} from './materials'
describe('course materials', () => {
  const sources = [
    {id:'a', original_name:'Alpha.PDF', extension:'.PDF', status:'failed'},
    {id:'b', original_name:'Alpha.PPTX', extension:'.pptx', status:'ready'},
    {id:'c', original_name:'中文讲义.pdf', extension:'.pdf', status:'ready'},
    {id:'d', original_name:'queued.pdf', extension:'pdf', status:'queued'},
  ] as Source[]
  it('separates PDF ability from parsing status and combines filename filters', () => {
    expect(filterMaterials(sources,'ALPHA','readable').map(s=>s.id)).toEqual(['a'])
    expect(filterMaterials(sources,'','processing').map(s=>s.id)).toEqual(['a','b','d'])
    expect(filterMaterials(sources,' 中文 ','all').map(s=>s.id)).toEqual(['c'])
    expect(filterMaterials(sources,'正文不存在','all')).toEqual([])
    expect(isPdf(sources[3])).toBe(true)
  })
  it('encodes immutable course and source identities', () => {
    expect(readerHref('课程/a','same&name')).toBe('#/courses/%E8%AF%BE%E7%A8%8B%2Fa/reader?source=same%26name')
  })
})
