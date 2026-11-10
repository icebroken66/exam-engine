import { request } from './transport'
import type { LearningSession } from './learning'
import type { QuestionCitation } from '../api'

export interface TutoringTurn {
  id: string
  task_id: string
  request_id: string
  sequence: number
  student_message: string
  status: 'running' | 'saved' | 'failed' | 'stale'
  reply: { message: string; action: string; reason: string; evidence_ids: string[]; help_level: string; observation: string; uncertainty: string } | null
  citations: QuestionCitation[]
  error: string
  mocked: boolean
  delivered_at: string | null
  created_at: string
}

export interface TutoringHistory {
  task_id: string
  sequence: number
  turns: TutoringTurn[]
  retest_help_enabled: boolean
  session: LearningSession
}

export function getTutoring(sessionId: string, taskId: string): Promise<TutoringHistory> {
  return request<TutoringHistory>(`/api/learning-sessions/${sessionId}/tasks/${taskId}/tutoring`, { signal: AbortSignal.timeout(15000) })
}

export function sendTutoring(session: LearningSession, requestId: string, sequence: number, message: string, allowRetestHelp: boolean): Promise<TutoringHistory> {
  return request<TutoringHistory>(`/api/learning-sessions/${session.id}/tutoring`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_task_id: session.current_task?.id, expected_progress_version: session.progress_version, request_id: requestId, expected_sequence: sequence, message, allow_retest_help: allowRetestHelp }) })
}

export function acknowledgeTutoring(sessionId: string, turnId: string): Promise<TutoringHistory> {
  return request<TutoringHistory>(`/api/learning-sessions/${sessionId}/tutoring/${turnId}/received`, { method: 'POST' })
}
