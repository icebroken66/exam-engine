"""Additive FE-V10 durable requests/messages; no changes to previous schemas."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

class AssistantRequest(Base):
    __tablename__ = 'assistant_requests'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    topic_id: Mapped[str] = mapped_column(ForeignKey('assistant_topics.id', ondelete='CASCADE'), index=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    intent: Mapped[dict] = mapped_column(JSON)
    frozen: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    teaching: Mapped[list] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(32), default='accepted', index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    dispatched: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str] = mapped_column(Text, default='')
    notices: Mapped[list] = mapped_column(JSON, default=list)
    usage_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    retry_of: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class AssistantMessage(Base):
    __tablename__ = 'assistant_messages'
    __table_args__ = (UniqueConstraint('request_id','role',name='uq_assistant_request_role'),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(ForeignKey('assistant_requests.id', ondelete='CASCADE'), index=True)
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    topic_id: Mapped[str] = mapped_column(ForeignKey('assistant_topics.id', ondelete='CASCADE'), index=True)
    role: Mapped[str] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text)
    claims: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedExplanation(Base):
    """Explicit, revocable relation from one immutable answer to learning anchors."""
    __tablename__ = 'assistant_saved_explanations'
    __table_args__ = (UniqueConstraint('course_id','command_id',name='uq_saved_explanation_command'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    topic_id: Mapped[str] = mapped_column(ForeignKey('assistant_topics.id', ondelete='CASCADE'), index=True)
    request_id: Mapped[str] = mapped_column(ForeignKey('assistant_requests.id', ondelete='CASCADE'), index=True)
    command_id: Mapped[str] = mapped_column(String(100))
    payload_hash: Mapped[str] = mapped_column(String(64))
    content: Mapped[dict] = mapped_column(JSON)
    anchors: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
