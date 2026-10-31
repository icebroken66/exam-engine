import { describe, expect, it } from 'vitest'
import { formatFileSize, sourceStatusLabel } from './source'

describe('source presentation', () => {
  it('makes every parse state visible in Chinese', () => {
    expect(sourceStatusLabel('uploaded')).toBe('待加入解析')
    expect(sourceStatusLabel('needs_review')).toBe('需要人工确认')
    expect(sourceStatusLabel('failed')).toBe('解析失败')
  })

  it('formats file sizes with stable units', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
