from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.worker import run_next_task
from test_sources import create_course, upload


def evidence_for_course(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> tuple[str, str]:
    course_id = create_course(client)
    source_id = upload(
        client,
        course_id,
        content="# 死锁\n\n死锁需要互斥、占有且等待、不可剥夺和循环等待四个必要条件。".encode(),
    ).json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    evidence_id = client.get(f"/api/sources/{source_id}/evidence").json()[0]["id"]
    return course_id, evidence_id


def question_payload(evidence_id: str) -> dict:
    return {
        "stem": "产生死锁需要哪些必要条件？",
        "question_type": "short_answer",
        "answer": "互斥、占有且等待、不可剥夺和循环等待。",
        "analysis": "四个条件需同时成立。",
        "knowledge_points": ["死锁", "死锁", " 必要条件 "],
        "provenance": "original",
        "origin_year": 2025,
        "evidence_ids": [evidence_id, evidence_id],
    }


def test_question_create_is_structured_sourced_and_versioned(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "draft" and body["version"] == 1
    assert body["knowledge_points"] == ["死锁", "必要条件"]
    assert body["provenance"] == "original" and body["origin_year"] == 2025
    assert len(body["citations"]) == 1
    assert body["citations"][0]["evidence_id"] == evidence_id
    assert body["citations"][0]["source_name"] == "notes.md"
    listed = client.get(f"/api/courses/{course_id}/questions")
    assert listed.status_code == 200 and [item["id"] for item in listed.json()] == [body["id"]]
    revisions = client.get(f"/api/questions/{body['id']}/revisions").json()
    assert len(revisions) == 1
    assert revisions[0]["snapshot"]["evidence_ids"] == [evidence_id]


def test_question_edit_resets_review_and_preserves_history(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = client.post(
        f"/api/courses/{course_id}/questions", json=question_payload(evidence_id),
    ).json()
    update = {
        **question_payload(evidence_id),
        "answer": "互斥、占有且等待、不可剥夺、循环等待，四者缺一不可。",
        "expected_version": 1,
        "change_note": "人工补充四个条件缺一不可",
    }
    edited = client.put(f"/api/questions/{question['id']}", json=update)
    assert edited.status_code == 200, edited.text
    assert edited.json()["version"] == 2 and edited.json()["status"] == "draft"
    reviewed = client.post(f"/api/questions/{question['id']}/review", json={
        "expected_version": 2,
        "change_note": "已对照课程原文",
    })
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "verified" and reviewed.json()["version"] == 3
    assert reviewed.json()["reviewed_at"] is not None

    reedited = client.put(f"/api/questions/{question['id']}", json={
        **update,
        "analysis": "预防死锁可破坏至少一个必要条件。",
        "expected_version": 3,
        "change_note": "补充预防思路",
    })
    assert reedited.status_code == 200
    assert reedited.json()["status"] == "draft" and reedited.json()["reviewed_at"] is None
    revisions = client.get(f"/api/questions/{question['id']}/revisions").json()
    assert [item["version"] for item in revisions] == [4, 3, 2, 1]
    assert revisions[0]["snapshot"]["analysis"] == "预防死锁可破坏至少一个必要条件。"


def test_question_rejects_stale_edit(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id)).json()
    response = client.put(f"/api/questions/{question['id']}", json={
        **question_payload(evidence_id),
        "expected_version": 2,
        "change_note": "过期编辑",
    })
    assert response.status_code == 409
    assert len(client.get(f"/api/questions/{question['id']}/revisions").json()) == 1


def test_question_rejects_evidence_from_another_course(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    _, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    other_course = create_course(client, "另一门课")
    response = client.post(f"/api/courses/{other_course}/questions", json=question_payload(evidence_id))
    assert response.status_code == 422
    assert client.get(f"/api/courses/{other_course}/questions").json() == []
