import { request } from './clients/transport'
export * from './clients/learning'
export * from './clients/tutoring'
export * from './clients/evidence'

export interface Course {
  id: string
  school: string
  name: string
  scope_text: string
  exam_date: string | null
  archived_at: string | null
  created_at: string
}

export interface CourseInput {
  school: string
  name: string
  scope_text?: string
  exam_date: string | null
}

export interface Health {
  status: string
  service: string
  version: string
  database: string
}

export type SourceStatus = 'uploaded' | 'queued' | 'running' | 'needs_review' | 'needs_transcription_review' | 'ready' | 'failed'

export type MaterialType = 'courseware' | 'past_exam' | 'assignment' | 'teacher_guidance' | 'notes' | 'other'

export interface SourceOrigin {
  id: string
  kind: string
  repository: string
  ref: string
  commit_sha: string
  path: string
}

export interface Source {
  removed_at: string | null
  id: string
  course_id: string
  import_batch_id: string | null
  original_name: string
  relative_path: string
  extension: string
  media_type: string
  size_bytes: number
  sha256: string
  status: SourceStatus
  material_type: MaterialType
  material_confidence: number
  material_rationale: string
  processing_note: string
  processing_stage: string
  processing_completed: number
  processing_total: number
  processing_started_at: string | null
  processing_finished_at: string | null
  processing_duration_seconds: number
  created_at: string
  origins: SourceOrigin[]
}

export interface SourceUpload {
  source: Source
  deduplicated: boolean
}

export interface SourceBatchFailure {
  filename: string
  message: string
}

export interface SourceBatchUpload {
  batch_id: string
  results: SourceUpload[]
  failures: SourceBatchFailure[]
  imported_count: number
  deduplicated_count: number
}

export interface WebSourceAssessment {
  url: string
  recommendation: 'recommended' | 'optional' | 'reject'
  confidence: number
  reason: string
  evidence_excerpt: string
}

export interface WebResult {
  title: string
  url: string
  snippet: string
  assessment: WebSourceAssessment | null
  read_error: string | null
}

export interface WebSearchResult {
  query: string
  results: WebResult[]
}

export interface WebResearchResult extends WebSearchResult {
  evidence_needed: string
  rationale: string
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
  source_id: string | null
  stem: string
  question_type: QuestionType
  options: string[]
  answer: string
  answer_provenance: 'source' | 'ai' | 'human' | 'missing'
  extraction_confidence: number
  extraction_issues: string[]
  analysis: string
  knowledge_points: string[]
  provenance: QuestionProvenance
  origin_year: number | null
  status: 'draft' | 'verified'
  version: number
  reviewed_at: string | null
  stem_reviewed_at: string | null
  answer_reviewed_at: string | null
  created_at: string
  updated_at: string
  citations: QuestionCitation[]
}

export interface QuestionInput {
  stem: string
  question_type: QuestionType
  options?: string[]
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
    reviewed_at?: string | null
    stem_reviewed_at?: string | null
    answer_reviewed_at?: string | null
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

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export function listCourses(includeArchived = false): Promise<Course[]> {
  const query = includeArchived ? '?include_archived=true' : ''
  return request<Course[]>(`/api/courses${query}`)
}

export function createCourse(input: CourseInput): Promise<Course> {
  return request<Course>('/api/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateCourseScope(courseId: string, scopeText: string): Promise<Course> {
  return request<Course>(`/api/courses/${courseId}/scope`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope_text: scopeText }),
  })
}

export function archiveCourse(courseId: string, archived: boolean): Promise<Course> {
  return request<Course>(`/api/courses/${courseId}/archive`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  })
}

