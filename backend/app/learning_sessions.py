"""Learning session planning and progression; domain work lives in explicit services."""
from datetime import datetime, timezone
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .session_access import (
    LearningSessionError, assert_no_running_tutoring, assert_session_progress,
    get_current_task, get_latest_attempt, get_learning_session, get_progress_version,
    record_session_event,
)
from .learning_evidence import prior_learning_context
from .model_gateway import ModelError, ModelGateway
from .source_lifecycle import task_uses_removed_source
from .models import (
    Course, LearningAttempt, LearningPointState, LearningSession, LearningTask, UsageRecord,
)
from .schemas import LearningPlanContent
from .course_context import (
    course_candidates, course_signature, diagnostic_target, is_semantic_topic,
    prepare_course_context,
)
from .learning_questions import create_learning_task
from .learning_reads import diagnosed_topics, read_learning_session, read_session_history
from .learning_grading import ACTIVE_STAGES, submit_attempt, correct_attempt, review_current_attempt


def _initial_plan(
    db: Session,
    course: Course,
    gateway: ModelGateway,
    candidates: list[dict],
) -> LearningPlanContent:
    original_topics = [item["knowledge_point"] for item in candidates if item["questions"]]
    topics = original_topics or [item["knowledge_point"] for item in candidates]
    system_prompt = (
        "你是复习 Agent 的首次诊断规划器。根据课程范围和可诊断主题，选择一个基础、核心、适合先诊断的主题。"
        "available_topics 在有真实原题时已限定为原题覆盖主题，确保首次诊断优先使用原题。"
        "不要按列表顺序或文件名选择，不要选择页脚、局部细节、课程行政信息或只有资料才支持的观点。"
        "topic_materials 标明每个主题有哪些资料类型；往年题可帮助识别实际考核方式，但不能代替概念证据。"
        "knowledge_point 必须原样来自 available_topics；action 必须是 diagnostic。"
        "sub_skill 要描述可观察能力，reason 要说明该主题为何适合作为首个学习证据。只输出规定 JSON。"
        "prior_learning是其他轮次的有效作答摘要，不是永久掌握。优先关注未通过、提示后成功或到期复测；"
        "有旧证据时在reason中说明具体依据，使用未见题或实质变式重新检查，不复制旧分数或免诊断。"
    )
    payload = {
        "scope": course.scope_text,
        "available_topics": topics,
        "topic_materials": {item["knowledge_point"]: item["material_types"] for item in candidates},
        "prior_learning": prior_learning_context(db, course.id, set(topics)),
    }
    try:
        plan, _ = gateway.generate_json(
            db, course.id, "initial_learning_plan", system_prompt,
            f"<initial_learning_plan>{json.dumps(payload, ensure_ascii=False)}</initial_learning_plan>",
            LearningPlanContent, max_tokens=1000,
        )
    except ModelError as error:
        raise LearningSessionError(error.status_code, f"首次诊断规划失败：{error.message}") from error
    if plan.action != "diagnostic" or plan.knowledge_point not in topics:
        raise LearningSessionError(502, "首次诊断规划没有返回有效资料主题，已停止执行")
    return plan


