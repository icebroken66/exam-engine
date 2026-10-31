from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.models import QuestionKnowledgePoint
from test_questions import evidence_for_course, question_payload
from test_sources import create_course


def create_question(
    client: TestClient,
    course_id: str,
    evidence_id: str,
    *,
    points: list[str],
    year: int | None,
    question_type: str = "short_answer",
    provenance: str = "original",
) -> dict:
    payload = {
        **question_payload(evidence_id),
        "knowledge_points": points,
        "origin_year": year,
        "question_type": question_type,
        "provenance": provenance,
    }
    response = client.post(f"/api/courses/{course_id}/questions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def verify(client: TestClient, question: dict) -> dict:
    response = client.post(f"/api/questions/{question['id']}/review", json={
        "expected_version": question["version"],
        "change_note": "统计测试校题",
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_analytics_uses_verified_original_questions_and_recomputable_decay(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    year = datetime.now(timezone.utc).year
    recent = create_question(client, course_id, evidence_id, points=["死锁", "进程"], year=year)
    older = create_question(client, course_id, evidence_id, points=["死锁"], year=year - 3)
    unknown = create_question(client, course_id, evidence_id, points=["缺年份"], year=None, question_type="calculation")
    for question in (recent, older, unknown):
        verify(client, question)
    create_question(client, course_id, evidence_id, points=["死锁"], year=year)  # draft: excluded
    adapted = create_question(
        client, course_id, evidence_id, points=["调度"], year=year, provenance="adapted",
    )
    verify(client, adapted)

    response = client.get(f"/api/courses/{course_id}/analytics?half_life_years=3")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["as_of_year"] == year and body["half_life_years"] == 3
    assert body["verified_question_count"] == 4
    assert body["included_original_question_count"] == 3
    assert body["draft_question_count"] == 1 and body["adapted_question_count"] == 1
    assert body["unknown_year_question_count"] == 1
    points = {item["name"]: item for item in body["knowledge_points"]}
    assert points["死锁"]["question_count"] == 2
    assert points["死锁"]["weighted_frequency"] == 1.5
    assert len(points["死锁"]["questions"]) == 2
    old = next(item for item in points["死锁"]["yearly_contributions"] if item["year"] == year - 3)
    assert old["decay_factor"] == 0.5 and old["weighted_count"] == 0.5
    assert points["缺年份"]["question_count"] == 1
    assert points["缺年份"]["weighted_frequency"] == 0
    assert points["缺年份"]["unknown_year_count"] == 1
    assert "调度" not in points
    types = {item["question_type"]: item for item in body["question_types"]}
    assert types["short_answer"]["question_count"] == 2
    assert types["short_answer"]["share"] == round(2 / 3, 6)
    assert types["calculation"]["question_count"] == 1


def test_fixed_knowledge_table_backfills_and_normalizes_names(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id, evidence_id = evidence_for_course(client, session_factory, tmp_path)
    question = create_question(
        client, course_id, evidence_id, points=["  Deadlock   Basics ", "deadlock basics"], year=None,
    )
    with session_factory() as db:
        db.query(QuestionKnowledgePoint).filter(QuestionKnowledgePoint.question_id == question["id"]).delete()
        db.commit()
    response = client.get(f"/api/courses/{course_id}/knowledge-points")
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Deadlock Basics"
    assert body[0]["normalized_name"] == "deadlock basics"


def test_analytics_empty_course_and_half_life_validation(client: TestClient) -> None:
    course_id = create_course(client)
    response = client.get(f"/api/courses/{course_id}/analytics")
    assert response.status_code == 200
    assert response.json()["included_original_question_count"] == 0
    assert response.json()["knowledge_points"] == [] and response.json()["question_types"] == []
    assert client.get(f"/api/courses/{course_id}/analytics?half_life_years=0").status_code == 422
