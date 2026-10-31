import { describe, expect, it } from 'vitest'
import { daysUntil, examCountdown } from './course'

describe('exam countdown', () => {
  const today = new Date('2026-10-27T08:00:00')

  it('uses calendar days rather than remaining hours', () => {
    expect(daysUntil('2026-11-03', today)).toBe(7)
  })

  it('handles unset, current and past exam dates', () => {
    expect(examCountdown(null, today)).toBe('尚未设置考试日')
    expect(examCountdown('2026-10-27', today)).toBe('今天考试')
    expect(examCountdown('2026-10-25', today)).toBe('已考 2 天')
  })
})
