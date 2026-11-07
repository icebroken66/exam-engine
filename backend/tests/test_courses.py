from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.models import (
    Course, DocumentNode, EvidenceBlock, KnowledgePoint, LearningAttempt, LearningEvent,
    LearningPointState, LearningSession, LearningTask, ParseTask, Question, QuestionEvidence,
    QuestionKnowledgePoint, QuestionRevision, Source, SourceOrigin, UsageRecord,
)
from test_agent import use_mock
from test_questions import evidence_for_course, question_payload
from test_sources import create_course, upload


def test_course_archive_restore_and_default_filter(client: TestClient) -> None:
    course_id = create_course(client)
    archived = client.patch(f"/api/courses/{course_id}/archive", json={"archived": True})
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert client.get("/api/courses").json() == []
    included = client.get("/api/courses?include_archived=true").json()
    assert [course["id"] for course in included] == [course_id]

    restored = client.patch(f"/api/courses/{course_id}/archive", json={"archived": False})
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert [course["id"] for course in client.get("/api/courses").json()] == [course_id]
    assert client.patch("/api/courses/missing/archive", json={"archived": True}).status_code == 404


def test_delete_requires_exact_name_and_waits_for_active_parse(client: TestClient, tmp_path: Path) -> None:
    course_id = create_course(client, "待删除课程")
    upload(client, course_id)
    stored_files = list((tmp_path / "uploads").iterdir())

    mismatch = client.request("DELETE", f"/api/courses/{course_id}", json={"confirmation": "错误名称"})
    assert mismatch.status_code == 422
    active = client.request("DELETE", f"/api/courses/{course_id}", json={"confirmation": "待删除课程"})
    assert active.status_code == 409
    assert client.get(f"/api/courses/{course_id}").status_code == 200
    assert all(file.exists() for file in stored_files)


def test_permanent_delete_removes_all_course_data_and_files(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id))
    assert question.status_code == 201
    session = client.post(f"/api/courses/{course_id}/learning-sessions")
    assert session.status_code == 200
    answered = client.post(f"/api/learning-sessions/{session.json()['id']}/attempts", json={
        "answer": "错误",
        "duration_seconds": 5,
    })
    assert answered.status_code == 200
    stored_files = list((tmp_path / "uploads").iterdir())
    assert stored_files

    deleted = client.request("DELETE", f"/api/courses/{course_id}", json={"confirmation": "操作系统原理"})
    assert deleted.status_code == 204, deleted.text
    assert deleted.content == b""
    assert client.get(f"/api/courses/{course_id}").status_code == 404
    assert all(not file.exists() for file in stored_files)
    assert client.request("DELETE", f"/api/courses/{course_id}", json={"confirmation": "操作系统原理"}).status_code == 404

    models = (
        Course, Source, SourceOrigin, ParseTask, DocumentNode, EvidenceBlock, UsageRecord,
        Question, QuestionEvidence, QuestionRevision, KnowledgePoint, QuestionKnowledgePoint,
        LearningSession, LearningTask, LearningAttempt, LearningPointState, LearningEvent,
    )
    with session_factory() as db:
        assert all(db.scalar(select(func.count(model.id))) == 0 for model in models)
