export interface Course {
  id: string
  school: string
  name: string
  exam_date: string | null
  created_at: string
}

export interface CourseInput {
  school: string
  name: string
  exam_date: string | null
}

export interface Health {
  status: string
  service: string
  version: string
  database: string
}

export type SourceStatus = 'uploaded' | 'queued' | 'running' | 'needs_review' | 'ready' | 'failed'

export interface SourceOrigin {
  id: string
  kind: string
  repository: string
  ref: string
  commit_sha: string
  path: string
}

export interface Source {
  id: string
  course_id: string
  original_name: string
  extension: string
  media_type: string
  size_bytes: number
  sha256: string
  status: SourceStatus
  created_at: string
  origins: SourceOrigin[]
}

export interface SourceUpload {
  source: Source
  deduplicated: boolean
}

export interface ParseTask {
  id: string
  source_id: string
  attempt: number
  status: SourceStatus
  error: string | null
  created_at: string
  updated_at: string
}

export interface EvidenceBlock {
  id: string
  source_id: string
  node_id: string
  node_title: string
  ordinal: number
  text: string
  page_number: number | null
  content_hash: string
}

export interface CompletenessIssue {
  source_id: string
  source_name: string
  code: string
  message: string
  node_id: string | null
}

export interface CourseCompleteness {
  course_id: string
  total_sources: number
  ready_sources: number
  attention_sources: number
  total_nodes: number
  empty_nodes: number
  evidence_blocks: number
  complete: boolean
  issues: CompletenessIssue[]
}

export interface AgentExplanation {
  evidence_id: string
  summary: string
  key_points: string[]
  provider: string
  model: string
  mocked: boolean
  usage_id: string
}

export interface AgentCitation {
  evidence_id: string
  source_id: string
  source_name: string
  node_title: string
  page_number: number | null
  excerpt: string
  relevance: number
}

export interface AgentSolution {
  question: string
  answer: string
  steps: string[]
  analysis: string
  knowledge_points: string[]
  citations: AgentCitation[]
  provider: string
  model: string
  mocked: boolean
  usage_id: string
}

export type QuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'short_answer' | 'calculation' | 'other'
export type QuestionProvenance = 'original' | 'adapted'
export type QuestionCitation = Omit<AgentCitation, 'relevance'>

export interface CourseQuestion {
  id: string
  course_id: string
  stem: string
  question_type: QuestionType
  answer: string
  analysis: string
  knowledge_points: string[]
  provenance: QuestionProvenance
  origin_year: number | null
  status: 'draft' | 'verified'
  version: number
  reviewed_at: string | null
  created_at: string
  updated_at: string
  citations: QuestionCitation[]
}

export interface QuestionInput {
  stem: string
  question_type: QuestionType
  answer: string
  analysis: string
  knowledge_points: string[]
  provenance: QuestionProvenance
  origin_year: number | null
  evidence_ids: string[]
}

export interface QuestionUpdateInput extends QuestionInput {
  expected_version: number
  change_note: string
}

export interface QuestionRevision {
  id: string
  question_id: string
  version: number
  snapshot: {
    status: string
    answer: string
    analysis: string
    version: number
  }
  change_note: string
  created_at: string
}

export interface YearContribution {
  year: number
  question_count: number
  decay_factor: number
  weighted_count: number
}

export interface AnalyticsQuestion {
  id: string
  stem: string
  question_type: QuestionType
  origin_year: number | null
}

export interface KnowledgePointStat {
  id: string
  name: string
  question_count: number
  unknown_year_count: number
  weighted_frequency: number
  yearly_contributions: YearContribution[]
  questions: AnalyticsQuestion[]
}

export interface QuestionTypeStat {
  question_type: QuestionType
  question_count: number
  share: number
  yearly_counts: { year: number | null; question_count: number }[]
}

