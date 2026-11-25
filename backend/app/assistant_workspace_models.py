"""FE-V08 persistence; never stores formal learning state or generated messages."""
from datetime import datetime
from uuid import uuid4
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class WorkItem(Base):
    __tablename__ = 'assistant_work_items'
    __table_args__ = (UniqueConstraint('course_id', 'task_id', name='uq_workspace_course_task'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=2)
    kind: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(200))
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    attention: Mapped[str] = mapped_column(String(16), default='ongoing')
    bookmark: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Topic(Base):
    __tablename__ = 'assistant_topics'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=2)
    title: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(16))
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    text: Mapped[str] = mapped_column(Text, default='')
    bindings: Mapped[list] = mapped_column(JSON, default=list)
    legacy_origin: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    context_revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceCommand(Base):
    __tablename__ = 'assistant_commands'
    __table_args__ = (UniqueConstraint('course_id', 'command_id', name='uq_workspace_command'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id', ondelete='CASCADE'), index=True)
    command_id: Mapped[str] = mapped_column(String(100))
    payload_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
