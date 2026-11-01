import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.learning_sessions import create_or_resume_session
from app.main import get_model_gateway
from app.model_gateway import ModelGateway, ModelProvider, ProviderReply, TokenUsage
from app.models import LearningAttempt
from test_agent import use_mock
from test_questions import evidence_for_course
from test_sources import create_course


ANSWER = "死锁需要互斥、占有且等待、不可剥夺和循环等待四个必要条件。"


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


def test_evidence_alone_starts_three_question_diagnostic_and_resumes(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)

    assert session["stage"] == "diagnosing"
    assert session["diagnostic_total"] == 3
    assert session["diagnostic_completed"] == 0
    assert session["current_task"]["question_type"] == "true_false"
    assert session["current_task"]["options"] == ["正确", "错误"]
    assert session["current_task"]["provenance"] == "generated"
    assert session["current_task"]["reference_answer"] is None
    assert session["current_task"]["citations"] == []
    assert start(client, course_id)["id"] == session["id"]

    answer(client, session["id"], "错误")
    second = advance(client, session["id"])
    assert second["current_task"]["question_type"] == "short_answer"
    assert second["current_task"]["latest_attempt"] is None


def test_mock_learning_loop_is_persistent_and_driven_by_attempts(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    session_id = session["id"]

    wrong = answer(client, session_id, "错误")
    attempt = wrong["current_task"]["latest_attempt"]
    assert attempt["verdict"] == "incorrect"
    assert attempt["grading_layer"] == "deterministic"
    assert attempt["provider"] == "deterministic" and attempt["mocked"] is False
    assert wrong["current_task"]["reference_answer"] == "正确"
    assert wrong["current_task"]["study_answer"] == ANSWER
    assert wrong["current_task"]["citations"][0]["source_name"] == "notes.md"

    advance(client, session_id)
    answer(client, session_id, ANSWER)
    advance(client, session_id)
    answer(client, session_id, ANSWER)
    diagnosed = advance(client, session_id)
    assert diagnosed["stage"] == "remediating"
    assert diagnosed["diagnostic_completed"] == 3
    assert diagnosed["current_task"]["knowledge_point"] == "死锁"
    assert "薄弱点" in diagnosed["agent_message"]
    assert any(point["status"] == "weak" for point in diagnosed["points"])

    practice = advance(client, session_id)
    assert practice["stage"] == "practicing"
    assert practice["current_task"]["kind"] == "practice"
    assert practice["current_task"]["reference_answer"] is None
    practice_graded = answer(client, session_id, ANSWER)
    assert practice_graded["current_task"]["reference_answer"] == ANSWER
    assert practice_graded["current_task"]["latest_attempt"]["verdict"] == "correct", practice_graded["current_task"]["latest_attempt"]
    retest = advance(client, session_id)
    assert retest["stage"] == "retesting"
    assert retest["current_task"]["kind"] == "retest"
    answer(client, session_id, ANSWER)
    completed = advance(client, session_id)

    assert completed["stage"] == "completed"
    assert completed["current_task"] is None
    assert completed["retest_passed"] == 1
    assert completed["practice_completed"] == 1
    assert start(client, course_id)["id"] == session_id
    restarted_response = client.post(f"/api/courses/{course_id}/learning-sessions?restart=true")
    assert restarted_response.status_code == 200
    assert restarted_response.json()["id"] != session_id
    assert restarted_response.json()["diagnostic_total"] == 3
    deadlock = next(point for point in completed["points"] if point["knowledge_point"] == "死锁")
    assert deadlock["status"] == "retest_passed"
    assert deadlock["evidence_count"] == 5
    kinds = {event["kind"] for event in completed["recent_events"]}
    assert {"weakness_identified", "practice_assigned", "retest_scheduled", "retest_passed", "plan_updated"} <= kinds

    restored_response = client.get(f"/api/learning-sessions/{session_id}")
    assert restored_response.status_code == 200
    restored = restored_response.json()
    assert restored["id"] == completed["id"]
    assert restored["stage"] == completed["stage"]
    assert [(point["knowledge_point"], point["status"], point["score"]) for point in restored["points"]] == [
        (point["knowledge_point"], point["status"], point["score"]) for point in completed["points"]
    ]
    assert [event["kind"] for event in restored["recent_events"]] == [
        event["kind"] for event in completed["recent_events"]
    ]
    with session_factory() as db:
        attempts = list(db.scalars(select(LearningAttempt).where(LearningAttempt.session_id == session_id)).all())
    assert len(attempts) == 5
    assert all(item.answer for item in attempts)
    open_attempts = [item for item in attempts if item.grading_layer == "evidence_model"]
    assert len(open_attempts) == 4
    assert all(item.mocked and item.usage_id for item in open_attempts)
    usage = client.get(f"/api/courses/{course_id}/usage").json()["records"]
    assert len(usage) == 4
    assert {record["purpose"] for record in usage} == {"open_answer_grading"}
    assert all(record["status"] == "succeeded" for record in usage)


def test_hint_is_recorded_on_next_attempt(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    hinted = client.post(f"/api/learning-sessions/{session['id']}/hints")
    assert hinted.status_code == 200
    assert hinted.json()["hint"]
    assert hinted.json()["session"]["recent_events"][-1]["kind"] == "hint_requested"
    graded = answer(client, session["id"], "错误")
    assert graded["current_task"]["latest_attempt"]["hints_used"] == 1


class LowConfidenceProvider(ModelProvider):
    name = "low-confidence-test"
    model = "low-confidence-v1"
    mocked = True

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
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
    answer(client, session["id"], "错误")
    advance(client, session["id"])
    graded = answer(client, session["id"], ANSWER)
    attempt = graded["current_task"]["latest_attempt"]
    assert attempt["verdict"] == "ungraded"
    assert attempt["confidence"] == 0.5
    assert graded["points"][0]["status"] == "needs_review"
    assert graded["retest_passed"] == 0
    assert "置信度不足" in graded["agent_message"]


def test_learning_session_rejects_missing_context_and_invalid_transitions(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    empty_course = create_course(client)
    assert start_empty(client, empty_course) == 409
    assert client.get("/api/learning-sessions/not-a-session").status_code == 404
    assert client.post("/api/courses/not-a-course/learning-sessions").status_code == 404

    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    session_id = session["id"]
    assert client.post(f"/api/learning-sessions/{session_id}/next").status_code == 409
    answer(client, session_id, "错误")
    duplicate = client.post(f"/api/learning-sessions/{session_id}/attempts", json={"answer": "正确"})
    assert duplicate.status_code == 409


def start_empty(client: TestClient, course_id: str) -> int:
    return client.post(f"/api/courses/{course_id}/learning-sessions").status_code


def test_resume_recovers_persisted_session_without_new_diagnostic(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course_id)
    answer(client, session["id"], "错误")
    with session_factory() as db:
        restored = create_or_resume_session(db, course_id)
    assert restored["id"] == session["id"]
    assert restored["diagnostic_completed"] == 1
    assert restored["current_task"]["latest_attempt"].answer == "错误"
