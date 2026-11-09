from datetime import datetime, timezone

from sqlalchemy import select

from app.models import DocumentNode, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, Source, UsageRecord
from test_questions import evidence_for_course, question_payload
from test_sources import create_course, upload


def saved_task(db, course, evidence, kind="diagnostic", **changes):
    session = LearningSession(course_id=course, stage="completed")
    db.add(session)
    db.flush()
    task = LearningTask(session_id=session.id, kind=kind, ordinal=1, knowledge_point="死锁", sub_skill="必要条件", question_type="short_answer", stem="条件？", options=[], reference_answer="四条件", remediation_answer="四条件", analysis="解释", evidence_ids=[evidence], provenance="original", validation_status="validated", status="answered")
    db.add(task)
    db.flush()
    values = dict(session_id=session.id, task_id=task.id, attempt_number=1, answer="回答", verdict="correct", grading_layer="evidence_model", confidence=0.95, feedback="反馈", missing_points=[], hints_used=0, provider="acceptance-fixture", model="not-a-real-call", mocked=False)
    values.update(changes)
    attempt = LearningAttempt(**values)
    db.add(attempt)
    db.commit()
    return task.id, attempt.id


def test_ledger_includes_late_and_empty_nodes_and_does_not_claim_understanding(client, session_factory, tmp_path):
    course, evidence = evidence_for_course(client, session_factory, tmp_path)
    client.post(f"/api/courses/{course}/questions", json=question_payload(evidence))
    with session_factory() as db:
        source = db.get(Source, db.get(EvidenceBlock, evidence).source_id)
        db.add_all([DocumentNode(id="late", source_id=source.id, title="后半章节", ordinal=99, page_start=99, page_end=99), DocumentNode(id="empty", source_id=source.id, title="空白页", ordinal=100, page_start=100, page_end=100)])
        db.flush()
        db.add(EvidenceBlock(id="late-block", source_id=source.id, node_id="late", ordinal=1, text="后半章节不能被抽样遗漏", content_hash="late"))
        db.commit()
        saved_task(db, course, evidence, verdict="incorrect")
        saved_task(db, course, evidence, kind="retest")
        before = (db.query(LearningAttempt).count(), db.query(UsageRecord).count(), db.query(LearningSession).count())
    result = client.get(f"/api/courses/{course}/coverage")
    assert result.status_code == 200, result.text
    body = result.json()
    rows = {row["node_id"]: row for row in body["units"]}
    assert body["unit_count"] == 3 and body["text_available_units"] == 2
    assert body["diagnostic_linked_units"] == body["retest_linked_units"] == 1
    assert rows["late"]["evidence"][0]["id"] == "late-block"
    assert rows["late"]["diagnostic_tasks"] == [] and rows["empty"]["text_status"] == "unavailable"
    assert all(row["semantic_status"] == "untracked" for row in rows.values())
    assert "reference_answer" not in str(body) and "未建立语义处理台账" in body["limitation"]
    assert client.get(f"/api/courses/{course}/coverage").json() == body
    with session_factory() as db:
        assert before == (db.query(LearningAttempt).count(), db.query(UsageRecord).count(), db.query(LearningSession).count())


def test_latest_grade_mock_hint_and_low_confidence_do_not_inflate_coverage(client, session_factory, tmp_path):
    course, evidence = evidence_for_course(client, session_factory, tmp_path)
    with session_factory() as db:
        task_id, _ = saved_task(db, course, evidence)
        db.add(LearningAttempt(session_id=db.get(LearningTask, task_id).session_id, task_id=task_id, attempt_number=2, answer="补充", verdict="ungraded", grading_layer="model_error", feedback="未判分", missing_points=[], provider="test", model="test", mocked=False))
        db.commit()
        saved_task(db, course, evidence, mocked=True)
        saved_task(db, course, evidence, confidence=0.5)
        saved_task(db, course, evidence, kind="retest", hints_used=1)
    body = client.get(f"/api/courses/{course}/coverage").json()
    assert body["diagnostic_linked_units"] == body["retest_linked_units"] == 0
    with session_factory() as db:
        task_id, attempt_id = saved_task(db, course, evidence, kind="retest")
        attempt = db.get(LearningAttempt, attempt_id)
        attempt.verdict = "incorrect"
        db.commit()
    assert client.get(f"/api/courses/{course}/coverage").json()["retest_linked_units"] == 0


def test_removed_foreign_and_missing_evidence_exclude_whole_task(client, session_factory, tmp_path):
    course, evidence = evidence_for_course(client, session_factory, tmp_path)
    other, foreign_evidence = evidence_for_course(client, session_factory, tmp_path)
    with session_factory() as db:
        task_id, _ = saved_task(db, course, evidence)
        db.get(LearningTask, task_id).evidence_ids = [evidence, foreign_evidence]
        missing_id, _ = saved_task(db, course, evidence)
        db.get(LearningTask, missing_id).evidence_ids = [evidence, "missing"]
        db.commit()
    assert client.get(f"/api/courses/{course}/coverage").json()["diagnostic_linked_units"] == 0
    with session_factory() as db:
        db.get(Source, db.get(EvidenceBlock, evidence).source_id).removed_at = datetime.now(timezone.utc)
        db.commit()
    body = client.get(f"/api/courses/{course}/coverage").json()
    assert body["source_count"] == body["unit_count"] == 0
    assert body["units"] == []
    assert client.get(f"/api/courses/{other}/coverage").json()["source_count"] == 1


def test_queued_source_without_nodes_stays_visible_and_unknown_course_is_404(client):
    course = create_course(client)
    upload(client, course, content=b"Queued source")
    body = client.get(f"/api/courses/{course}/coverage").json()
    assert body["source_count"] == body["unit_count"] == 1
    assert body["units"][0]["node_id"] is None
    assert body["units"][0]["source_status"] == "queued"
    assert body["text_available_units"] == body["diagnostic_linked_units"] == 0
    assert client.get("/api/courses/unknown/coverage").status_code == 404


def test_ledger_never_samples_away_units_after_48(client, session_factory, tmp_path):
    course, evidence = evidence_for_course(client, session_factory, tmp_path)
    with session_factory() as db:
        source_id = db.get(EvidenceBlock, evidence).source_id
        for ordinal in range(2, 62):
            db.add(DocumentNode(id=f"chapter-{ordinal}", source_id=source_id, title=f"Chapter {ordinal}", ordinal=ordinal, page_start=ordinal, page_end=ordinal))
        db.commit()
    body = client.get(f"/api/courses/{course}/coverage").json()
    assert body["unit_count"] == 61
    assert body["units"][-1]["node_id"] == "chapter-61"
    assert body["units"][-1]["diagnostic_tasks"] == []
