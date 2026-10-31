from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CourseCreate(BaseModel):
    school: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=160)
    exam_date: date | None = None

    @field_validator("school", "name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("内容过短")
        return value


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    school: str
    name: str
    exam_date: date | None
    created_at: datetime


class HealthRead(BaseModel):
    status: str
    service: str
    version: str
    database: str


class SourceOriginRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    repository: str
    ref: str
    commit_sha: str
    path: str


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    course_id: str
    original_name: str
    extension: str
    media_type: str
    size_bytes: int
    sha256: str
    status: str
    created_at: datetime
    origins: list[SourceOriginRead] = []


class SourceUploadRead(BaseModel):
    source: SourceRead
    deduplicated: bool


class ParseTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    attempt: int
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime


class DocumentNodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    parent_id: str | None
    title: str
    ordinal: int
    page_start: int | None
    page_end: int | None


class EvidenceBlockRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    node_id: str
    ordinal: int
    text: str
    page_number: int | None
    content_hash: str
    node_title: str | None = None


class CompletenessIssueRead(BaseModel):
    source_id: str
    source_name: str
    code: str
    message: str
    node_id: str | None


class CourseCompletenessRead(BaseModel):
    course_id: str
    total_sources: int
    ready_sources: int
    attention_sources: int
    total_nodes: int
    empty_nodes: int
    evidence_blocks: int
    complete: bool
    issues: list[CompletenessIssueRead]


class GitHubLocationInput(BaseModel):
    url: str = Field(min_length=12, max_length=1000)
    ref: str | None = Field(default=None, max_length=200)
    path: str = Field(default="", max_length=1000)


class GitHubFileRead(BaseModel):
    path: str
    size: int
    sha: str


class GitHubPreviewRead(BaseModel):
    repository: str
    ref: str
    commit_sha: str
    path: str
    files: list[GitHubFileRead]
    total_bytes: int
    skipped_unsupported: int
    skipped_oversize: int


class GitHubImportInput(GitHubLocationInput):
    expected_commit_sha: str = Field(pattern=r"^[0-9a-f]{40}$")
    rights_confirmed: bool


class GitHubImportFailure(BaseModel):
    path: str
    message: str


class GitHubImportRead(BaseModel):
    preview: GitHubPreviewRead
    results: list[SourceUploadRead]
    imported_count: int
    deduplicated_count: int
    failures: list[GitHubImportFailure]


class AgentExplanationInput(BaseModel):
    evidence_id: str
    focus: str = Field(default="", max_length=300)


class AgentExplanationContent(BaseModel):
    summary: str = Field(min_length=1, max_length=4000)
    key_points: list[str] = Field(min_length=1, max_length=6)


class AgentExplanationRead(BaseModel):
    evidence_id: str
    summary: str
    key_points: list[str]
    provider: str
    model: str
    mocked: bool
    usage_id: str


class AgentSolveInput(BaseModel):
    question: str = Field(min_length=2, max_length=10_000)

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("题目内容过短")
        return value


class AgentSolutionContent(BaseModel):
    answer: str = Field(min_length=1, max_length=8000)
    steps: list[str] = Field(min_length=1, max_length=10)
    analysis: str = Field(min_length=1, max_length=6000)
    knowledge_points: list[str] = Field(min_length=1, max_length=8)


class AgentCitationRead(BaseModel):
    evidence_id: str
    source_id: str
    source_name: str
    node_title: str
    page_number: int | None
    excerpt: str
    relevance: float


class AgentSolutionRead(BaseModel):
    question: str
    answer: str
    steps: list[str]
    analysis: str
    knowledge_points: list[str]
    citations: list[AgentCitationRead]
    provider: str
    model: str
    mocked: bool
    usage_id: str


QuestionType = Literal["single_choice", "multiple_choice", "true_false", "short_answer", "calculation", "other"]
QuestionProvenance = Literal["original", "adapted"]


class QuestionContentInput(BaseModel):
    stem: str = Field(min_length=2, max_length=10_000)
    question_type: QuestionType
    answer: str = Field(min_length=1, max_length=12_000)
    analysis: str = Field(min_length=1, max_length=12_000)
    knowledge_points: list[str] = Field(min_length=1, max_length=8)
    provenance: QuestionProvenance
    origin_year: int | None = Field(default=None, ge=1900, le=2100)
    evidence_ids: list[str] = Field(min_length=1, max_length=5)

    @field_validator("stem", "answer", "analysis")
    @classmethod
    def strip_question_content(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("题目、答案和解析不能为空")
        return value

    @field_validator("knowledge_points")
    @classmethod
    def normalize_knowledge_points(cls, value: list[str]) -> list[str]:
        points = list(dict.fromkeys(point.strip() for point in value if point.strip()))
        if not points or any(len(point) > 120 for point in points):
            raise ValueError("考点不能为空，且每项不能超过 120 字")
        return points

    @field_validator("evidence_ids")
    @classmethod
    def deduplicate_evidence(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class QuestionCreateInput(QuestionContentInput):
    pass


class QuestionUpdateInput(QuestionContentInput):
    expected_version: int = Field(ge=1)
    change_note: str = Field(min_length=1, max_length=300)


class QuestionReviewInput(BaseModel):
    expected_version: int = Field(ge=1)
    change_note: str = Field(default="人工校题通过", min_length=1, max_length=300)


class QuestionEvidenceRead(BaseModel):
    evidence_id: str
    source_id: str
    source_name: str
    node_title: str
    page_number: int | None
    excerpt: str


class QuestionRead(BaseModel):
    id: str
    course_id: str
    stem: str
    question_type: QuestionType
    answer: str
    analysis: str
    knowledge_points: list[str]
    provenance: QuestionProvenance
    origin_year: int | None
    status: Literal["draft", "verified"]
    version: int
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    citations: list[QuestionEvidenceRead]


class QuestionRevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    question_id: str
    version: int
    snapshot: dict
    change_note: str
    created_at: datetime


class KnowledgePointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    normalized_name: str


class YearContributionRead(BaseModel):
    year: int
    question_count: int
    decay_factor: float
    weighted_count: float


class AnalyticsQuestionRead(BaseModel):
    id: str
    stem: str
    question_type: QuestionType
    origin_year: int | None


class KnowledgePointStatRead(BaseModel):
    id: str
    name: str
    question_count: int
    unknown_year_count: int
    weighted_frequency: float
    yearly_contributions: list[YearContributionRead]
    questions: list[AnalyticsQuestionRead]


class QuestionTypeStatRead(BaseModel):
    question_type: QuestionType
    question_count: int
    share: float
    yearly_counts: list[dict[str, int | None]]


class CourseAnalyticsRead(BaseModel):
    course_id: str
    as_of_year: int
    half_life_years: float
    decay_formula: str
    verified_question_count: int
    included_original_question_count: int
    draft_question_count: int
    adapted_question_count: int
    unknown_year_question_count: int
    knowledge_points: list[KnowledgePointStatRead]
    question_types: list[QuestionTypeStatRead]


class UsageRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    purpose: str
    provider: str
    model: str
    status: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    reserved_tokens: int
    estimated_cost_usd: float
    error: str | None
    created_at: datetime


class CourseUsageRead(BaseModel):
    course_used_tokens: int
    course_token_budget: int
    course_remaining_tokens: int
    daily_used_tokens: int
    daily_token_budget: int
    provider: str
    model: str
    mocked: bool
    records: list[UsageRecordRead]
