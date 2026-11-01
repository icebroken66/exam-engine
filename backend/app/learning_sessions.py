from datetime import datetime, timezone
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .learning import accept_model_grade, compute_mastery, grade_exact
from .model_gateway import ModelError, ModelGateway
from .models import (
    Course, DocumentNode, EvidenceBlock, LearningAttempt, LearningEvent, LearningPointState,
    LearningSession, LearningTask, Question, QuestionEvidence, Source,
)
from .schemas import LearningGradeContent


ACTIVE_STAGES = {"diagnosing", "practicing", "retesting"}


class LearningSessionError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _event(db: Session, session_id: str, kind: str, task_id: str | None = None, **payload: object) -> None:
    db.add(LearningEvent(
        session_id=session_id,
        task_id=task_id,
        kind=kind,
        payload=payload,
        created_at=datetime.now(timezone.utc),
    ))


def _latest_attempt(db: Session, task_id: str) -> LearningAttempt | None:
    return db.scalar(
        select(LearningAttempt)
        .where(LearningAttempt.task_id == task_id)
        .order_by(LearningAttempt.attempt_number.desc())
        .limit(1)
    )


def _session(db: Session, session_id: str) -> LearningSession:
    session = db.get(LearningSession, session_id)
    if session is None:
        raise LearningSessionError(404, "学习会话不存在")
    return session


def _current_task(db: Session, session: LearningSession) -> LearningTask:
    if session.current_task_id is None:
        raise LearningSessionError(409, "当前没有可作答的学习任务")
    task = db.get(LearningTask, session.current_task_id)
    if task is None or task.session_id != session.id:
        raise LearningSessionError(409, "当前学习任务不可用")
    return task


def _citations(db: Session, evidence_ids: list[str]) -> list[dict]:
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
            "node_title": node_title,
            "page_number": block.page_number,
            "excerpt": block.text[:800],
        }
        for block, source, node_title in rows
    }
    return [by_id[evidence_id] for evidence_id in evidence_ids if evidence_id in by_id]


def _task_read(db: Session, task: LearningTask) -> dict:
    latest = _latest_attempt(db, task.id)
    graded = latest is not None and latest.verdict != "ungraded"
    return {
        "id": task.id,
        "kind": task.kind,
        "ordinal": task.ordinal,
        "knowledge_point": task.knowledge_point,
        "question_type": task.question_type,
        "stem": task.stem,
        "options": task.options,
        "provenance": task.provenance,
        "reference_answer": task.reference_answer if graded else None,
        "study_answer": task.remediation_answer if graded else None,
        "analysis": task.analysis if graded else None,
        "citations": _citations(db, task.evidence_ids) if graded else [],
        "latest_attempt": latest,
    }