export function deleteCourse(courseId: string, confirmation: string): Promise<void> {
  return request<void>(`/api/courses/${courseId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  })
}

export function listSources(courseId: string, signal?: AbortSignal): Promise<Source[]> {
  return request<Source[]>(`/api/courses/${courseId}/sources`, { signal })
}

export function getCourseCompleteness(courseId: string, signal?: AbortSignal): Promise<CourseCompleteness> {
  return request<CourseCompleteness>(`/api/courses/${courseId}/completeness`, { signal })
}

export function uploadSource(courseId: string, file: File): Promise<SourceUpload> {
  const body = new FormData()
  body.append('file', file)
  body.append('rights_confirmed', 'true')
  return request<SourceUpload>(`/api/courses/${courseId}/sources`, { method: 'POST', body })
}

export function uploadSources(courseId: string, files: File[]): Promise<SourceBatchUpload> {
  const body = new FormData()
  for (const file of files) {
    body.append('files', file)
    body.append('relative_paths', file.webkitRelativePath || file.name)
  }
  body.append('rights_confirmed', 'true')
  return request<SourceBatchUpload>(`/api/courses/${courseId}/sources/batch`, { method: 'POST', body })
}

export function searchWebSources(courseId: string, query: string): Promise<WebSearchResult> {
  return request<WebSearchResult>(`/api/courses/${courseId}/web/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
}

export function researchWebSources(courseId: string, focus?: string): Promise<WebResearchResult> {
  return request<WebResearchResult>(`/api/courses/${courseId}/web/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ focus }),
  })
}

export function importWebSource(courseId: string, url: string, title: string): Promise<SourceUpload> {
  return request<SourceUpload>(`/api/courses/${courseId}/web/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title }),
  })
}

export function updateSourceMaterial(sourceId: string, materialType: MaterialType): Promise<Source> {
  return request<Source>(`/api/sources/${sourceId}/material`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ material_type: materialType }),
  })
}

export function queueParse(sourceId: string): Promise<ParseTask> {
  return request<ParseTask>(`/api/sources/${sourceId}/parse`, { method: 'POST' })
}

export function confirmSourceTranscription(sourceId: string): Promise<Source> {
  return request<Source>(`/api/sources/${sourceId}/transcription-review`, { method: 'POST' })
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

export function reviewQuestion(questionId: string, expectedVersion: number, scope: 'stem' | 'answer' | 'all' = 'all'): Promise<CourseQuestion> {
  return request<CourseQuestion>(`/api/questions/${questionId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: expectedVersion, scope }),
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

export interface SourceRemovalImpact {
  source_id: string
  source_name: string
  evidence_count: number
  question_count: number
  history_task_count: number
  pending_task_count: number
  blocked_reason: string
  signature: string
  removed: boolean
}

export function getSourceRemovalImpact(sourceId: string): Promise<SourceRemovalImpact> {
  return request(`/api/sources/${sourceId}/removal-impact`)
}

export function removeSource(sourceId: string, signature: string): Promise<SourceRemovalImpact> {
  return request(`/api/sources/${sourceId}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_signature: signature }),
  })
}

export interface CoverageTask {
  id: string
  session_id: string
  knowledge_point: string
  sub_skill: string
  verdict: string
}

export interface CoverageUnit {
  source_id: string
  source_name: string
  source_status: SourceStatus
  node_id: string | null
  title: string
  page_start: number | null
  page_end: number | null
  text_status: 'available' | 'unavailable'
  semantic_status: 'untracked'
  evidence: { id: string; page_number: number | null; excerpt: string }[]
  questions: { id: string; status: string; provenance: string }[]
  topics: string[]
  diagnostic_tasks: CoverageTask[]
  retest_tasks: CoverageTask[]
}

export interface CourseCoverage {
  course_id: string
  source_count: number
  unit_count: number
  text_available_units: number
  diagnostic_linked_units: number
  retest_linked_units: number
  limitation: string
  units: CoverageUnit[]
}

export function getCourseCoverage(courseId: string): Promise<CourseCoverage> {
  return request<CourseCoverage>(`/api/courses/${courseId}/coverage`, { signal: AbortSignal.timeout(15000) })
}
