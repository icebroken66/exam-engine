from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    school: Mapped[str] = mapped_column(String(120))
    name: Mapped[str] = mapped_column(String(160))
    scope_text: Mapped[str] = mapped_column(Text, default="")
    scope_source: Mapped[str] = mapped_column(String(24), default="")
    scope_signature: Mapped[str] = mapped_column(String(64), default="")
    scope_topics: Mapped[list[str]] = mapped_column(JSON, default=list)
    exam_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    source_kind: Mapped[str] = mapped_column(String(24), default="local")
    status: Mapped[str] = mapped_column(String(24), default="parsing")
    total_files: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("course_id", "sha256", name="uq_source_course_sha256"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    import_batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True, index=True)
    original_name: Mapped[str] = mapped_column(String(180))
    relative_path: Mapped[str] = mapped_column(String(1000), default="")
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    storage_key: Mapped[str] = mapped_column(String(80), unique=True)
    extension: Mapped[str] = mapped_column(String(12))
    media_type: Mapped[str] = mapped_column(String(160))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40), default="uploaded", index=True)
    material_type: Mapped[str] = mapped_column(String(24), default="other")
    material_confidence: Mapped[float] = mapped_column(Float, default=0)
    material_rationale: Mapped[str] = mapped_column(Text, default="尚未识别资料类型")
    processing_note: Mapped[str] = mapped_column(Text, default="")
    processing_stage: Mapped[str] = mapped_column(String(32), default="uploaded")
    processing_completed: Mapped[int] = mapped_column(Integer, default=0)
    processing_total: Mapped[int] = mapped_column(Integer, default=0)
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_duration_seconds: Mapped[float] = mapped_column(Float, default=0)
    rights_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SourceOrigin(Base):
    __tablename__ = "source_origins"
    __table_args__ = (UniqueConstraint(
        "source_id", "kind", "repository", "commit_sha", "path", name="uq_source_origin_version",
    ),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="github")
    repository: Mapped[str] = mapped_column(String(255))
    ref: Mapped[str] = mapped_column(String(200))
    commit_sha: Mapped[str] = mapped_column(String(40))
    path: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ParseTask(Base):
    __tablename__ = "parse_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DocumentNode(Base):
    __tablename__ = "document_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("document_nodes.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    ordinal: Mapped[int] = mapped_column(Integer)
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)


class EvidenceBlock(Base):
    __tablename__ = "evidence_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("document_nodes.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64))


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(48), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(24), default="running", index=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    reserved_tokens: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"), nullable=True, index=True)
    extraction_key: Mapped[str] = mapped_column(String(64), default="")
    stem: Mapped[str] = mapped_column(Text)
    question_type: Mapped[str] = mapped_column(String(32))
    options: Mapped[list[str]] = mapped_column(JSON, default=list)
    answer: Mapped[str] = mapped_column(Text)
    answer_provenance: Mapped[str] = mapped_column(String(24), default="source")
    extraction_confidence: Mapped[float] = mapped_column(Float, default=1)
    extraction_issues: Mapped[list[str]] = mapped_column(JSON, default=list)
    analysis: Mapped[str] = mapped_column(Text)
    knowledge_points: Mapped[list[str]] = mapped_column(JSON)
    provenance: Mapped[str] = mapped_column(String(24), default="original")
    origin_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stem_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    answer_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class QuestionEvidence(Base):
    __tablename__ = "question_evidence"
    __table_args__ = (UniqueConstraint("question_id", "evidence_id", name="uq_question_evidence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    evidence_id: Mapped[str] = mapped_column(ForeignKey("evidence_blocks.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)


class QuestionRevision(Base):
    __tablename__ = "question_revisions"
    __table_args__ = (UniqueConstraint("question_id", "version", name="uq_question_revision_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    change_note: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KnowledgePoint(Base):
    __tablename__ = "knowledge_points"
    __table_args__ = (UniqueConstraint("course_id", "normalized_name", name="uq_course_knowledge_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    normalized_name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuestionKnowledgePoint(Base):
    __tablename__ = "question_knowledge_points"
    __table_args__ = (UniqueConstraint("question_id", "knowledge_point_id", name="uq_question_knowledge"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    knowledge_point_id: Mapped[str] = mapped_column(ForeignKey("knowledge_points.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)


class LearningSession(Base):
    __tablename__ = "learning_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(24), default="preparing", index=True)
    knowledge_mode: Mapped[str] = mapped_column(String(24), default="general")
    scope_text: Mapped[str] = mapped_column(Text, default="")
    diagnostic_signature: Mapped[str] = mapped_column(String(64), default="")
    current_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningTask(Base):
    __tablename__ = "learning_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    knowledge_point: Mapped[str] = mapped_column(String(120), index=True)
    sub_skill: Mapped[str] = mapped_column(String(300), default="")
    cognitive_level: Mapped[str] = mapped_column(String(24), default="understand")
    difficulty_prior: Mapped[str] = mapped_column(String(24), default="basic")
    question_type: Mapped[str] = mapped_column(String(32))
    stem: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str]] = mapped_column(JSON)
    reference_answer: Mapped[str] = mapped_column(Text)
    remediation_answer: Mapped[str] = mapped_column(Text)
    analysis: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON)
    provenance: Mapped[str] = mapped_column(String(24))
    origin_question_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    answer_provenance: Mapped[str] = mapped_column(String(24), default="source")
    source_track: Mapped[str] = mapped_column(String(24), default="course")
    visible_limitation: Mapped[str] = mapped_column(Text, default="")
    rubric: Mapped[list[str]] = mapped_column(JSON, default=list)
    prerequisites: Mapped[list[str]] = mapped_column(JSON, default=list)
    validation_status: Mapped[str] = mapped_column(String(24), default="draft")
    validation_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    validation_notes: Mapped[list[str]] = mapped_column(JSON, default=list)
    evidence_version: Mapped[str] = mapped_column(String(64), default="")
    decision_reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningAttempt(Base):
    __tablename__ = "learning_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("learning_tasks.id", ondelete="CASCADE"), index=True)
    attempt_number: Mapped[int] = mapped_column(Integer)
    answer: Mapped[str] = mapped_column(Text)
    verdict: Mapped[str] = mapped_column(String(24))
    grading_layer: Mapped[str] = mapped_column(String(32))
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str] = mapped_column(Text)
    missing_points: Mapped[list[str]] = mapped_column(JSON)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    mocked: Mapped[bool] = mapped_column(Boolean, default=False)
    usage_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class LearningPointState(Base):
    __tablename__ = "learning_point_states"
    __table_args__ = (UniqueConstraint("session_id", "knowledge_point", name="uq_learning_session_point"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    knowledge_point: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(24))
    evidence_confidence: Mapped[str] = mapped_column(String(16), default="low")
    hint_dependent: Mapped[bool] = mapped_column(Boolean, default=False)
    no_progress_rounds: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[float] = mapped_column(Float, default=0)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("learning_sessions.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
