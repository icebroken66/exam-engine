"""Read effective past attempts without copying grades or mastery into a new round."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Course, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, Source


def course_learning_evidence(db: Session, course_id: str, *, page: int = 1, page_size: int | None = 20,
                             exclude_session_id: str | None = None, now: datetime | None = None) -> dict | None:
    if db.get(Course, course_id) is None:
        return None
    # Import here: session planning also consumes this read-only projection.
    from .learning_sessions import _course_signature
    from .source_lifecycle import task_uses_removed_source

    current_version = _course_signature(db, course_id)
    now = now or datetime.now(timezone.utc)
    rows = db.execute(select(LearningAttempt, LearningTask).join(
        LearningTask, LearningAttempt.task_id == LearningTask.id,
    ).join(LearningSession, LearningSession.id == LearningTask.session_id).where(
        LearningSession.course_id == course_id,
        LearningAttempt.session_id == LearningTask.session_id,
    ).order_by(LearningAttempt.created_at.desc(), LearningAttempt.attempt_number.desc(), LearningAttempt.id)).all()
    latest = {}
    for attempt, task in rows:
        if task.session_id == exclude_session_id:
            continue
        if task.id not in latest or attempt.attempt_number > latest[task.id][0].attempt_number:
            latest[task.id] = (attempt, task)
    blocks = {b.id: (b, s) for b, s in db.execute(select(EvidenceBlock, Source).join(
        Source, Source.id == EvidenceBlock.source_id,
    ).where(Source.course_id == course_id)).all()}
    items = []
    for attempt, task in latest.values():
        reason = ""
        if task_uses_removed_source(db, task):
            reason = "引用来源已移除或原题已不可用"
        elif not task.evidence_ids or any(e not in blocks for e in task.evidence_ids):
            reason = "来源证据缺失或不属于本课程"
        elif any(blocks[e][1].status not in {"ready", "needs_review"} for e in task.evidence_ids):
            reason = "来源尚未可用或转录尚未确认"
        elif not task.evidence_version:
            reason = "旧记录没有可核对的资料版本"
        elif task.evidence_version != current_version:
            reason = "课程资料或题库版本已变化，需重新核对"
        elif task.validation_status != "validated":
            reason = "题目尚未通过质量验收"
        elif attempt.mocked:
            reason = "模拟判分不作为学习证据"
        elif attempt.verdict == "ungraded":
            reason = "最新作答尚未有效判分"
        elif attempt.grading_layer != "human_correction" and (
            attempt.confidence is None or attempt.confidence < 0.8
        ):
            reason = "判分置信度不足"
        taken_at = attempt.created_at
        if taken_at.tzinfo is None:
            taken_at = taken_at.replace(tzinfo=timezone.utc)
        due_at = None
        if reason:
            recommendation, explanation = "needs_review", reason
        elif attempt.verdict == "incorrect":
            recommendation, explanation = "repair", "最近有效作答未通过，先处理缺失要点"
        elif attempt.hints_used:
            recommendation, explanation = "without_help", "曾接受帮助，需要换题撤提示检查"
        else:
            due_at = taken_at + timedelta(days=1)
            recommendation = "due" if now >= due_at else "later"
            explanation = "距作答已满24小时，可用未见题检查保持" if recommendation == "due" else "本次无提示答对，建议满24小时后用未见题复测"
        items.append(dict(
            session_id=task.session_id, task_id=task.id, attempt_id=attempt.id,
            knowledge_point=task.knowledge_point, sub_skill=task.sub_skill, kind=task.kind,
            verdict=attempt.verdict, hints_used=attempt.hints_used, taken_at=taken_at,
            grading_layer=attempt.grading_layer, evidence_version=task.evidence_version,
            usable=not reason, exclusion_reason=reason, recommendation=recommendation,
            explanation=explanation, due_at=due_at,
        ))
    items.sort(key=lambda item: (item["taken_at"], item["attempt_id"]), reverse=True)
    return dict(course_id=course_id, current_version=current_version, total=len(items),
                usable_count=sum(i["usable"] for i in items), excluded_count=sum(not i["usable"] for i in items),
                due_count=sum(i["recommendation"] == "due" for i in items), page=page, page_size=page_size or len(items),
                items=items if page_size is None else items[(page - 1) * page_size:page * page_size],
                limitation="按每题最新作答回看；同名考点不保证同一能力。24小时为简单复测建议，不是记忆模型；未继承掌握。资料版本变化时保守暂停复用。")


def prior_learning_context(db: Session, course_id: str, topics: set[str], exclude_session_id: str | None = None) -> dict:
    # Bound the model context, but compute validity before selecting these rows.
    report = course_learning_evidence(db, course_id, page_size=None, exclude_session_id=exclude_session_id)
    if report is None:
        return {"items": [], "excluded_count": 0, "omitted_count": 0}
    eligible = [i for i in report["items"] if i["usable"] and i["knowledge_point"] in topics]
    return dict(items=[{k: item[k] for k in (
        "session_id", "task_id", "attempt_id", "knowledge_point", "sub_skill", "verdict", "hints_used",
        "recommendation", "explanation",
    )} for item in eligible[:10]], excluded_count=report["excluded_count"], omitted_count=max(0, len(eligible) - 10))
