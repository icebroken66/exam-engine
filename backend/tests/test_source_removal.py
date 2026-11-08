from sqlalchemy import select

from app.learning_sessions import _course_candidates
from app.models import EvidenceBlock, LearningAttempt, LearningSession, LearningTask, ParseTask, Question, Source
from app.worker import run_next_task
from test_agent import use_mock
from test_learning_sessions import start
from test_questions import evidence_for_course, question_payload
from test_sources import create_course, upload


def remove(client, source_id, signature=None):
    impact = client.get(f"/api/sources/{source_id}/removal-impact").json()
    return client.request("DELETE", f"/api/sources/{source_id}", json={
        "expected_signature": signature or impact["signature"],
    })


def source_for(session_factory, evidence_id):
    with session_factory() as db:
        return db.get(EvidenceBlock, evidence_id).source_id


def test_removal_excludes_inputs_and_manual_questions_but_preserves_originals(client, session_factory, tmp_path):
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    question = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id)).json()
    client.post(f"/api/questions/{question['id']}/review", json={"expected_version": 1})
    preview = client.get(f"/api/sources/{source_id}/removal-impact").json()
    assert preview["question_count"] == 1 and preview["evidence_count"] > 0
    assert remove(client, source_id).status_code == 200
    assert client.get(f"/api/courses/{course_id}/sources").json() == []
    assert client.get(f"/api/courses/{course_id}/questions").json() == []
    assert client.get(f"/api/courses/{course_id}/completeness").json()["total_sources"] == 0
    assert client.get(f"/api/courses/{course_id}/learning-context").json()["can_start"] is False
    analytics = client.get(f"/api/courses/{course_id}/analytics").json()
    assert analytics["verified_question_count"] == 0
    assert client.get(f"/api/sources/{source_id}/file").status_code == 200
    assert len(client.get(f"/api/questions/{question['id']}/revisions").json()) == 2
    assert client.post(f"/api/questions/{question['id']}/review", json={"expected_version": 2}).status_code == 409
    assert client.post(f"/api/sources/{source_id}/parse").status_code == 404
    assert remove(client, source_id).status_code == 200  # retry is idempotent


def test_removing_queued_input_stops_worker_and_reupload_restores_same_source(client, session_factory, tmp_path):
    course_id = create_course(client)
    original = upload(client, course_id).json()["source"]
    assert remove(client, original["id"]).status_code == 200
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads") is False
    restored = upload(client, course_id).json()
    assert restored["deduplicated"] and restored["source"]["id"] == original["id"]
    assert restored["source"]["removed_at"] is None and restored["source"]["status"] == "queued"
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads") is True


def test_removal_rechecks_impact_and_rejects_running_parse(client, session_factory, tmp_path):
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    stale = client.get(f"/api/sources/{source_id}/removal-impact").json()["signature"]
    client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id))
    assert remove(client, source_id, stale).status_code == 409
    with session_factory() as db:
        db.get(Source, source_id).status = "running"
        db.commit()
    assert remove(client, source_id).status_code == 409
    with session_factory() as db:
        assert db.get(Source, source_id).removed_at is None


def test_pending_question_is_withdrawn_and_replanned_using_remaining_material(client, session_factory, tmp_path):
    use_mock(client)
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    session = start(client, course_id)
    old_id = session["current_task"]["id"]
    other = upload(client, course_id, content="# 分页\n\n分页将虚拟地址分成页号和页内偏移，通过页表映射到物理页框。".encode(), name="分页.md").json()["source"]
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    assert remove(client, source_id).status_code == 200
    current = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert current["stage"] == "blocked" and current["current_task"]["source_removed"]
    assert client.post(f"/api/learning-sessions/{session['id']}/hints").status_code == 409
    assert client.post(f"/api/learning-sessions/{session['id']}/attempts", json={"answer": "测试作答", "duration_seconds": 1}).status_code == 409
    advanced = client.post(f"/api/learning-sessions/{session['id']}/next")
    assert advanced.status_code == 200, advanced.text
    assert advanced.json()["current_task"]["id"] != old_id
    assert not advanced.json()["current_task"]["source_removed"]
    with session_factory() as db:
        old = db.get(LearningTask, old_id)
        assert old.status == "withdrawn"
        assert all(e["source_id"] == other["id"] for c in _course_candidates(db, course_id) for e in c["evidence"])


