from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.worker import run_next_task
from app.models import Question
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
    assert edited.json()["answer_provenance"] == "human"
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


def test_ai_answer_edit_becomes_human_and_ai_acceptance_stays_unconfirmed(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    payload = question_payload(evidence_id)
    question = client.post(f"/api/courses/{course_id}/questions", json=payload).json()
    with session_factory() as db:
        row = db.get(Question, question["id"])
        row.answer_provenance = "ai"
        row.status = "verified"
        db.commit()
    auto = client.get(f"/api/courses/{course_id}/questions").json()[0]
    assert auto["status"] == "verified" and auto["reviewed_at"] is None
    edited = client.put(f"/api/questions/{question['id']}", json={
        **payload, "options": ["互斥", "占有且等待"], "expected_version": 1,
        "change_note": "只修订选项，答案来源仍为 AI",
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["answer_provenance"] == "ai"
    assert edited.json()["options"] == ["互斥", "占有且等待"]
    rewritten = client.put(f"/api/questions/{question['id']}", json={
        **payload, "answer": "人工核对后的四个必要条件：互斥、占有且等待、不可剥夺、循环等待。",
        "expected_version": 2, "change_note": "人工改写参考答案",
    })
    assert rewritten.status_code == 200
    assert rewritten.json()["answer_provenance"] == "human" and rewritten.json()["reviewed_at"] is None
    review = client.post(f"/api/questions/{question['id']}/review", json={
        "expected_version": 3, "change_note": "对照原件确认题目与答案",
    })
    assert review.status_code == 200 and review.json()["reviewed_at"] is not None
    snapshots = client.get(f"/api/questions/{question['id']}/revisions").json()
    assert snapshots[0]["snapshot"]["reviewed_at"].replace("+00:00", "Z") == review.json()["reviewed_at"]
    assert snapshots[1]["snapshot"]["reviewed_at"] is None


def test_partial_human_review_does_not_publish_until_both_parts_confirmed(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    payload = question_payload(evidence_id)
    question = client.post(f"/api/courses/{course_id}/questions", json=payload).json()
    url = f"/api/questions/{question['id']}/review"
    stem = client.post(url, json={"expected_version": 1, "scope": "stem"})
    assert stem.status_code == 200, stem.text
    assert stem.json()["stem_reviewed_at"] is not None
    assert stem.json()["answer_reviewed_at"] is None
    assert stem.json()["reviewed_at"] is None and stem.json()["status"] == "draft"
    assert client.post(url, json={"expected_version": 1, "scope": "answer"}).status_code == 409
    answer = client.post(url, json={"expected_version": 2, "scope": "answer"})
    assert answer.status_code == 200, answer.text
    assert answer.json()["answer_reviewed_at"] is not None
    assert answer.json()["stem_reviewed_at"].rstrip("Z") == stem.json()["stem_reviewed_at"].rstrip("Z")
    assert answer.json()["reviewed_at"] is not None and answer.json()["status"] == "verified"
    assert answer.json()["answer_provenance"] == "source"
    snapshots = client.get(f"/api/questions/{question['id']}/revisions").json()
    assert snapshots[1]["snapshot"]["answer_reviewed_at"] is None
    assert snapshots[1]["change_note"] == "人工确认题干与选项"
    edit = client.put(f"/api/questions/{question['id']}", json={
        **payload, "expected_version": 3, "analysis": "重新修订解析", "change_note": "解析修订需重新核对",
    })
    assert edit.status_code == 200
    assert edit.json()["stem_reviewed_at"] is None and edit.json()["answer_reviewed_at"] is None
    assert edit.json()["reviewed_at"] is None and edit.json()["status"] == "draft"


def test_stem_can_be_confirmed_without_answer_but_answer_cannot(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id)).json()
    with session_factory() as db:
        row = db.get(Question, question["id"])
        row.answer = ""
        row.answer_provenance = "missing"
        db.commit()
    url = f"/api/questions/{question['id']}/review"
    stem = client.post(url, json={"expected_version": 1, "scope": "stem"})
    assert stem.status_code == 200
    for scope in ["answer", "all"]:
        assert client.post(url, json={"expected_version": 2, "scope": scope}).status_code == 422
    assert len(client.get(f"/api/questions/{question['id']}/revisions").json()) == 2


def test_ai_validated_answer_keeps_its_provenance_after_partial_human_review(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = client.post(f"/api/courses/{course_id}/questions", json=question_payload(evidence_id)).json()
    with session_factory() as db:
        row = db.get(Question, question["id"])
        row.status = "verified"
        row.answer_provenance = "ai"
        db.commit()
    reviewed = client.post(f"/api/questions/{question['id']}/review", json={"expected_version": 1, "scope": "answer"})
    assert reviewed.status_code == 200
    body = reviewed.json()
    assert body["status"] == "verified" and body["reviewed_at"] is None
    assert body["stem_reviewed_at"] is None and body["answer_reviewed_at"] is not None
    assert body["answer_provenance"] == "ai"
