from sqlalchemy import select

from app.main import get_model_gateway
from app.model_gateway import ModelGateway, MockProvider
from app.models import LearningAttempt, LearningEvent, LearningSession, LearningTask, UsageRecord
from test_agent import use_mock
from test_learning_sessions import answer, advance, reference_answer, start
from test_questions import evidence_for_course


def guard(session):
    return {"expected_task_id": session["current_task"]["id"], "expected_progress_version": session["progress_version"]}


def test_old_tab_answer_and_hint_cannot_target_new_task_or_call_model(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    original = start(client, course)
    answer(client, original["id"], "不知道")
    remediation = advance(client, original["id"])
    practice = advance(client, original["id"])
    assert practice["current_task"]["id"] != original["current_task"]["id"]
    with session_factory() as db:
        calls = db.query(UsageRecord).count()
        attempts = db.query(LearningAttempt).count()
    rejected = client.post(f"/api/learning-sessions/{original['id']}/attempts", json={
        **guard(original), "answer": "这是旧题的答案", "duration_seconds": 12,
    })
    assert rejected.status_code == 409
    assert "进度已变化" in rejected.json()["detail"]
    assert client.post(f"/api/learning-sessions/{original['id']}/hints", json=guard(original)).status_code == 409
    assert client.post(f"/api/learning-sessions/{original['id']}/next", json=guard(remediation)).status_code == 409
    with session_factory() as db:
        assert db.query(UsageRecord).count() == calls
        assert db.query(LearningAttempt).count() == attempts
    assert client.get(f"/api/learning-sessions/{original['id']}").json()["current_task"]["id"] == practice["current_task"]["id"]


def test_same_task_stage_change_rejects_repeated_next_without_model(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    initial = start(client, course)
    graded = answer(client, initial["id"], "不知道")
    next_url = f"/api/learning-sessions/{initial['id']}/next"
    result = client.post(next_url, json=guard(graded))
    assert result.status_code == 200
    assert result.json()["stage"] == "remediating"
    assert result.json()["current_task"]["id"] == graded["current_task"]["id"]
    with session_factory() as db:
        calls = db.query(UsageRecord).count()
    assert client.post(next_url, json=guard(graded)).status_code == 409
    with session_factory() as db:
        assert db.query(UsageRecord).count() == calls


def test_model_grade_returning_after_progress_change_cannot_overwrite_current_state(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course)
    with session_factory() as db:
        db.get(LearningTask, session["current_task"]["id"]).question_type = "short_answer"
        db.commit()

    class ChangeDuringGrading(MockProvider):
        def complete(self, system_prompt, user_prompt, max_tokens):
            if "<grading>" in user_prompt:
                with session_factory() as db:
                    db.get(LearningSession, session["id"]).stage = "remediating"
                    db.commit()
            return super().complete(system_prompt, user_prompt, max_tokens)

    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(ChangeDuringGrading())
    response = client.post(f"/api/learning-sessions/{session['id']}/attempts", json={
        **guard(session), "answer": "互斥、占有且等待、不可剥夺和循环等待。", "duration_seconds": 12,
    })
    assert response.status_code == 409, response.text
    with session_factory() as db:
        assert db.query(LearningAttempt).count() == 0
        assert db.get(LearningSession, session["id"]).stage == "remediating"
        assert db.scalar(select(UsageRecord).where(UsageRecord.purpose == "open_answer_grading")).status == "succeeded"


def test_generated_question_is_not_published_if_progress_changes_during_validation(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course)
    answer(client, session["id"], "不知道")
    remediation = advance(client, session["id"])

    class ChangeDuringValidation(MockProvider):
        def complete(self, system_prompt, user_prompt, max_tokens):
            if "<question_validation>" in user_prompt:
                with session_factory() as db:
                    db.get(LearningSession, session["id"]).stage = "blocked"
                    db.commit()
            return super().complete(system_prompt, user_prompt, max_tokens)

    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(ChangeDuringValidation())
    result = client.post(f"/api/learning-sessions/{session['id']}/next", json=guard(remediation))
    assert result.status_code == 409, result.text
    with session_factory() as db:
        assert db.query(LearningTask).count() == 1
        assert db.get(LearningSession, session["id"]).stage == "blocked"


def test_current_progress_read_is_repeatable_and_does_not_generate_or_write(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course)
    with session_factory() as db:
        before = (db.query(UsageRecord).count(), db.query(LearningEvent).count(), db.query(LearningTask).count())
    for _ in range(3):
        response = client.get(f"/api/courses/{course}/learning-sessions/current")
        assert response.status_code == 200
        assert response.json()["progress_version"] == session["progress_version"]
    with session_factory() as db:
        assert (db.query(UsageRecord).count(), db.query(LearningEvent).count(), db.query(LearningTask).count()) == before


def test_hint_updates_progress_version_and_matching_snapshot_can_submit(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    session = start(client, course)
    hint = client.post(f"/api/learning-sessions/{session['id']}/hints", json=guard(session))
    assert hint.status_code == 200
    updated = hint.json()["session"]
    assert updated["progress_version"] != session["progress_version"]
    response = client.post(f"/api/learning-sessions/{session['id']}/attempts", json={
        **guard(updated), "answer": reference_answer(session_factory, session), "duration_seconds": 15,
    })
    assert response.status_code == 200, response.text
    assert response.json()["current_task"]["latest_attempt"]["hints_used"] == 1


def test_first_question_failure_can_retry_same_round_and_running_work_is_not_replayed(client, session_factory, tmp_path):
    from test_learning_sessions import RejectingValidatorProvider
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(RejectingValidatorProvider())
    failed = client.post(f"/api/courses/{course}/learning-sessions")
    assert failed.status_code == 502
    current = client.get(f"/api/courses/{course}/learning-sessions/current").json()
    assert current["current_task"] is None
    with session_factory() as db:
        usage = db.scalar(select(UsageRecord).where(UsageRecord.course_id == course).limit(1))
        usage_id = usage.id
        usage.status = "running"
        db.commit()
    use_mock(client)
    assert client.post(f"/api/courses/{course}/learning-sessions").status_code == 409
    with session_factory() as db:
        db.get(UsageRecord, usage_id).status = "succeeded"
        db.commit()
    restored = client.post(f"/api/courses/{course}/learning-sessions")
    assert restored.status_code == 200, restored.text
    assert restored.json()["id"] == current["id"]
    assert restored.json()["current_task"] is not None
    with session_factory() as db:
        assert db.query(LearningSession).count() == 1
        assert db.query(LearningTask).count() == 1
