import json
from pathlib import Path

import pytest

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.learning_sessions import (
    _diagnosed_topics, _diagnostic_target, _planner_payload, _safe_plan, _semantic_topic,
    create_or_resume_session,
)
from app.main import get_model_gateway
from app.model_gateway import ModelError, ModelGateway, ModelProvider, MockProvider, ProviderReply, TokenUsage
from app.models import LearningAttempt, LearningPointState, LearningSession, LearningTask, Source, UsageRecord
from app.schemas import LearningPlanContent
from app.worker import run_next_task
from test_agent import use_mock
from test_questions import evidence_for_course
from test_sources import create_course, upload


def test_diagnostic_target_counts_unique_topics_not_question_candidates() -> None:
    candidates = [
        {"knowledge_point": "事务"},
        {"knowledge_point": "事务"},
        {"knowledge_point": "SQL"},
        {"knowledge_point": "SQL"},
        {"knowledge_point": "恢复"},
    ]
    assert _diagnostic_target(candidates) == 3
    candidates.append({"knowledge_point": "事务"})
    assert _diagnostic_target(candidates) == 3
    candidates.append({"knowledge_point": "数据模型"})
    assert _diagnostic_target(candidates) == 4


def test_instruction_and_raw_formula_headings_fall_back_to_course_topic() -> None:
    for heading in ["将其与Student自然合并，为所需结果：", "πSno，Cno (SC) ÷πCno (Course)"]:
        assert _semantic_topic(heading, "2-2 关系代数.pdf", heading + "\n关系运算的说明") == "关系代数"
    assert _semantic_topic("自然连接", "2-2 关系代数.pdf", "自然连接的说明") == "自然连接"


