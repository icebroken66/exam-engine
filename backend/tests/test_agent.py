from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.main import get_model_gateway
from app.model_gateway import MockProvider, ModelGateway
from app.worker import run_next_task
from test_sources import create_course, upload


def parsed_evidence(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> tuple[str, str]:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=b"# Chapter\n\nPV operation evidence.").json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    evidence_id = client.get(f"/api/sources/{source_id}/evidence").json()[0]["id"]
    return course_id, evidence_id


def use_mock(client: TestClient, budget: int = 20_000) -> None:
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(
        MockProvider(), course_token_budget=budget,
    )


def test_agent_explanation_is_mocked_cited_and_recorded(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, evidence_id = parsed_evidence(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/agent/explain", json={
        "evidence_id": evidence_id,
        "focus": "解释基本概念",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mocked"] is True and body["provider"] == "mock"
    assert body["evidence_id"] == evidence_id
    assert body["summary"].startswith("Mock 讲解")
    assert body["key_points"]

    usage = client.get(f"/api/courses/{course_id}/usage")
    assert usage.status_code == 200
    assert usage.json()["mocked"] is True
    assert usage.json()["course_used_tokens"] > 0
    assert usage.json()["course_remaining_tokens"] < 20_000
    assert len(usage.json()["records"]) == 1
    assert usage.json()["records"][0]["purpose"] == "evidence_explanation"
    assert usage.json()["records"][0]["status"] == "succeeded"


def test_agent_rejects_evidence_outside_course(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    _, evidence_id = parsed_evidence(client, session_factory, tmp_path)
    other_course = create_course(client, "另一门课")
    response = client.post(f"/api/courses/{other_course}/agent/explain", json={"evidence_id": evidence_id})
    assert response.status_code == 404
    assert client.get(f"/api/courses/{other_course}/usage").json()["records"] == []


def test_agent_budget_denial_does_not_create_successful_usage(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client, budget=1)
    course_id, evidence_id = parsed_evidence(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/agent/explain", json={"evidence_id": evidence_id})
    assert response.status_code == 429
    usage = client.get(f"/api/courses/{course_id}/usage").json()
    assert usage["course_used_tokens"] == 0 and usage["records"] == []


def test_agent_solves_question_with_server_side_citations(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = parsed_evidence(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/agent/solve", json={
        "question": "PV operation 的基本规则是什么？",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mocked"] is True
    assert body["answer"].startswith("依据当前课程资料")
    assert "PV operation evidence." in body["answer"]
    assert len(body["steps"]) == 3 and body["knowledge_points"] == ["Chapter"]
    assert len(body["citations"]) == 1
    citation = body["citations"][0]
    evidence_ids = {item["id"] for item in client.get(f"/api/sources/{citation['source_id']}/evidence").json()}
    assert citation["evidence_id"] in evidence_ids
    assert citation["source_name"] == "notes.md"
    assert body["citations"][0]["relevance"] > 0
    usage = client.get(f"/api/courses/{course_id}/usage").json()["records"]
    assert len(usage) == 1 and usage[0]["purpose"] == "question_solving"


def test_agent_rejects_unmatched_question_without_model_usage(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id, _ = parsed_evidence(client, session_factory, tmp_path)
    response = client.post(f"/api/courses/{course_id}/agent/solve", json={
        "question": "请计算热力学第二定律的熵变",
    })
    assert response.status_code == 422
    assert "没有检索到" in response.json()["detail"]
    assert client.get(f"/api/courses/{course_id}/usage").json()["records"] == []


def test_agent_solve_requires_course_evidence(client: TestClient) -> None:
    use_mock(client)
    course_id = create_course(client)
    response = client.post(f"/api/courses/{course_id}/agent/solve", json={"question": "什么是死锁？"})
    assert response.status_code == 409
    assert client.get(f"/api/courses/{course_id}/usage").json()["records"] == []


def test_agent_solves_chinese_question_from_matching_course_material(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    use_mock(client)
    course_id = create_course(client)
    source_id = upload(
        client,
        course_id,
        content=(
            "# 死锁\n\n死锁是一组进程互相等待而无法继续推进。"
            "\n\n死锁产生的必要条件包括互斥、占有且等待、不可剥夺和循环等待。"
        ).encode(),
    ).json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
    response = client.post(f"/api/courses/{course_id}/agent/solve", json={
        "question": "什么是死锁？产生死锁需要满足哪些必要条件？",
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert "互斥" in body["answer"] and "循环等待" in body["answer"]
    assert body["citations"][0]["node_title"] == "死锁"
    assert body["knowledge_points"] == ["死锁"]
