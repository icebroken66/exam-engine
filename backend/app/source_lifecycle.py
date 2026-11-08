"""Remove inputs from future learning while keeping immutable history readable."""

from hashlib import sha256
import json

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from .models import EvidenceBlock, LearningAttempt, LearningSession, LearningTask, ParseTask, Question, QuestionEvidence, Source, UsageRecord


def active_question():
    removed_sources = select(Source.id).where(Source.removed_at.is_not(None))
    removed_evidence = select(EvidenceBlock.id).where(EvidenceBlock.source_id.in_(removed_sources))
    return ~or_(
        Question.source_id.is_not(None) & Question.source_id.in_(removed_sources),
        exists(select(QuestionEvidence.id).where(
            QuestionEvidence.question_id == Question.id,
            QuestionEvidence.evidence_id.in_(removed_evidence),
        )),
    )


def task_uses_removed_source(db: Session, task: LearningTask) -> bool:
    if task.origin_question_id and db.scalar(select(Question.id).where(Question.id == task.origin_question_id, active_question())) is None:
        return True
    return db.scalar(select(EvidenceBlock.id).join(Source, Source.id == EvidenceBlock.source_id).where(
        EvidenceBlock.id.in_(task.evidence_ids), Source.removed_at.is_not(None),
    ).limit(1)) is not None


def removal_impact(db: Session, source: Source) -> dict:
    evidence_ids = list(db.scalars(select(EvidenceBlock.id).where(EvidenceBlock.source_id == source.id)).all())
    questions = list(db.execute(select(Question.id, Question.version).where(or_(
        Question.source_id == source.id,
        Question.id.in_(select(QuestionEvidence.question_id).where(QuestionEvidence.evidence_id.in_(evidence_ids))),
    ))).all())
    tasks = [task for task in db.scalars(select(LearningTask).join(LearningSession).where(
        LearningSession.course_id == source.course_id,
    )).all() if set(task.evidence_ids) & set(evidence_ids) or task.origin_question_id in {q.id for q in questions}]
    current_ids = set(db.scalars(select(LearningSession.current_task_id).where(LearningSession.course_id == source.course_id, LearningSession.stage != "completed")).all())
    pending = []
    for task in tasks:
        latest = db.scalar(select(LearningAttempt).where(LearningAttempt.task_id == task.id).order_by(LearningAttempt.created_at.desc()).limit(1))
        if task.id in current_ids and (latest is None or latest.verdict == "ungraded"):
            pending.append(task)
    busy = source.status == "running" or db.scalar(select(ParseTask.id).where(
        ParseTask.source_id == source.id, ParseTask.status == "running",
    ).limit(1)) is not None
    model_busy = db.scalar(select(UsageRecord.id).where(
        UsageRecord.course_id == source.course_id, UsageRecord.status == "running",
    ).limit(1)) is not None
    signature = sha256(json.dumps({
        "source": [source.id, source.status, str(source.removed_at)],
        "evidence": sorted(evidence_ids), "questions": sorted([list(q) for q in questions]),
        "tasks": sorted((t.id, t.status) for t in tasks), "pending": sorted(t.id for t in pending),
    }, sort_keys=True).encode()).hexdigest()
    return {
        "source_id": source.id, "source_name": source.original_name,
        "evidence_count": len(evidence_ids), "question_count": len(questions),
        "history_task_count": len(tasks) - len(pending), "pending_task_count": len(pending),
        "blocked_reason": "资料正在解析，请处理结束后再移除" if busy else
                          "课程有模型操作正在进行，请完成后再移除" if model_busy else "",
        "signature": signature, "removed": source.removed_at is not None,
    }


def restore_source(db: Session, source: Source) -> None:
    if source.removed_at is not None:
        source.removed_at = None
        # Ready results can be reused without reparsing or rewriting history.
        if source.status == "queued":
            source.status = "uploaded"
        db.flush()
