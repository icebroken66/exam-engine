"""Shared session access, concurrency checks, events and evidence citations.

This module depends only on persistence models, never session orchestration.
Callers own commits and rollbacks. Reads retain their existing refresh/autoflush
semantics; recording an event only adds it to the caller's transaction.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import (
    DocumentNode, EvidenceBlock, LearningAttempt, LearningEvent,
    LearningSession, LearningTask, Source, TutoringTurn,
)


class LearningSessionError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def record_session_event(db: Session, session_id: str, kind: str, task_id: str | None = None, **payload: object) -> None:
    db.add(LearningEvent(
        session_id=session_id,
        task_id=task_id,
        kind=kind,
        payload=payload,
        created_at=datetime.now(timezone.utc),
    ))


def get_latest_attempt(db: Session, task_id: str) -> LearningAttempt | None:
    return db.scalar(
        select(LearningAttempt)
        .where(LearningAttempt.task_id == task_id)
        .order_by(LearningAttempt.attempt_number.desc())
        .limit(1)
    )


def get_learning_session(db: Session, session_id: str) -> LearningSession:
    session = db.get(LearningSession, session_id)
    if session is None:
        raise LearningSessionError(404, "学习会话不存在")
    return session


def get_current_task(db: Session, session: LearningSession) -> LearningTask:
    if session.current_task_id is None:
        raise LearningSessionError(409, "当前没有可作答的学习任务")
    task = db.get(LearningTask, session.current_task_id)
    if task is None or task.session_id != session.id:
        raise LearningSessionError(409, "当前学习任务不可用")
    return task


def get_progress_version(db: Session, session: LearningSession) -> str:
    latest = get_latest_attempt(db, session.current_task_id) if session.current_task_id else None
    if latest is not None:
        db.refresh(latest)
    hints = db.scalar(select(func.count(LearningEvent.id)).where(
        LearningEvent.task_id == session.current_task_id, LearningEvent.kind == "hint_requested",
    )) or 0
    dialogue = list(db.execute(select(TutoringTurn.id, TutoringTurn.sequence, TutoringTurn.status).where(
        TutoringTurn.task_id == session.current_task_id).order_by(TutoringTurn.sequence)).all())
    state = [session.id, session.current_task_id, session.stage, hints, [list(row) for row in dialogue],
             {column.key: getattr(latest, column.key) for column in LearningAttempt.__table__.columns} if latest else None]
    return sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()


def assert_no_running_tutoring(db: Session, session: LearningSession) -> None:
    if db.scalar(select(TutoringTurn.id).where(TutoringTurn.task_id == session.current_task_id, TutoringTurn.status == "running").limit(1)):
        raise LearningSessionError(409, "当前题带学仍在生成，请先读取带学记录再作答或推进")


def assert_session_progress(db: Session, session: LearningSession, task_id: str | None, version: str | None) -> None:
    # Model calls commit their usage while waiting; re-read before using a result.
    db.refresh(session)
    if (task_id is not None and task_id != session.current_task_id) or (
        version is not None and version != get_progress_version(db, session)
    ):
        raise LearningSessionError(409, "学习进度已变化，本次操作未应用；请读取最新进度后继续，原作答草稿保留")


def read_evidence_citations(db: Session, evidence_ids: list[str]) -> list[dict]:
    if not evidence_ids:
        return []
    rows = db.execute(
        select(EvidenceBlock, Source, DocumentNode.title)
        .join(Source, EvidenceBlock.source_id == Source.id)
        .join(DocumentNode, EvidenceBlock.node_id == DocumentNode.id)
        .where(EvidenceBlock.id.in_(evidence_ids))
    ).all()
    by_id = {
        block.id: {
            "evidence_id": block.id,
            "source_id": source.id,
            "source_name": source.original_name,
            "source_removed": source.removed_at is not None,
            "node_title": node_title,
            "page_number": block.page_number,
            "excerpt": block.text[:800],
        }
        for block, source, node_title in rows
    }
    return [by_id[evidence_id] for evidence_id in evidence_ids if evidence_id in by_id]