def create_or_resume_session(
    db: Session,
    course_id: str,
    restart: bool = False,
    gateway: ModelGateway | None = None,
) -> dict:
    course = db.get(Course, course_id)
    if course is None:
        raise LearningSessionError(404, "课程不存在")
    context = prepare_course_context(db, course_id, gateway)
    existing = db.scalar(
        select(LearningSession)
        .where(LearningSession.course_id == course_id)
        .order_by(LearningSession.created_at.desc(), LearningSession.id)
        .limit(1)
    )
    signature = course_signature(db, course.id)
    if existing and not restart:
        if existing.current_task_id is None and existing.stage != "completed":
            if db.scalar(select(UsageRecord.id).where(UsageRecord.course_id == course_id, UsageRecord.status == "running").limit(1)):
                raise LearningSessionError(409, "课程模型操作仍在进行，请稍后读取已保存进度")
            if gateway is None or not context["can_start"]:
                raise LearningSessionError(409, "请等待有效资料准备完成后重试当前轮次")
            progress = get_progress_version(db, existing)
            candidates = course_candidates(db, course.id)
            plan = _initial_plan(db, course, gateway, candidates)
            create_learning_task(db, existing, course, gateway, candidates, plan, "diagnostic", progress)
            db.commit()
            return read_learning_session(db, existing.id)
        if existing.diagnostic_signature != signature:
            existing.diagnostic_signature = signature
            existing.scope_text = context["scope_text"]
            record_session_event(
                db, existing.id, "course_context_updated",
                reason="新资料或真题验收状态已进入学习版本；当前题与历史保持不变，下一次决策使用最新版本",
            )
            existing.updated_at = datetime.now(timezone.utc)
            db.commit()
        return read_learning_session(db, existing.id)
    if existing and existing.stage != "completed":
        raise LearningSessionError(409, "当前学习尚未完成，不能另起会话")
    if not context["can_start"]:
        raise LearningSessionError(409, "请先提供至少一份有效课程资料，并等待本批资料完成分析")
    if gateway is None:
        raise LearningSessionError(503, "课程诊断需要可用的模型服务")

    candidates = course_candidates(db, course.id)
    plan = _initial_plan(db, course, gateway, candidates)
    session = LearningSession(
        course_id=course_id,
        stage="diagnosing",
        knowledge_mode="course_specific",
        scope_text=context["scope_text"],
        diagnostic_signature=signature,
        created_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.flush()
    create_learning_task(db, session, course, gateway, candidates, plan, "diagnostic")
    record_session_event(db, session.id, "session_created", course_id=course_id, evidence_version=signature)
    db.commit()
    return read_learning_session(db, session.id)


def _planner_payload(db: Session, session: LearningSession, candidates: list[dict]) -> dict:
    tasks = list(db.scalars(
        select(LearningTask).where(LearningTask.session_id == session.id).order_by(LearningTask.ordinal)
    ).all())
    history = []
    for task in tasks[-10:]:
        latest = get_latest_attempt(db, task.id)
        if task_uses_removed_source(db, task):
            continue
        history.append({
            "kind": task.kind,
            "knowledge_point": task.knowledge_point,
            "sub_skill": task.sub_skill,
            "stem": task.stem,
            "verdict": latest.verdict if latest else None,
            "missing_points": latest.missing_points if latest else [],
            "hints_used": latest.hints_used if latest else 0,
        })
    points = list(db.scalars(select(LearningPointState).where(LearningPointState.session_id == session.id)).all())
    return {
        "scope": session.scope_text,
        "available_topics": [item["knowledge_point"] for item in candidates],
        "topic_materials": {item["knowledge_point"]: item["material_types"] for item in candidates},
        "diagnostic_target": diagnostic_target(candidates),
        "diagnostic_completed_topics": len(diagnosed_topics(db, session.id)),
        "recent_history": history,
        "prior_learning": prior_learning_context(db, session.course_id, {c["knowledge_point"] for c in candidates}, session.id),
        "point_states": [
            {
                "knowledge_point": point.knowledge_point,
                "status": point.status,
                "score": point.score,
                "evidence_count": point.evidence_count,
                "no_progress_rounds": point.no_progress_rounds,
            }
            for point in points if is_semantic_topic(point.knowledge_point) and point.knowledge_point in {c["knowledge_point"] for c in candidates}
        ],
    }


def _plan_next(
    db: Session,
    session: LearningSession,
    course: Course,
    gateway: ModelGateway,
    candidates: list[dict],
) -> LearningPlanContent:
    payload = _planner_payload(db, session, candidates)
    system_prompt = (
        "你是自适应复习 Agent 的规划器。每次只决定一个下一步，必须根据最近作答、缺失要点、提示使用、"
        "历史状态和可用资料主题选择诊断、补缺、练习、重测或完成。"
        "基础错误先补缺或分层诊断；练习正确后应独立重测；重测错误回到补缺；已稳定主题减少重复。"
        "topic_materials 标明资料类型；有往年题的主题应关注真实任务形式，但仍须用课程证据保证答案正确。"
        "diagnostic_target 是本轮建议诊断主题数，diagnostic_completed_topics 是已诊断的不同主题数；优先形成精简覆盖，不无意义重复。"
        "knowledge_point 必须原样来自 available_topics。完成只在主要主题已有足够诊断且没有未解决薄弱点时选择。"
        "reason 必须引用具体学习证据。只输出规定 JSON。"
        "prior_learning仅为其他轮次有效记录；可用于选择需补缺或复测的主题，不复制其掌握分数、"
        "不把旧记录计入本轮完成条件，复测需未见题或实质变式。"
    )
    try:
        plan, _ = gateway.generate_json(
            db, course.id, "adaptive_next_action", system_prompt,
            f"<learning_planner>{json.dumps(payload, ensure_ascii=False)}</learning_planner>",
            LearningPlanContent, max_tokens=1000,
        )
    except ModelError as error:
        raise LearningSessionError(error.status_code, f"Agent 下一步规划失败：{error.message}") from error
    if plan.knowledge_point not in {item["knowledge_point"] for item in candidates}:
        raise LearningSessionError(502, "Agent 选择了没有资料锚点的主题，已停止执行")
    return plan


def _safe_plan(db: Session, session: LearningSession, task: LearningTask, latest: LearningAttempt, plan: LearningPlanContent, candidates: list[dict]) -> LearningPlanContent:
    if latest.verdict == "incorrect" and plan.action not in {"diagnostic", "remediation", "practice"}:
        plan = plan.model_copy(update={"action": "remediation", "knowledge_point": task.knowledge_point})
    if latest.verdict == "incorrect" and plan.action == "remediation":
        plan = plan.model_copy(update={"knowledge_point": task.knowledge_point})
    if task.kind == "practice" and latest.verdict == "correct":
        plan = plan.model_copy(update={"action": "retest", "knowledge_point": task.knowledge_point})
    if task.kind == "retest" and latest.verdict == "correct" and latest.hints_used > 0:
        plan = plan.model_copy(update={"action": "retest", "knowledge_point": task.knowledge_point, "reason": "本次重测已接受帮助，需要换题进行无提示独立验证"})
    if task.kind == "retest" and latest.verdict == "incorrect":
        plan = plan.model_copy(update={"action": "remediation", "knowledge_point": task.knowledge_point})
    if plan.action == "complete":
        diagnostic_points = diagnosed_topics(db, session.id)
        unresolved = next((
            point for point in db.scalars(select(LearningPointState).where(
                LearningPointState.session_id == session.id,
                LearningPointState.status.in_(["weak", "fragile", "retest_pending", "needs_review"]),
            )).all() if is_semantic_topic(point.knowledge_point) and point.knowledge_point in {c["knowledge_point"] for c in candidates}
        ), None)
        if len(diagnostic_points) < diagnostic_target(candidates) or unresolved is not None:
            remaining = next((item for item in candidates if unresolved is not None
                              and item["knowledge_point"] == unresolved.knowledge_point), None)
            if remaining is None:
                remaining = next((item for item in candidates if item["knowledge_point"] not in diagnostic_points), candidates[0])
            plan = LearningPlanContent(
                action="diagnostic",
                knowledge_point=remaining["knowledge_point"],
                sub_skill="补充当前覆盖不足主题的基础与应用诊断",
                cognitive_level="understand",
                difficulty_prior="basic",
                reason="当前诊断覆盖或薄弱点解决证据不足，不能提前结束本轮学习",
            )
    return plan


def advance_session(db: Session, session_id: str, gateway: ModelGateway, expected_task_id: str | None = None, expected_progress_version: str | None = None, independent_check: bool = False) -> dict:
    session = get_learning_session(db, session_id)
    assert_session_progress(db, session, expected_task_id, expected_progress_version)
    assert_no_running_tutoring(db, session)
    progress = get_progress_version(db, session)
    if independent_check and (not expected_task_id or not expected_progress_version):
        raise LearningSessionError(422, '独立检查需要明确当前题目与进度版本')
    if independent_check:
        course = db.get(Course,session.course_id)
        if not course or course.archived_at or session.stage not in ACTIVE_STAGES | {'remediating'}:
            raise LearningSessionError(409,'此轮次当前不能生成独立检查题')
    if session.stage == "completed":
        return read_learning_session(db, session.id)
    task = get_current_task(db, session)
    latest = get_latest_attempt(db, task.id)
    if task_uses_removed_source(db, task):
        if independent_check:
            raise LearningSessionError(409,'当前题资料已失效，不能据此生成独立检查题，请先恢复或重新安排学习')
        course = db.get(Course, session.course_id)
        context = prepare_course_context(db, session.course_id, gateway)
        candidates = course_candidates(db, session.course_id)
        if not context["can_start"] or not candidates:
            raise LearningSessionError(409, "请先补充有效资料并等待解析完成，再重新安排学习")
        session.scope_text = context["scope_text"]
        session.diagnostic_signature = course_signature(db, session.course_id)
        plan = _initial_plan(db, course, gateway, candidates)
        plan = plan.model_copy(update={"reason": "原任务资料已移除，依据剩余资料重新安排。" + plan.reason})
        create_learning_task(db, session, course, gateway, candidates, plan, "diagnostic", progress)
        session.scope_text = context["scope_text"]
        session.diagnostic_signature = course_signature(db, session.course_id)
        db.commit()
        return read_learning_session(db, session.id)
    if session.stage == "blocked":
        session.stage = {"diagnostic": "diagnosing", "practice": "practicing", "retest": "retesting"}[task.kind]
        if task.status == "withdrawn":
            task.status = "current"
        record_session_event(db, session.id, "session_resumed", task.id)
        db.commit()
        return read_learning_session(db, session.id)
    if latest is None or latest.verdict == "ungraded":
        raise LearningSessionError(409, "请先取得当前题目的有效判分结果")
    course = db.get(Course, session.course_id)
    if course is None:
        raise LearningSessionError(404, "课程不存在")
    context = prepare_course_context(db, course.id, gateway)
    candidates = course_candidates(db, course.id)
    if not candidates:
        raise LearningSessionError(409, "当前有效资料锚点不可用，请补充资料后再继续")
    session.scope_text = context["scope_text"]
    session.diagnostic_signature = course_signature(db, course.id)

    if independent_check:
        plan = LearningPlanContent(action='retest',knowledge_point=task.knowledge_point,sub_skill=task.sub_skill,cognitive_level=task.cognitive_level,difficulty_prior=task.difficulty_prior,reason='学生明确选择以未见题或实质变式独立检查；此前帮助不作为掌握证据')
    elif session.stage == "remediating":
        plan = LearningPlanContent(
            action="practice",
            knowledge_point=task.knowledge_point,
            sub_skill=task.sub_skill,
            cognitive_level=task.cognitive_level,
            difficulty_prior=task.difficulty_prior,
            reason=f"刚完成“{task.knowledge_point}”的针对性补缺，需要一道新题检查即时理解",
        )
    else:
        proposed = _plan_next(db, session, course, gateway, candidates)
        plan = _safe_plan(db, session, task, latest, proposed, candidates)
    assert_session_progress(db, session, task.id, progress)
    if plan.action == "remediation":
        session.stage = "remediating"
        session.current_task_id = task.id
        record_session_event(
            db, session.id, "weakness_identified", task.id,
            knowledge_point=task.knowledge_point, reason=plan.reason,
        )
    elif plan.action == "complete":
        session.stage = "completed"
        session.current_task_id = None
        record_session_event(db, session.id, "plan_updated", task.id, reason=plan.reason)
    else:
        kind = {"diagnostic": "diagnostic", "practice": "practice", "retest": "retest"}[plan.action]
        create_learning_task(db, session, course, gateway, candidates, plan, kind, progress)
    session.scope_text = context["scope_text"]
    session.diagnostic_signature = course_signature(db, course.id)
    session.updated_at = datetime.now(timezone.utc)
    db.commit()
    return read_learning_session(db, session.id)


def request_hint(db: Session, session_id: str, expected_task_id: str | None = None, expected_progress_version: str | None = None) -> dict:
    session = get_learning_session(db, session_id)
    assert_session_progress(db, session, expected_task_id, expected_progress_version)
    assert_no_running_tutoring(db, session)
    if session.stage not in ACTIVE_STAGES | {"remediating", "blocked"}:
        raise LearningSessionError(409, "当前阶段不能请求提示")
    task = get_current_task(db, session)
    if task_uses_removed_source(db, task):
        raise LearningSessionError(409, "当前题引用的资料已移除，请重新安排题目")
    if task.kind == "retest":
        raise LearningSessionError(409, "独立重测不提供提示，请先独立作答")
    hint = task.analysis or "先核对题目要求的结论、适用条件和评分要点，再组织自己的回答。"
    record_session_event(db, session.id, "hint_requested", task.id)
    db.commit()
    return {"hint": hint, "session": read_learning_session(db, session.id)}
