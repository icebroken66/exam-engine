import { describe, expect, it } from 'vitest'
import { formatFileSize, formatProcessingDuration, sourceProcessingLabel, sourceStatusLabel, sourceElapsedSeconds } from './source'
import type { Source } from './api'

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

  it('shows real processing stages and question counts', () => {
    const source = {
      status: 'running',
      processing_stage: 'exam_solving',
      processing_completed: 7,
      processing_total: 21,
    } as Source
    expect(sourceProcessingLabel(source)).toBe('正在逐题处理与求解 7/21')
    expect(formatProcessingDuration(116.2)).toBe('1 分 56 秒')
  })
  it('calculates elapsed time across UTC timestamps and clamps future clocks', () => {
    const source = { status: 'running', processing_started_at: '2026-11-08T09:00:00', processing_duration_seconds: 0 } as Source
    const now = Date.parse('2026-11-08T09:01:56Z')
    expect(sourceElapsedSeconds(source, now)).toBe(116)
    expect(sourceElapsedSeconds({ ...source, processing_started_at: '2026-11-08T17:00:00+08:00' }, now)).toBe(116)
    expect(sourceElapsedSeconds(source, Date.parse('2026-11-08T08:59:59Z'))).toBe(0)
    expect(sourceElapsedSeconds({ ...source, status: 'failed', processing_duration_seconds: 42 }, now)).toBe(42)
    expect(sourceElapsedSeconds({ ...source, processing_started_at: 'invalid' }, now)).toBe(0)
  })

})
