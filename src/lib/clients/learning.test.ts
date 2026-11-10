import { afterEach, describe, expect, it, vi } from 'vitest'
import * as legacy from '../api'
import * as learning from './learning'
import * as tutoring from './tutoring'
import * as evidence from './evidence'
import { request } from './transport'
import type { LearningSession } from './learning'

afterEach(() => vi.unstubAllGlobals())

describe('learning API module contracts', () => {
  it('retains identical runtime exports through the legacy facade', () => {
    for (const domain of [learning, tutoring, evidence]) {
      for (const [name, value] of Object.entries(domain)) {
        expect(legacy[name as keyof typeof legacy]).toBe(value)
      }
    }
  })

  it('sends one versioned request for formal answers and one for tutoring', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetch)
    const session = { id: 's', progress_version: 'version', current_task: { id: 't' } } as LearningSession
    await learning.submitLearningAttempt(session, 'answer', 12)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/learning-sessions/s/attempts')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ answer: 'answer', duration_seconds: 12, expected_task_id: 't', expected_progress_version: 'version' })
    await tutoring.sendTutoring(session, 'request', 3, 'help', true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expected_task_id: 't', expected_progress_version: 'version', request_id: 'request', expected_sequence: 3, message: 'help', allow_retest_help: true })
  })

  it('keeps error details, non-JSON fallback and empty responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'conflict' }) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('invalid JSON') } })
      .mockResolvedValueOnce({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetch)
    await expect(request('/fixture')).rejects.toThrow('conflict')
    await expect(request('/fixture')).rejects.toThrow('请求失败（503）')
    await expect(request('/fixture')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