def test_last_input_removal_keeps_answer_history_and_reupload_reuses_ready_results(client, session_factory, tmp_path):
    use_mock(client)
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    session = start(client, course_id)
    result = client.post(f"/api/learning-sessions/{session['id']}/attempts", json={"answer": "互斥、占有且等待、不可剥夺和循环等待。", "duration_seconds": 10})
    assert result.status_code == 200, result.text
    with session_factory() as db:
        attempt = db.scalar(select(LearningAttempt).where(LearningAttempt.session_id == session["id"]))
        saved = {c.key: getattr(attempt, c.key) for c in LearningAttempt.__table__.columns}
        evidence_ids = list(db.scalars(select(EvidenceBlock.id).where(EvidenceBlock.source_id == source_id)))
    assert remove(client, source_id).status_code == 200
    assert client.post(f"/api/learning-sessions/{session['id']}/next").status_code == 409
    current = client.get(f"/api/learning-sessions/{session['id']}").json()
    assert current["current_task"]["latest_attempt"] is not None
    assert current["current_task"]["source_removed"]
    restored = upload(client, course_id, content="# 死锁\n\n死锁需要互斥、占有且等待、不可剥夺和循环等待四个必要条件。".encode()).json()
    assert restored["source"]["id"] == source_id and restored["source"]["status"] == "ready"
    with session_factory() as db:
        attempt = db.get(LearningAttempt, saved["id"])
        assert {c.key: getattr(attempt, c.key) for c in LearningAttempt.__table__.columns} == saved
        assert list(db.scalars(select(EvidenceBlock.id).where(EvidenceBlock.source_id == source_id))) == evidence_ids


def test_completed_round_with_legacy_current_pointer_is_not_reopened(client, session_factory, tmp_path):
    use_mock(client)
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    session = start(client, course_id)
    with session_factory() as db:
        db.get(LearningSession, session["id"]).stage = "completed"
        task = db.get(LearningTask, session["current_task"]["id"])
        original_status = task.status
        db.commit()
    impact = client.get(f"/api/sources/{source_id}/removal-impact").json()
    assert impact["pending_task_count"] == 0
    assert remove(client, source_id).status_code == 200
    with session_factory() as db:
        assert db.get(LearningSession, session["id"]).stage == "completed"
        assert db.get(LearningTask, session["current_task"]["id"]).status == original_status


def test_question_with_mixed_sources_stops_until_all_anchors_restored(client, session_factory, tmp_path):
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    source_id = source_for(session_factory, evidence_id)
    other = upload(client, course_id, content="# 并发\n\n并发访问临界资源需要互斥控制。".encode(), name="并发.md").json()["source"]
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    other_evidence = client.get(f"/api/sources/{other['id']}/evidence").json()[0]["id"]
    payload = {**question_payload(evidence_id), "evidence_ids": [evidence_id, other_evidence]}
    question = client.post(f"/api/courses/{course_id}/questions", json=payload).json()
    client.post(f"/api/questions/{question['id']}/review", json={"expected_version": 1})
    assert remove(client, source_id).status_code == 200
    assert len(client.get(f"/api/courses/{course_id}/sources").json()) == 1
    assert client.get(f"/api/courses/{course_id}/questions").json() == []
    assert client.get(f"/api/courses/{course_id}/knowledge-points").json() == []
    with session_factory() as db:
        assert db.get(Question, question["id"]).status == "verified"
        assert db.get(Source, other["id"]).removed_at is None
