import { request } from './transport'
import type { QuestionType, QuestionCitation } from '../api'

export interface CourseContext {
  course_id: string
  preparation_status: 'awaiting_anchor' | 'assessing_materials' | 'ready_to_confirm' | 'needs_more_evidence'
  can_start: boolean
  knowledge_mode: 'course_specific' | 'hybrid' | 'general'
  scope_text: string
  scope_source: 'user' | 'course_evidence' | 'general_inference' | 'awaiting_anchor'
  topics: string[]
  visible_limitation: string
  total_sources: number
  usable_sources: number
  parsing_sources: number
  failed_sources: number
  missing_materials: string[]
}

export type LearningStage = 'preparing' | 'diagnosing' | 'reviewing' | 'remediating' | 'practicing' | 'retesting' | 'planning' | 'simulating' | 'blocked' | 'completed'

export interface LearningAttempt {
  id: string
  task_id: string
  attempt_number: number
  answer: string
  verdict: 'correct' | 'incorrect' | 'ungraded'
  grading_layer: string
  confidence: number | null
  feedback: string
  missing_points: string[]
  hints_used: number
  duration_seconds: number
  provider: string
  model: string
  mocked: boolean
  usage_id: string | null
  created_at: string
  review_history: {
    id: string
    created_at: string
    reason: string
    method?: 'ai' | 'human'
    previous: { verdict: string; feedback: string }
    revised: { verdict: string; feedback: string }
  }[]
}

export interface LearningTask {
  source_removed: boolean
  help_exposures: number
  id: string
  kind: 'diagnostic' | 'practice' | 'retest'
  ordinal: number
  knowledge_point: string
  sub_skill: string
  cognitive_level: 'remember' | 'understand' | 'apply' | 'analyze'
  difficulty_prior: 'basic' | 'medium' | 'advanced'
  question_type: QuestionType
  stem: string
  options: string[]
  provenance: string
  origin_question_id: string | null
  answer_provenance: 'source' | 'ai' | 'human' | 'missing'
  source_track: 'course' | 'general'
  visible_limitation: string
  rubric: string[]
  prerequisites: string[]
  validation_status: string
  validation_confidence: number | null
  decision_reason: string
  reference_answer: string | null
  study_answer: string | null
  analysis: string | null
  citations: QuestionCitation[]
  latest_attempt: LearningAttempt | null
}

export interface LearningPointState {
  knowledge_point: string
  status: string
  evidence_confidence: 'low' | 'medium' | 'high'
  hint_dependent: boolean
  no_progress_rounds: number
  score: number
  evidence_count: number
  last_attempt_id: string | null
  updated_at: string
}

export interface LearningEvent {
  id: string
  task_id: string | null
  kind: string
  payload: Record<string, unknown>
  created_at: string
}

export interface LearningSession {
  progress_version: string
  id: string
  course_id: string
  stage: LearningStage
  knowledge_mode: 'course_specific' | 'hybrid' | 'general'
  scope_text: string
  visible_limitation: string
  current_task: LearningTask | null
  diagnostic_total: number
  diagnostic_completed: number
  diagnostic_target: number
  practice_completed: number
  retest_passed: number
  points: LearningPointState[]
  recent_events: LearningEvent[]
  agent_message: string
  next_action: string
  created_at: string
  updated_at: string
}

export function getLearningContext(courseId: string): Promise<CourseContext> {
  return request<CourseContext>(`/api/courses/${courseId}/learning-context`)
}

export function getCurrentLearningSession(courseId: string): Promise<LearningSession | null> {
  return request<LearningSession | null>(`/api/courses/${courseId}/learning-sessions/current`, { signal: AbortSignal.timeout(15000) })
}

export function startLearningSession(courseId: string, restart = false): Promise<LearningSession> {
  const query = restart ? '?restart=true' : ''
  return request<LearningSession>(`/api/courses/${courseId}/learning-sessions${query}`, { method: 'POST' })
}

export function getLearningSession(sessionId: string): Promise<LearningSession> {
  return request<LearningSession>(`/api/learning-sessions/${sessionId}`, { signal: AbortSignal.timeout(15000) })
}

export function submitLearningAttempt(session: LearningSession, answer: string, durationSeconds: number): Promise<LearningSession> {
  return request<LearningSession>(`/api/learning-sessions/${session.id}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer, duration_seconds: durationSeconds, ...learningProgressInput(session) }),
  })
}

export interface LearningSessionSummary {
  id: string
  course_id: string
  stage: string
  created_at: string
  updated_at: string
}

export interface LearningSessionHistory {
  session: LearningSession
  tasks: { task: LearningTask; attempts: LearningAttempt[] }[]
}

export function listLearningSessions(courseId: string): Promise<LearningSessionSummary[]> {
  return request(`/api/courses/${courseId}/learning-sessions`)
}

export function getLearningHistory(sessionId: string): Promise<LearningSessionHistory> {
  return request(`/api/learning-sessions/${sessionId}/history`)
}

export function correctLearningAttempt(sessionId: string, attempt: LearningAttempt, verdict: LearningAttempt['verdict'], reason: string): Promise<LearningSession> {
  return request(`/api/learning-sessions/${sessionId}/attempts/${attempt.id}/correction`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict, reason, expected_review_count: attempt.review_history.length }),
  })
}

export function reviewLearningAttempt(sessionId: string, attemptId: string, reason: string, expectedReviewCount = 0): Promise<LearningSession> {
  return request<LearningSession>(`/api/learning-sessions/${sessionId}/attempts/${attemptId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, expected_review_count: expectedReviewCount }),
  })
}

function learningProgressInput(session: LearningSession) {
  return { expected_task_id: session.current_task?.id, expected_progress_version: session.progress_version }
}

export function advanceLearningSession(session: LearningSession): Promise<LearningSession> {
  return request<LearningSession>(`/api/learning-sessions/${session.id}/next`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(learningProgressInput(session)),
  })
}

export function requestLearningHint(session: LearningSession): Promise<{ hint: string; session: LearningSession }> {
  return request<{ hint: string; session: LearningSession }>(`/api/learning-sessions/${session.id}/hints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(learningProgressInput(session)) })
}