def test_planner_counts_all_answered_semantic_topics_beyond_recent_history(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    with session_factory() as db:
        original = db.get(LearningTask, session["current_task"]["id"])
        original.knowledge_point = "早期主题"
        original.status = "answered"
        values = {column.key: getattr(original, column.key) for column in LearningTask.__table__.columns
                  if column.key not in {"id", "created_at", "ordinal", "knowledge_point", "status"}}
        for index in range(12):
            db.add(LearningTask(**values, ordinal=index + 2, knowledge_point="近期主题", status="answered"))
        for index, topic in enumerate(["将其与Student自然合并，为所需结果：", "πSno (SC) ÷πCno (Course)"]):
            db.add(LearningTask(**values, ordinal=index + 14, knowledge_point=topic, status="answered"))
        db.add(LearningTask(**values, ordinal=16, knowledge_point="尚未作答", status="pending"))
        db.flush()
        for task in db.scalars(select(LearningTask).where(LearningTask.session_id == session["id"], LearningTask.status == "answered")).all():
            db.add(LearningAttempt(session_id=session["id"], task_id=task.id, attempt_number=1,
                                   answer="独立作答", verdict="correct", grading_layer="deterministic",
                                   feedback="正确", missing_points=[], hints_used=0, duration_seconds=0,
                                   provider="deterministic", model="test", mocked=False))
        db.commit()
        assert _diagnosed_topics(db, session["id"]) == {"早期主题", "近期主题"}
        payload = _planner_payload(db, db.get(LearningSession, session["id"]), [])
        assert len(payload["recent_history"]) == 10
        assert payload["diagnostic_completed_topics"] == 2
        db.add(LearningPointState(session_id=session["id"], knowledge_point="将其与Student自然合并，为所需结果：", status="weak"))
        db.commit()
        plan = LearningPlanContent(action="complete", knowledge_point="近期主题", sub_skill="主题诊断",
                                   cognitive_level="understand", difficulty_prior="basic", reason="覆盖充分且没有有效薄弱点")
        candidates = [{"knowledge_point": topic} for topic in ["早期主题", "近期主题"]]
        session_row = db.get(LearningSession, session["id"])
        latest = LearningAttempt(verdict="correct")
        assert _safe_plan(db, session_row, original, latest, plan, candidates).action == "complete"
        db.add(LearningPointState(session_id=session["id"], knowledge_point="近期主题", status="weak"))
        db.commit()
        assert _safe_plan(db, session_row, original, latest, plan, candidates).action == "diagnostic"
    current = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert current["diagnostic_completed"] == 2


def start(client: TestClient, course_id: str) -> dict:
    response = client.post(f"/api/courses/{course_id}/learning-sessions")
    assert response.status_code == 200, response.text
    return response.json()


def answer(client: TestClient, session_id: str, value: str) -> dict:
    response = client.post(f"/api/learning-sessions/{session_id}/attempts", json={
        "answer": value,
        "duration_seconds": 12,
    })
    assert response.status_code == 200, response.text
    return response.json()


def advance(client: TestClient, session_id: str) -> dict:
    response = client.post(f"/api/learning-sessions/{session_id}/next")
    assert response.status_code == 200, response.text
    return response.json()


def reference_answer(session_factory: sessionmaker, session: dict) -> str:
    with session_factory() as db:
        task = db.get(LearningTask, session["current_task"]["id"])
        assert task is not None
        return task.reference_answer


def answer_correct(client: TestClient, session_factory: sessionmaker, session: dict) -> dict:
    return answer(client, session["id"], reference_answer(session_factory, session))


def test_course_without_valid_anchor_cannot_start_or_call_model(
    client: TestClient,
) -> None:
    use_mock(client)
    course_id = create_course(client, "无资料课程")
    context = client.get(f"/api/courses/{course_id}/learning-context")
    assert context.status_code == 200
    assert context.json()["preparation_status"] == "awaiting_anchor"
    assert context.json()["can_start"] is False
    assert context.json()["topics"] == []
    assert client.post(f"/api/courses/{course_id}/learning-sessions").status_code == 409
    assert client.get(f"/api/courses/{course_id}/usage").json()["records"] == []


def test_anchor_generates_only_one_independently_validated_question(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    context = client.get(f"/api/courses/{course_id}/learning-context").json()
    assert context["can_start"] is True
    assert context["scope_source"] == "course_evidence"
    assert client.get(f"/api/courses/{course_id}/learning-context").json() == context

    session = start(client, course_id)
    assert session["stage"] == "diagnosing"
    assert session["diagnostic_total"] == 1
    assert session["current_task"]["source_track"] == "course"
    assert session["current_task"]["validation_status"] == "validated"
    assert session["current_task"]["validation_confidence"] >= 0.8
    assert session["current_task"]["rubric"] == []
    assert session["current_task"]["decision_reason"]
    assert session["current_task"]["reference_answer"] is None
    purposes = [record["purpose"] for record in client.get(f"/api/courses/{course_id}/usage").json()["records"]]
    assert purposes.count("course_question_generation") == 1
    assert purposes.count("course_question_validation") == 1
    assert "general_diagnostic" not in purposes
    assert start(client, course_id)["id"] == session["id"]


def test_dynamic_remediation_practice_and_retest_loop_is_persistent(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id = create_course(client)
    source_id = upload(
        client,
        course_id,
        content="# 死锁\n\n死锁需要互斥、占有且等待、不可剥夺和循环等待四个必要条件。".encode(),
        name="死锁.md",
    ).json()["source"]["id"]
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    session = start(client, course_id)

    wrong = answer(client, session["id"], "不知道")
    assert wrong["current_task"]["latest_attempt"]["verdict"] == "incorrect"
    remediation = advance(client, session["id"])
    assert remediation["stage"] == "remediating"
    assert remediation["current_task"]["id"] == session["current_task"]["id"]

    practice = advance(client, session["id"])
    assert practice["stage"] == "practicing"
    assert practice["current_task"]["id"] != session["current_task"]["id"]
    practice = answer_correct(client, session_factory, practice)
    retest = advance(client, session["id"])
    assert retest["stage"] == "retesting"
    assert client.post(f"/api/learning-sessions/{session['id']}/hints").status_code == 409
    answer_correct(client, session_factory, retest)
    completed = advance(client, session["id"])
    assert completed["stage"] == "completed"
    assert completed["retest_passed"] == 1

    restored = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert restored["stage"] == "completed"
    assert restored["points"][0]["status"] == "secure_for_now"
    with session_factory() as db:
        tasks = list(db.scalars(select(LearningTask).where(LearningTask.session_id == session["id"])).all())
        attempts = list(db.scalars(select(LearningAttempt).where(LearningAttempt.session_id == session["id"])).all())
    assert [task.kind for task in tasks] == ["diagnostic", "practice", "retest"]
    assert len(attempts) == 3
    assert all(task.validation_status == "validated" for task in tasks)


@pytest.mark.parametrize("correct,confidence,verdict,status", [
    (True, 0.97, "correct", "learning"),
    (False, 0.96, "incorrect", "weak"),
    (True, 0.6, "ungraded", "needs_review"),
])
def test_grade_review_preserves_history_and_recalculates_without_extra_attempt(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
    correct: bool, confidence: float, verdict: str, status: str,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    graded = answer(client, session["id"], "不知道")
    previous = graded["current_task"]["latest_attempt"]
    assert previous["verdict"] == "incorrect"

    class Reviewer(MockProvider):
        def complete(self, system_prompt, user_prompt, max_tokens):
            assert "<grade_review>" in user_prompt
            return ProviderReply(json.dumps({
                "is_correct": correct, "confidence": confidence,
                "feedback": "已按题目约束重新核对等价性", "missing_points": [] if correct else ["仍有错误"],
            }), TokenUsage(40, 20))

    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(Reviewer())
    response = client.post(f"/api/learning-sessions/{session['id']}/attempts/{previous['id']}/review",
                           json={"reason": "请独立检查参考答案与我的等价解法"})
    assert response.status_code == 200, response.text
    result = response.json()
    attempt = result["current_task"]["latest_attempt"]
    assert attempt["id"] == previous["id"] and attempt["answer"] == previous["answer"]
    assert attempt["created_at"] == previous["created_at"] and attempt["verdict"] == verdict
    assert attempt["review_history"][0]["previous"]["verdict"] == "incorrect"
    assert attempt["review_history"][0]["previous"]["usage_id"] == previous["usage_id"]
    assert attempt["review_history"][0]["revised"]["verdict"] == verdict
    assert attempt["review_history"][0]["revised"]["usage_id"] != previous["usage_id"]
    point = result["points"][0]
    assert point["status"] == status
    assert point["evidence_count"] == (0 if verdict == "ungraded" else 1)
    assert point["no_progress_rounds"] == (1 if verdict == "incorrect" else 0)
    with session_factory() as db:
        assert db.query(LearningAttempt).count() == 1
    restored = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert restored["current_task"]["latest_attempt"]["review_history"] == attempt["review_history"]
    if verdict == "correct":
        use_mock(client)
        assert advance(client, session["id"])["stage"] == "retesting"


def test_failed_grade_review_keeps_previous_grade_and_mastery(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    graded = answer(client, session["id"], "不知道")
    attempt_id = graded["current_task"]["latest_attempt"]["id"]

    class FailedReviewer(MockProvider):
        def complete(self, *args):
            raise ModelError(502, "复核服务暂不可用")

    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(FailedReviewer())
    url = f"/api/learning-sessions/{session['id']}/attempts/{attempt_id}/review"
    assert client.post(url, json={"reason": "请检查等价解法"}).status_code == 502
    restored = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert restored["current_task"]["latest_attempt"] == graded["current_task"]["latest_attempt"]
    assert restored["points"] == graded["points"]
    assert client.post(url, json={"reason": "  "}).status_code == 422
    other = client.post(f"/api/learning-sessions/{session['id']}/attempts/other-attempt/review",
                        json={"reason": "检查另一条记录"})
    assert other.status_code == 409


def test_historical_correction_replays_latest_evidence_and_reopens_completed_round(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    first = answer(client, session["id"], "不知道")
    advance(client, session["id"])
    practice = advance(client, session["id"])
    answer_correct(client, session_factory, practice)
    retest = advance(client, session["id"])
    retested = answer_correct(client, session_factory, retest)
    completed = advance(client, session["id"])
    assert completed["stage"] == "completed"
    first_attempt = first["current_task"]["latest_attempt"]
    # Revising earlier evidence must not overwrite the later successful retest state.
    url = f"/api/learning-sessions/{session['id']}/attempts/{first_attempt['id']}/correction"
    revised = client.post(url, json={"verdict": "correct", "reason": "人工对照评分要求确认早期作答有效"}).json()
    assert revised["stage"] == "completed"
    assert revised["points"][0]["status"] == "secure_for_now"
    assert revised["points"][0]["evidence_count"] == 3
    assert client.post(url, json={"verdict": "incorrect", "reason": "重复提交旧版本"}).status_code == 409
    last_attempt = retested["current_task"]["latest_attempt"]
    url = f"/api/learning-sessions/{session['id']}/attempts/{last_attempt['id']}/correction"
    response = client.post(url, json={"verdict": "incorrect", "reason": "人工对照原文发现重测缺少必要条件"})
    assert response.status_code == 200, response.text
    reopened = response.json()
    assert reopened["stage"] == "retesting" and reopened["current_task"]["id"] == retest["current_task"]["id"]
    assert reopened["points"][0]["status"] == "weak" and reopened["retest_passed"] == 0
    assert reopened["points"][0]["score"] < completed["points"][0]["score"]
    history = client.get(f"/api/learning-sessions/{session['id']}/history").json()
    assert len(history["tasks"]) == 3
    record = history["tasks"][-1]["attempts"][0]
    assert record["answer"] == last_attempt["answer"] and record["grading_layer"] == "human_correction"
    assert record["review_history"][0]["previous"]["verdict"] == "correct"
    assert record["review_history"][0]["method"] == "human"
    assert advance(client, session["id"])["stage"] == "remediating"


def test_correcting_old_round_does_not_replace_current_round_or_pending_task(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    old = start(client, course_id)
    graded = answer_correct(client, session_factory, old)
    with session_factory() as db:
        db.get(LearningSession, old["id"]).stage = "completed"
        db.get(LearningSession, old["id"]).current_task_id = None
        db.commit()
    new_response = client.post(f"/api/courses/{course_id}/learning-sessions?restart=true")
    assert new_response.status_code == 200, new_response.text
    new = new_response.json()
    attempt = graded["current_task"]["latest_attempt"]
    response = client.post(f"/api/learning-sessions/{old['id']}/attempts/{attempt['id']}/correction",
                           json={"verdict": "incorrect", "reason": "旧轮次错判人工纠正"})
    assert response.status_code == 200
    assert response.json()["id"] == old["id"] and response.json()["stage"] != "completed"
    current = client.get(f"/api/courses/{course_id}/learning-sessions/current").json()
    assert current["id"] == new["id"] and current["current_task"] == new["current_task"]
    assert current["current_task"]["reference_answer"] is None and current["current_task"]["rubric"] == []
    assert len(client.get(f"/api/courses/{course_id}/learning-sessions").json()) == 2
    # Target ownership must be validated independently of the URL session.
    assert client.post(f"/api/learning-sessions/{new['id']}/attempts/{attempt['id']}/correction",
                       json={"verdict": "correct", "reason": "跨轮次错误请求"}).status_code == 409



def test_historical_ai_review_keeps_newer_pending_task(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    first = answer(client, session["id"], "不知道")
    advance(client, session["id"])
    practice = advance(client, session["id"])
    prior = first["current_task"]["latest_attempt"]

    class Reviewer(MockProvider):
        def complete(self, system_prompt, user_prompt, max_tokens):
            payload = json.loads(user_prompt.split("<grade_review>", 1)[1].split("</grade_review>", 1)[0])
            assert payload["student_answer"] == prior["answer"]
            return ProviderReply(json.dumps({"is_correct": True, "confidence": 0.95,
                                           "feedback": "复核后接受等价解法", "missing_points": []}), TokenUsage(40, 20))

    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(Reviewer())
    response = client.post(f"/api/learning-sessions/{session['id']}/attempts/{prior['id']}/review",
                           json={"reason": "回看历史题并核对等价解法"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["current_task"] == practice["current_task"]
    assert result["stage"] == "practicing" and result["points"][0]["evidence_count"] == 1
    history = client.get(f"/api/learning-sessions/{session['id']}/history").json()
    record = history["tasks"][0]["attempts"][0]
    assert record["answer"] == prior["answer"] and record["verdict"] == "correct"
    assert record["review_history"][-1]["method"] == "ai"
    assert history["tasks"][1]["task"]["study_answer"] is None
    assert history["tasks"][1]["task"]["rubric"] == []


def test_review_of_superseded_attempt_does_not_inflate_or_replace_latest_evidence(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    first = answer(client, session["id"], "不知道")
    attempt_id = first["current_task"]["latest_attempt"]["id"]
    url = f"/api/learning-sessions/{session['id']}/attempts/{attempt_id}/correction"
    pending = client.post(url, json={"verdict": "ungraded", "reason": "原判分依据不足，需要重新作答"}).json()
    assert pending["points"][0]["evidence_count"] == 0
    latest = answer_correct(client, session_factory, pending)
    assert latest["points"][0]["evidence_count"] == 1
    corrected = client.post(url, json={"verdict": "incorrect", "reason": "补充证据后确认早期答案不正确",
                                      "expected_review_count": 1}).json()
    assert corrected["points"] == latest["points"] or all(
        corrected["points"][0][key] == latest["points"][0][key]
        for key in ["status", "score", "evidence_count", "hint_dependent"]
    )
    assert corrected["current_task"]["latest_attempt"] == latest["current_task"]["latest_attempt"]
    history = client.get(f"/api/learning-sessions/{session['id']}/history").json()
    assert len(history["tasks"][0]["attempts"]) == 2
    assert len(history["tasks"][0]["attempts"][0]["review_history"]) == 2
    assert client.post(f"/api/learning-sessions/{session['id']}/attempts/{attempt_id}/review",
                       json={"reason": "不应覆盖人工判断", "expected_review_count": 2}).status_code == 409


def test_ai_review_refreshes_session_advanced_during_model_call(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    graded = answer(client, session["id"], "不知道")
    prior = graded["current_task"]["latest_attempt"]
    # Simulate another browser advancing while the model response is in flight.
    advanced = {}
    class Reviewer(MockProvider):
        def complete(self, system_prompt, user_prompt, max_tokens):
            use_mock(client)
            advance(client, session["id"])
            advanced.update(advance(client, session["id"]))
            return ProviderReply(json.dumps({"is_correct": False, "confidence": 0.95,
                                           "feedback": "原答案仍缺乏依据", "missing_points": []}), TokenUsage(40, 20))
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(Reviewer())
    response = client.post(f"/api/learning-sessions/{session['id']}/attempts/{prior['id']}/review",
                           json={"reason": "检查模型等待期间的新学习进度"})
    assert response.status_code == 200, response.text
    assert response.json()["current_task"] == advanced["current_task"]
    assert response.json()["stage"] == "practicing"


def test_each_answer_replans_and_generates_at_most_one_new_task(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    first_id = session["current_task"]["id"]
    session = answer_correct(client, session_factory, session)
    following = advance(client, session["id"])
    assert following["current_task"]["id"] != first_id
    assert following["diagnostic_completed"] == 1
    with session_factory() as db:
        assert db.query(LearningTask).count() == 2
    assert following["current_task"]["latest_attempt"] is None
    assert "adaptive_next_action" in {
        record["purpose"] for record in client.get(f"/api/courses/{course_id}/usage").json()["records"]
    }


class LowConfidenceProvider(MockProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<grading>" not in user_prompt:
            return super().complete(system_prompt, user_prompt, max_tokens)
        content = json.dumps({
            "is_correct": True,
            "confidence": 0.5,
            "feedback": "现有作答依据不足。",
            "missing_points": ["需要补充关键条件"],
        }, ensure_ascii=False)
        return ProviderReply(content, TokenUsage(prompt_tokens=20, completion_tokens=10))


def test_low_confidence_open_grade_stays_ungraded(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(LowConfidenceProvider())
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    graded = answer_correct(client, session_factory, session)
    assert graded["current_task"]["latest_attempt"]["verdict"] == "ungraded"
    assert graded["current_task"]["latest_attempt"]["confidence"] == 0.5
    assert graded["points"][0]["status"] == "needs_review"
    assert client.post(f"/api/learning-sessions/{session['id']}/next").status_code == 409


def test_unreadable_or_unsemantic_material_does_not_count_as_anchor(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id = create_course(client, "数据库基础")
    source_id = upload(
        client,
        course_id,
        content=("这里没有可识别的短标题，只有一段不能形成具体诊断目标的正文。" * 2).encode(),
        name="课件.md",
    ).json()["source"]["id"]
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    context = client.get(f"/api/courses/{course_id}/learning-context").json()
    assert context["preparation_status"] == "needs_more_evidence"
    assert context["can_start"] is False
    assert client.post(f"/api/courses/{course_id}/learning-sessions").status_code == 409


def test_storage_hash_filename_does_not_become_knowledge_point(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id = create_course(client, "数据库基础")
    upload(
        client, course_id,
        content="# 数据模型\n\n数据模型由数据结构、数据操作和约束条件组成。".encode(),
        name="4b64d796c0ac4408b03ccd8809eaec89.pdf.md",
    )
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    context = client.get(f"/api/courses/{course_id}/learning-context").json()
    assert context["can_start"] is True
    assert "数据模型" in context["topics"]
    assert all("4b64d796" not in topic for topic in context["topics"])


def test_new_material_changes_next_plan_without_rewriting_history(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id = create_course(client, "数据库基础")
    first_id = upload(
        client, course_id,
        content="# 死锁\n\n死锁需要互斥、占有且等待、不可剥夺和循环等待四个必要条件。".encode(),
        name="死锁.md",
    ).json()["source"]["id"]
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    session = start(client, course_id)
    answered = answer_correct(client, session_factory, session)
    old_task = answered["current_task"]
    old_attempt = old_task["latest_attempt"]

    upload(
        client, course_id,
        content="关系模型以关系为基本数据结构，并通过关系代数表达查询与操作。".encode(),
        name="2-1 关系模型.md",
    )
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    resumed = client.get(f"/api/courses/{course_id}/learning-sessions/current").json()
    assert resumed["current_task"]["id"] == old_task["id"]
    assert resumed["current_task"]["stem"] == old_task["stem"]
    assert resumed["current_task"]["latest_attempt"]["id"] == old_attempt["id"]
    # Reading current progress is now read-only; new evidence is applied on next action.
    assert resumed["recent_events"] == answered["recent_events"]

    following = advance(client, session["id"])
    assert following["current_task"]["knowledge_point"] == "关系模型"
    with session_factory() as db:
        attempt = db.get(LearningAttempt, old_attempt["id"])
        assert attempt is not None and attempt.answer == old_attempt["answer"]
        tasks = list(db.scalars(select(LearningTask).where(LearningTask.session_id == session["id"])).all())
    assert len(tasks) == 2
    assert all(task.status != "pending" or task.id == following["current_task"]["id"] for task in tasks)
    assert first_id != following["current_task"]["id"]


class ScopeCaptureProvider(MockProvider):
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        self.prompts.append(user_prompt)
        return super().complete(system_prompt, user_prompt, max_tokens)


def test_scope_sampling_includes_later_source_after_first_source_exceeds_budget(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    provider = ScopeCaptureProvider()
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(provider)
    course_id = create_course(client, "数据库基础")
    first_content = "\n\n".join(f"早期资料第 {index} 段包含用于范围采样的完整正文内容。" for index in range(60))
    upload(client, course_id, content=first_content.encode(), name="早期资料.md")
    upload(
        client, course_id,
        content="关系模型以关系为基本数据结构，并通过关系代数表达查询与操作。".encode(),
        name="关系模型.md",
    )
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads")
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads")
    response = client.get(f"/api/courses/{course_id}/learning-context")
    scope_prompt = next(prompt for prompt in provider.prompts if "<course_scope>" in prompt)
    assert "早期资料.md" in scope_prompt
    assert "关系模型.md" in scope_prompt
    assert "第 2 页" not in response.json()["scope_text"]


def test_hinted_success_is_not_independent_mastery(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    hinted = client.post(f"/api/learning-sessions/{session['id']}/hints")
    assert hinted.status_code == 200
    graded = answer_correct(client, session_factory, session)
    point = next(item for item in graded["points"] if item["knowledge_point"] == graded["current_task"]["knowledge_point"])
    assert graded["current_task"]["latest_attempt"]["hints_used"] == 1
    assert point["status"] == "fragile"
    assert point["hint_dependent"] is True


class RejectingValidatorProvider(MockProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<question_validation>" in user_prompt:
            content = json.dumps({
                "is_usable": False,
                "confidence": 0.95,
                "issues": ["题干没有形成具体可回答的问题"],
            }, ensure_ascii=False)
            return ProviderReply(content, TokenUsage(prompt_tokens=20, completion_tokens=10))
        return super().complete(system_prompt, user_prompt, max_tokens)


def test_independently_rejected_question_is_never_published(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(RejectingValidatorProvider())
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/learning-sessions")
    assert response.status_code == 502
    assert "停止发布" in response.json()["detail"]
    with session_factory() as db:
        assert db.scalar(select(LearningTask.id)) is None
        purposes = list(db.scalars(select(UsageRecord.purpose)).all())
    assert purposes.count("course_question_generation") == 2
    assert purposes.count("course_question_validation") == 2


class LongStatementProvider(MockProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<question_generation>" in user_prompt:
            allowed = json.loads(user_prompt.split("<allowed_evidence>", 1)[1].split("</allowed_evidence>", 1)[0])
            blueprint = json.loads(user_prompt.split("<blueprint>", 1)[1].split("</blueprint>", 1)[0])
            content = json.dumps({
                "knowledge_point": blueprint["knowledge_point"],
                "sub_skill": blueprint["sub_skill"],
                "cognitive_level": "understand",
                "difficulty_prior": "basic",
                "question_type": "true_false",
                "stem": "判断题：" + allowed[0]["text"] * 4,
                "options": ["正确", "错误"],
                "answer": "正确",
                "rubric": ["判断正误"],
                "prerequisites": [],
                "analysis": "错误样本",
                "evidence_ids": [allowed[0]["evidence_id"]],
            }, ensure_ascii=False)
            return ProviderReply(content, TokenUsage(prompt_tokens=20, completion_tokens=10))
        return super().complete(system_prompt, user_prompt, max_tokens)


def test_long_slide_statement_cannot_become_true_false_question(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(LongStatementProvider())
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/learning-sessions")
    assert response.status_code == 502
    with session_factory() as db:
        assert db.scalar(select(LearningTask.id)) is None
        validations = list(db.scalars(select(UsageRecord).where(UsageRecord.purpose == "course_question_validation")).all())
    assert validations == []


def test_resume_recovers_same_session_without_generating_another_question(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    answer_correct(client, session_factory, session)
    with session_factory() as db:
        restored = create_or_resume_session(db, course_id)
        count = int(db.query(LearningTask).count())
    assert restored["id"] == session["id"]
    assert restored["current_task"]["id"] == session["current_task"]["id"]
    assert count == 1


def test_material_type_reaches_learning_planner_and_question_generator(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    provider = ScopeCaptureProvider()
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(provider)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    with session_factory() as db:
        for source in db.scalars(select(Source).where(Source.course_id == course_id)).all():
            source.material_type = "assignment"
        db.commit()
    session = start(client, course_id)
    assert session["diagnostic_target"] == 1
    initial_prompt = next(prompt for prompt in provider.prompts if "<initial_learning_plan>" in prompt)
    question_prompt = next(prompt for prompt in provider.prompts if "<question_generation>" in prompt)
    assert "topic_materials" in initial_prompt and "assignment" in initial_prompt
    assert '"material_type": "assignment"' in question_prompt
