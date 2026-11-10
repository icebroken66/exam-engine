"""Read-only session/history projection; never plans, grades or calls a model."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .session_access import (
    get_current_task, get_latest_attempt, get_learning_session, get_progress_version,
    read_evidence_citations,
)
from .source_lifecycle import task_uses_removed_source
from .models import LearningAttempt, LearningEvent, LearningPointState, LearningTask
from .course_context import (
    is_semantic_topic, course_candidates, diagnostic_target as calculate_diagnostic_target,
)


def read_attempt(db: Session, attempt: LearningAttempt) -> dict:
    result = {column.key: getattr(attempt, column.key) for column in LearningAttempt.__table__.columns}
    result["review_history"] = [
            {"id": event.id, "created_at": event.created_at, **event.payload}
            for event in db.scalars(select(LearningEvent).where(
                LearningEvent.task_id == attempt.task_id, LearningEvent.kind == "grade_reviewed",
            ).order_by(LearningEvent.created_at, LearningEvent.id)).all()
            if event.payload.get("attempt_id") == attempt.id
    ]
    return result


def read_task(db: Session, task: LearningTask) -> dict:
    latest = get_latest_attempt(db, task.id)
    graded = latest is not None and latest.verdict != "ungraded"
    attempt_read = read_attempt(db, latest) if latest is not None else None
    return {
        "id": task.id,
        "kind": task.kind,
        "ordinal": task.ordinal,
        "knowledge_point": task.knowledge_point,
        "sub_skill": task.sub_skill or task.knowledge_point,
        "cognitive_level": task.cognitive_level,
        "difficulty_prior": task.difficulty_prior,
        "question_type": task.question_type,
        "stem": task.stem,
        "options": task.options,
        "provenance": task.provenance,
        "origin_question_id": task.origin_question_id,
        "answer_provenance": task.answer_provenance,
        "source_track": task.source_track,
        "visible_limitation": task.visible_limitation,
        "source_removed": task_uses_removed_source(db, task),
        "help_exposures": int(db.scalar(select(func.count(LearningEvent.id)).where(LearningEvent.task_id == task.id, LearningEvent.kind == "hint_requested")) or 0),
        "rubric": (task.rubric or []) if graded else [],
        "prerequisites": task.prerequisites or [],
        "validation_status": task.validation_status,
        "validation_confidence": task.validation_confidence,
        "decision_reason": task.decision_reason,
        "reference_answer": task.reference_answer if graded else None,
        "study_answer": task.remediation_answer if graded else None,
        "analysis": task.analysis if graded else None,
        "citations": read_evidence_citations(db, task.evidence_ids) if graded else [],
        "latest_attempt": attempt_read,
    }


def diagnosed_topics(db: Session, session_id: str) -> set[str]:
    valid = set()
    for task in db.scalars(select(LearningTask).where(
        LearningTask.session_id == session_id, LearningTask.kind == "diagnostic", LearningTask.status == "answered",
    )).all():
        latest = get_latest_attempt(db, task.id)
        if not task_uses_removed_source(db, task) and is_semantic_topic(task.knowledge_point) and latest is not None and latest.verdict != "ungraded":
            valid.add(task.knowledge_point)
    return valid


def read_learning_session(db: Session, session_id: str) -> dict:
    session = get_learning_session(db, session_id)
    task = get_current_task(db, session) if session.current_task_id else None
    latest = get_latest_attempt(db, task.id) if task else None
    diagnostic_total = int(db.scalar(
        select(func.count(LearningTask.id)).where(
            LearningTask.session_id == session.id,
            LearningTask.kind == "diagnostic",
        )
    ) or 0)
    diagnostic_completed = len(diagnosed_topics(db, session.id))
    diagnostic_target = calculate_diagnostic_target(course_candidates(db, session.course_id))
    passed = {"practice": 0, "retest": 0}
    for item in db.scalars(select(LearningTask).where(
        LearningTask.session_id == session.id, LearningTask.kind.in_(list(passed)),
    )).all():
        last = get_latest_attempt(db, item.id)
        if last is not None and last.verdict == "correct" and (item.kind != "retest" or last.hints_used == 0):
            passed[item.kind] += 1
    practice_completed, retest_passed = passed["practice"], passed["retest"]
    points = [
        point for point in db.scalars(
            select(LearningPointState)
            .where(LearningPointState.session_id == session.id)
            .order_by(LearningPointState.score.asc(), LearningPointState.knowledge_point)
        ).all()
        if is_semantic_topic(point.knowledge_point)
    ]
    events = list(db.scalars(
        select(LearningEvent)
        .where(LearningEvent.session_id == session.id)
        .order_by(LearningEvent.created_at.desc())
        .limit(10)
    ).all())
    events.reverse()
    if session.stage == "completed":
        message = "本轮学习已完成。每次下一步都由最新资料与作答证据决定，后续仍需间隔复习。"
        action = "开始新一轮诊断"
    elif task and task_uses_removed_source(db, task):
        message = "这道题引用的资料已从课程移除。已有记录保留，后续将依据剩余有效资料重新安排。"
        action = "依据剩余资料重新安排"
    elif session.stage == "blocked":
        message = "当前行动被资料、模型或判分问题阻塞。已有作答已保存，不会用低质量模板题继续。"
        action = "恢复当前学习任务"
    elif session.stage == "remediating" and task:
        message = f"Agent 根据本次作答选择先补“{task.knowledge_point}”，随后会生成新的同类练习。"
        action = "开始针对性练习"
    elif latest and latest.verdict == "ungraded":
        message = "判分置信度不足，没有更新为确定掌握。请补充作答依据后重试。"
        action = "补充答案后重新提交"
    elif latest:
        message = "作答与判分证据已保存。点击下一步后，Agent 会重新读取最新资料与学习状态，再生成行动。"
        action = "让 Agent 决定下一步"
    elif task:
        message = task.decision_reason or "这道题针对当前诊断蓝图，请先独立作答。"
        action = "独立作答后提交"
    else:
        message = "Agent 正在准备下一步。"
        action = "等待下一步"
    return {
        "id": session.id,
        "progress_version": get_progress_version(db, session),
        "course_id": session.course_id,
        "stage": session.stage,
        "knowledge_mode": session.knowledge_mode,
        "scope_text": session.scope_text,
        "visible_limitation": "所有新题均锚定当前课程证据；覆盖范围与历史题型限制以课程准备页为准。",
        "current_task": read_task(db, task) if task else None,
        "diagnostic_total": diagnostic_total,
        "diagnostic_completed": diagnostic_completed,
        "diagnostic_target": diagnostic_target,
        "practice_completed": practice_completed,
        "retest_passed": retest_passed,
        "points": points,
        "recent_events": events,
        "agent_message": message,
        "next_action": action,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


def read_session_history(db: Session, session_id: str) -> dict:
    session = get_learning_session(db, session_id)
    tasks = db.scalars(select(LearningTask).where(LearningTask.session_id == session.id).order_by(LearningTask.ordinal)).all()
    return {"session": read_learning_session(db, session.id), "tasks": [
        {"task": read_task(db, task), "attempts": [
            read_attempt(db, attempt) for attempt in db.scalars(select(LearningAttempt).where(
                LearningAttempt.task_id == task.id,
            ).order_by(LearningAttempt.attempt_number)).all()
        ]} for task in tasks
    ]}
