import { request } from './transport'

export interface PriorLearningEvidence {
  session_id: string
  task_id: string
  attempt_id: string
  knowledge_point: string
  sub_skill: string
  kind: string
  verdict: 'correct' | 'incorrect' | 'ungraded'
  hints_used: number
  taken_at: string
  grading_layer: string
  evidence_version: string
  usable: boolean
  exclusion_reason: string
  recommendation: 'needs_review' | 'repair' | 'without_help' | 'due' | 'later'
  explanation: string
  due_at: string | null
}

export interface CourseLearningEvidence {
  course_id: string
  current_version: string
  total: number
  usable_count: number
  excluded_count: number
  due_count: number
  page: number
  page_size: number
  items: PriorLearningEvidence[]
  limitation: string
}

export function getCourseLearningEvidence(courseId: string, page = 1): Promise<CourseLearningEvidence> {
  return request<CourseLearningEvidence>(`/api/courses/${courseId}/learning-evidence?page=${page}&page_size=6`)
}