export interface CourseAnalytics {
  course_id: string
  as_of_year: number
  half_life_years: number
  decay_formula: string
  verified_question_count: number
  included_original_question_count: number
  draft_question_count: number
  adapted_question_count: number
  unknown_year_question_count: number
  knowledge_points: KnowledgePointStat[]
  question_types: QuestionTypeStat[]
}

export interface GitHubLocationInput {
  url: string
  ref: string | null
  path: string
}

export interface GitHubFile {
  path: string
  size: number
  sha: string
}

export interface GitHubPreview {
  repository: string
  ref: string
  commit_sha: string
  path: string
  files: GitHubFile[]
  total_bytes: number
  skipped_unsupported: number
  skipped_oversize: number
}

export interface GitHubImportInput extends GitHubLocationInput {
  expected_commit_sha: string
  rights_confirmed: boolean
}

export interface GitHubImportResult {
  preview: GitHubPreview
  results: SourceUpload[]
  imported_count: number
  deduplicated_count: number
  failures: { path: string; message: string }[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.detail ?? `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export function listCourses(): Promise<Course[]> {
  return request<Course[]>('/api/courses')
}

export function createCourse(input: CourseInput): Promise<Course> {
  return request<Course>('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function listSources(courseId: string): Promise<Source[]> {
  return request<Source[]>(`/api/courses/${courseId}/sources`)
}

export function getCourseCompleteness(courseId: string): Promise<CourseCompleteness> {
  return request<CourseCompleteness>(`/api/courses/${courseId}/completeness`)
}

export function uploadSource(courseId: string, file: File): Promise<SourceUpload> {
  const body = new FormData()
  body.append('file', file)
  body.append('rights_confirmed', 'true')
  return request<SourceUpload>(`/api/courses/${courseId}/sources`, { method: 'POST', body })
}

export function queueParse(sourceId: string): Promise<ParseTask> {
  return request<ParseTask>(`/api/sources/${sourceId}/parse`, { method: 'POST' })
}

export function listEvidence(sourceId: string): Promise<EvidenceBlock[]> {
  return request<EvidenceBlock[]>(`/api/sources/${sourceId}/evidence`)
}

export function explainEvidence(courseId: string, evidenceId: string): Promise<AgentExplanation> {
  return request<AgentExplanation>(`/api/courses/${courseId}/agent/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ evidence_id: evidenceId, focus: '' }),
  })
}

export function solveQuestion(courseId: string, question: string): Promise<AgentSolution> {
  return request<AgentSolution>(`/api/courses/${courseId}/agent/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
}

export function createQuestion(courseId: string, input: QuestionInput): Promise<CourseQuestion> {
  return request<CourseQuestion>(`/api/courses/${courseId}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function listQuestions(courseId: string): Promise<CourseQuestion[]> {
  return request<CourseQuestion[]>(`/api/courses/${courseId}/questions`)
}

export function updateQuestion(questionId: string, input: QuestionUpdateInput): Promise<CourseQuestion> {
  return request<CourseQuestion>(`/api/questions/${questionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function reviewQuestion(questionId: string, expectedVersion: number): Promise<CourseQuestion> {
  return request<CourseQuestion>(`/api/questions/${questionId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: expectedVersion, change_note: '人工校题通过' }),
  })
}

export function listQuestionRevisions(questionId: string): Promise<QuestionRevision[]> {
  return request<QuestionRevision[]>(`/api/questions/${questionId}/revisions`)
}

export function getCourseAnalytics(courseId: string, halfLifeYears = 3): Promise<CourseAnalytics> {
  return request<CourseAnalytics>(`/api/courses/${courseId}/analytics?half_life_years=${halfLifeYears}`)
}

export function previewGithub(courseId: string, input: GitHubLocationInput): Promise<GitHubPreview> {
  return request<GitHubPreview>(`/api/courses/${courseId}/github/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function importGithub(courseId: string, input: GitHubImportInput): Promise<GitHubImportResult> {
  return request<GitHubImportResult>(`/api/courses/${courseId}/github/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