def read_learning_session(db: Session, session_id: str) -> dict:
    session = _session(db, session_id)
    task = _current_task(db, session) if session.current_task_id else None
    latest = _latest_attempt(db, task.id) if task else None
    diagnostic_total = int(db.scalar(
        select(func.count(LearningTask.id)).where(
            LearningTask.session_id == session.id,
            LearningTask.kind == "diagnostic",
        )
    ) or 0)
    diagnostic_completed = int(db.scalar(
        select(func.count(LearningTask.id)).where(
            LearningTask.session_id == session.id,
            LearningTask.kind == "diagnostic",
            LearningTask.status == "answered",
        )
    ) or 0)
    practice_completed = int(db.scalar(
        select(func.count(func.distinct(LearningTask.id)))
        .join(LearningAttempt, LearningAttempt.task_id == LearningTask.id)
        .where(
            LearningTask.session_id == session.id,
            LearningTask.kind == "practice",
            LearningAttempt.verdict == "correct",
        )
    ) or 0)
    retest_passed = int(db.scalar(
        select(func.count(func.distinct(LearningTask.id)))
        .join(LearningAttempt, LearningAttempt.task_id == LearningTask.id)
        .where(
            LearningTask.session_id == session.id,
            LearningTask.kind == "retest",
            LearningAttempt.verdict == "correct",
        )
    ) or 0)
    points = list(db.scalars(
        select(LearningPointState)
        .where(LearningPointState.session_id == session.id)
        .order_by(LearningPointState.score.asc(), LearningPointState.knowledge_point)
    ).all())
    events = list(db.scalars(
        select(LearningEvent)
        .where(LearningEvent.session_id == session.id)
        .order_by(LearningEvent.created_at.desc())
        .limit(8)
    ).all())
    events.reverse()

    if session.stage == "completed":
        message = "本次独立重测已通过。学习计划已更新，但一次重测不等于永久掌握，后续仍应间隔复习。"
        action = "复盘本次学习证据"
    elif session.stage == "blocked":
        message = "当前学习行动被资料、模型或判分问题阻塞。你的作答已经保存，可以恢复后继续。"
        action = "恢复当前学习任务"
    elif session.stage == "remediating" and task:
        message = f"诊断依据显示“{task.knowledge_point}”是当前最值得补的薄弱点。先看针对性提示，再做一道同类练习。"
        action = "开始同类练习"
    elif latest and latest.verdict == "ungraded":
        message = "这次判分置信度不足，没有更新为确定掌握。请补充作答依据后重试。"
        action = "补充答案后重新提交"
    elif latest and session.stage == "diagnosing":
        message = "作答与判分证据已保存。Agent 会完成短诊断后，再决定最需要补的内容。"
        action = "分析诊断结果" if diagnostic_completed == diagnostic_total else "进入下一道诊断题"
    elif latest and session.stage == "practicing":
        message = "同类练习已完成。只有接下来不看解析、独立做对重测，才会记录为重测通过。"
        action = "进入独立重测" if latest.verdict == "correct" else "根据反馈继续补缺"
    elif latest and session.stage == "retesting":
        message = "重测结果已保存。Agent 会依据独立作答更新状态，而不是依据是否看过讲解。"
        action = "更新学习状态" if latest.verdict == "correct" else "回到针对性补缺"
    elif task:
        labels = {"diagnosing": "短诊断", "practicing": "同类练习", "retesting": "独立重测"}
        message = f"现在是{labels.get(session.stage, '学习')}时间。请先独立作答，不要先看参考答案。"
        action = "独立作答后提交"
    else:
        message = "Agent 正在准备下一步学习行动。"
        action = "等待下一步"
    return {
        "id": session.id,
        "course_id": session.course_id,
        "stage": session.stage,
        "current_task": _task_read(db, task) if task else None,
        "diagnostic_total": diagnostic_total,
        "diagnostic_completed": diagnostic_completed,
        "practice_completed": practice_completed,
        "retest_passed": retest_passed,
        "points": points,
        "recent_events": events,
        "agent_message": message,
        "next_action": action,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


def _question_candidates(db: Session, course_id: str) -> list[dict]:
    questions = list(db.scalars(
        select(Question)
        .where(Question.course_id == course_id, Question.status == "verified", Question.provenance == "original")
        .order_by(Question.created_at.asc())
    ).all())
    candidates = []
    for question in questions:
        evidence_ids = list(db.scalars(
            select(QuestionEvidence.evidence_id)
            .where(QuestionEvidence.question_id == question.id)
            .order_by(QuestionEvidence.ordinal)
        ).all())
        if not evidence_ids:
            continue
        candidates.append({
            "knowledge_point": question.knowledge_points[0],
            "stem": question.stem,
            "answer": question.answer,
            "analysis": question.analysis,
            "evidence_ids": evidence_ids,
            "provenance": "original",
        })
    return candidates


def _evidence_candidates(db: Session, course_id: str) -> list[dict]:
    rows = db.execute(
        select(EvidenceBlock, DocumentNode.title)
        .join(Source, EvidenceBlock.source_id == Source.id)
        .join(DocumentNode, EvidenceBlock.node_id == DocumentNode.id)
        .where(
            Source.course_id == course_id,
            Source.status.in_(["ready", "needs_review"]),
        )
        .order_by(Source.created_at.asc(), EvidenceBlock.ordinal.asc())
    ).all()
    candidates = []
    for block, node_title in rows:
        text = block.text.strip()
        if text.startswith("#") or len(text) < 12:
            continue
        candidates.append({
            "knowledge_point": node_title,
            "stem": f"根据课程资料，解释“{node_title}”的核心内容。",
            "answer": text,
            "analysis": "回答应紧扣课程原文，说明核心条件与结论之间的关系。",
            "evidence_ids": [block.id],
            "provenance": "generated",
        })
    return candidates


def _new_task(session_id: str, kind: str, ordinal: int, **content: object) -> LearningTask:
    content.setdefault("remediation_answer", content["reference_answer"])
    return LearningTask(session_id=session_id, kind=kind, ordinal=ordinal, status="pending", **content)


def create_or_resume_session(db: Session, course_id: str, restart: bool = False) -> dict:
    if db.get(Course, course_id) is None:
        raise LearningSessionError(404, "课程不存在")
    existing = db.scalar(
        select(LearningSession)
        .where(LearningSession.course_id == course_id)
        .order_by(LearningSession.updated_at.desc())
        .limit(1)
    )
    if existing and not restart:
        return read_learning_session(db, existing.id)
    if existing and existing.stage != "completed":
        raise LearningSessionError(409, "当前学习尚未完成，不能另起会话")

    candidates = _question_candidates(db, course_id)
    evidence_candidates = _evidence_candidates(db, course_id)
    if not candidates and not evidence_candidates:
        raise LearningSessionError(409, "Agent 缺少课程上下文：请先上传并解析至少一份课程资料")
    pool = candidates + evidence_candidates
    while len(pool) < 3:
        pool.append(pool[0])

    session = LearningSession(course_id=course_id, stage="diagnosing")
    db.add(session)
    db.flush()
    first = pool[0]
    statement = re.split(r"(?<=[。！？])", first["answer"].strip(), maxsplit=1)[0]
    objective = _new_task(
        session.id,
        "diagnostic",
        1,
        knowledge_point=first["knowledge_point"],
        question_type="true_false",
        stem=f"判断题：{statement}",
        options=["正确", "错误"],
        reference_answer="正确",
        remediation_answer=first["answer"],
        analysis=first["analysis"],
        evidence_ids=first["evidence_ids"],
        provenance="generated",
    )
    db.add(objective)
    for index, candidate in enumerate(pool[1:3], start=2):
        db.add(_new_task(
            session.id,
            "diagnostic",
            index,
            knowledge_point=candidate["knowledge_point"],
            question_type="short_answer",
            stem=candidate["stem"],
            options=[],
            reference_answer=candidate["answer"],
            analysis=candidate["analysis"],
            evidence_ids=candidate["evidence_ids"],
            provenance=candidate["provenance"],
        ))
    db.flush()
    objective.status = "current"
    session.current_task_id = objective.id
    _event(db, session.id, "session_created", course_id=course_id)
    _event(
        db,
        session.id,
        "diagnostic_started",
        objective.id,
        question_count=3,
        reason="先用三道题建立最小学习状态，不要求学生先整理题库",
    )
    db.commit()
    return read_learning_session(db, session.id)


def _update_point_state(db: Session, attempt: LearningAttempt, task: LearningTask) -> None:
    attempts = list(db.scalars(
        select(LearningAttempt)
        .join(LearningTask, LearningAttempt.task_id == LearningTask.id)
        .where(
            LearningAttempt.session_id == attempt.session_id,
            LearningTask.knowledge_point == task.knowledge_point,
        )
        .order_by(LearningAttempt.created_at.asc(), LearningAttempt.attempt_number.asc())
    ).all())
    mastery = compute_mastery(item.verdict == "correct" for item in attempts if item.verdict != "ungraded")
    if attempt.verdict == "ungraded":
        status = "needs_review"
    elif mastery.mastered:
        status = "mastered"
    elif attempt.verdict == "incorrect" or (
        task.kind == "diagnostic" and any(item.verdict == "incorrect" for item in attempts)
    ):
        status = "weak"
    elif task.kind == "retest" and attempt.verdict == "correct":
        status = "retest_passed"
    else:
        status = "learning"
    state = db.scalar(
        select(LearningPointState).where(
            LearningPointState.session_id == attempt.session_id,
            LearningPointState.knowledge_point == task.knowledge_point,
        )
    )
    if state is None:
        state = LearningPointState(session_id=attempt.session_id, knowledge_point=task.knowledge_point)
        db.add(state)
    state.status = status
    state.score = mastery.score
    state.evidence_count = mastery.evidence_count
    state.last_attempt_id = attempt.id
    state.updated_at = datetime.now(timezone.utc)


def submit_attempt(
    db: Session,
    session_id: str,
    answer: str,
    duration_seconds: int,
    gateway: ModelGateway,
) -> dict:
    session = _session(db, session_id)
    task = _current_task(db, session)
    if session.stage not in ACTIVE_STAGES | {"blocked"}:
        raise LearningSessionError(409, "当前阶段不能提交作答，请先执行 Agent 给出的下一步")
    latest = _latest_attempt(db, task.id)
    if latest and latest.verdict != "ungraded" and session.stage != "blocked":
        raise LearningSessionError(409, "本次作答已经判分，请进入 Agent 给出的下一步")
    session.stage = {"diagnostic": "diagnosing", "practice": "practicing", "retest": "retesting"}[task.kind]
    attempt_number = int(db.scalar(
        select(func.count(LearningAttempt.id)).where(LearningAttempt.task_id == task.id)
    ) or 0) + 1
    hints_used = int(db.scalar(
        select(func.count(LearningEvent.id)).where(
            LearningEvent.task_id == task.id,
            LearningEvent.kind == "hint_requested",
        )
    ) or 0)

    if task.question_type in {"single_choice", "multiple_choice", "true_false"}:
        accepted = ("对", "是", "true", "1") if task.reference_answer == "正确" else ("错", "否", "false", "0")
        correct = grade_exact(answer, task.reference_answer, accepted)
        verdict = "correct" if correct else "incorrect"
        confidence = 1.0
        feedback = "回答正确。判分依据是确定性答案匹配。" if correct else "回答不正确。Agent 会把这一结果纳入薄弱点判断。"
        missing_points = [] if correct else [task.analysis]
        grading_layer = "deterministic"
        provider = "deterministic"
        model = "exact-match-v1"
        mocked = False
        usage_id = None
    else:
        evidence = "\n\n".join(
            block.text for block in db.scalars(
                select(EvidenceBlock).where(EvidenceBlock.id.in_(task.evidence_ids))
            ).all()
        )
        system_prompt = (
            "你是严谨的课程判分助手。依据题目、参考答案和课程原文判断学生答案。"
            "只输出 JSON：is_correct 为布尔值，confidence 为 0 到 1，feedback 为针对性中文反馈，"
            "missing_points 为最多 6 条缺失要点。等价表述可以判对；关键条件缺失或矛盾应判错。"
            "无法确定时 confidence 必须低于 0.8。不要自行编造评分依据。"
        )
        user_prompt = (
            f"<grading><question>{task.stem}</question>\n"
            f"<reference_answer>{task.reference_answer}</reference_answer>\n"
            f"<student_answer>{answer}</student_answer>\n"
            f"<evidence>{evidence}</evidence></grading>"
        )
        try:
            content, usage = gateway.generate_json(
                db,
                session.course_id,
                "open_answer_grading",
                system_prompt,
                user_prompt,
                LearningGradeContent,
                max_tokens=600,
            )
        except ModelError as error:
            attempt = LearningAttempt(
                session_id=session.id,
                task_id=task.id,
                attempt_number=attempt_number,
                answer=answer,
                verdict="ungraded",
                grading_layer="model_error",
                confidence=None,
                feedback="模型判分失败，作答已保存，尚未更新掌握状态。",
                missing_points=[],
                hints_used=hints_used,
                duration_seconds=duration_seconds,
                provider=gateway.provider.name,
                model=gateway.provider.model,
                mocked=gateway.provider.mocked,
            )
            db.add(attempt)
            task.status = "answered"
            session.stage = "blocked"
            _event(db, session.id, "grading_failed", task.id, error=error.message)
            db.commit()
            raise LearningSessionError(error.status_code, error.message) from error
        verdict = accept_model_grade(content.confidence, content.is_correct)
        confidence = content.confidence
        feedback = content.feedback
        missing_points = content.missing_points
        if verdict == "ungraded":
            feedback = f"{feedback} 判分置信度不足，请补充关键依据后重试。"
        grading_layer = "evidence_model"
        provider = gateway.provider.name
        model = gateway.provider.model
        mocked = gateway.provider.mocked
        usage_id = usage.id

    attempt = LearningAttempt(
        session_id=session.id,
        task_id=task.id,
        attempt_number=attempt_number,
        answer=answer,
        verdict=verdict,
        grading_layer=grading_layer,
        confidence=confidence,
        feedback=feedback,
        missing_points=missing_points,
        hints_used=hints_used,
        duration_seconds=duration_seconds,
        provider=provider,
        model=model,
        mocked=mocked,
        usage_id=usage_id,
    )
    db.add(attempt)
    task.status = "answered"
    db.flush()
    _update_point_state(db, attempt, task)
    _event(
        db,
        session.id,
        "attempt_graded",
        task.id,
        attempt_id=attempt.id,
        verdict=verdict,
        confidence=confidence,
        hints_used=hints_used,
    )
    db.commit()
    return read_learning_session(db, session.id)


def _create_followup(db: Session, session: LearningSession, base: LearningTask, kind: str) -> LearningTask:
    ordinal = int(db.scalar(
        select(func.count(LearningTask.id)).where(LearningTask.session_id == session.id)
    ) or 0) + 1
    if kind == "practice":
        stem = (
            f"同类练习：针对“{base.knowledge_point}”，请说明核心规则，"
            "并指出结论成立时最容易被忽略的条件。"
        )
    else:
        stem = (
            f"独立重测：不看刚才的解析，请用自己的话概括“{base.knowledge_point}”，"
            "并核对其成立所需的全部条件。"
        )
    task = _new_task(
        session.id,
        kind,
        ordinal,
        knowledge_point=base.knowledge_point,
        question_type="short_answer",
        stem=stem,
        options=[],
        reference_answer=base.remediation_answer,
        analysis=base.analysis,
        evidence_ids=base.evidence_ids,
        provenance="generated",
    )
    task.status = "current"
    db.add(task)
    db.flush()
    session.current_task_id = task.id
    session.stage = "practicing" if kind == "practice" else "retesting"
    _event(
        db,
        session.id,
        "practice_assigned" if kind == "practice" else "retest_scheduled",
        task.id,
        knowledge_point=task.knowledge_point,
        reason="依据前一次真实作答安排，而不是按固定内容顺序播放",
    )
    return task


def advance_session(db: Session, session_id: str) -> dict:
    session = _session(db, session_id)
    if session.stage == "completed":
        return read_learning_session(db, session.id)
    task = _current_task(db, session)
    latest = _latest_attempt(db, task.id)
    if session.stage == "blocked":
        session.stage = {"diagnostic": "diagnosing", "practice": "practicing", "retest": "retesting"}[task.kind]
        _event(db, session.id, "session_resumed", task.id)
    elif session.stage == "diagnosing":
        if latest is None:
            raise LearningSessionError(409, "请先提交当前题目的独立作答")
        next_task = db.scalar(
            select(LearningTask)
            .where(
                LearningTask.session_id == session.id,
                LearningTask.kind == "diagnostic",
                LearningTask.status == "pending",
                LearningTask.ordinal > task.ordinal,
            )
            .order_by(LearningTask.ordinal)
            .limit(1)
        )
        if next_task:
            next_task.status = "current"
            session.current_task_id = next_task.id
            _event(db, session.id, "diagnostic_advanced", next_task.id)
        else:
            diagnostics = list(db.scalars(
                select(LearningTask)
                .where(LearningTask.session_id == session.id, LearningTask.kind == "diagnostic")
                .order_by(LearningTask.ordinal)
            ).all())
            weak = next(
                (item for item in diagnostics if (attempt := _latest_attempt(db, item.id)) and attempt.verdict == "incorrect"),
                None,
            )
            if weak:
                session.current_task_id = weak.id
                session.stage = "remediating"
                _event(
                    db,
                    session.id,
                    "weakness_identified",
                    weak.id,
                    knowledge_point=weak.knowledge_point,
                    reason="该考点存在真实错误作答，优先于已答对内容",
                )
            elif any(
                (attempt := _latest_attempt(db, item.id)) and attempt.verdict == "ungraded"
                for item in diagnostics
            ):
                session.stage = "diagnosing"
            else:
                _create_followup(db, session, diagnostics[0], "retest")
    elif session.stage == "remediating":
        _create_followup(db, session, task, "practice")
    elif session.stage == "practicing":
        if latest is None:
            raise LearningSessionError(409, "请先完成同类练习")
        if latest.verdict == "correct":
            _create_followup(db, session, task, "retest")
        elif latest.verdict == "incorrect":
            session.stage = "remediating"
            _event(db, session.id, "remediation_repeated", task.id, knowledge_point=task.knowledge_point)
    elif session.stage == "retesting":
        if latest is None:
            raise LearningSessionError(409, "请先完成独立重测")
        if latest.verdict == "correct":
            session.stage = "completed"
            session.current_task_id = None
            _event(
                db,
                session.id,
                "retest_passed",
                task.id,
                knowledge_point=task.knowledge_point,
                next_step="保留间隔复习，继续下一薄弱点",
            )
            _event(
                db,
                session.id,
                "plan_updated",
                reason="重测依据真实独立作答，下一阶段减少已验证内容的重复",
            )
        elif latest.verdict == "incorrect":
            session.stage = "remediating"
            _event(db, session.id, "retest_failed", task.id, knowledge_point=task.knowledge_point)
    session.updated_at = datetime.now(timezone.utc)
    db.commit()
    return read_learning_session(db, session.id)


def request_hint(db: Session, session_id: str) -> dict:
    session = _session(db, session_id)
    task = _current_task(db, session)
    if session.stage not in ACTIVE_STAGES | {"remediating", "blocked"}:
        raise LearningSessionError(409, "当前阶段不能请求提示")
    hint = task.analysis or "先找出题目要求的结论与成立条件，再逐项对照课程原文。"
    _event(db, session.id, "hint_requested", task.id, knowledge_point=task.knowledge_point)
    db.commit()
    return {"hint": hint, "session": read_learning_session(db, session.id)}
