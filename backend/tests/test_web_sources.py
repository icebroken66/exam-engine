import json
import socket

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.main import get_model_gateway, get_web_service
from app.model_gateway import ModelGateway, MockProvider, ProviderReply, TokenUsage
from app.models import ParseTask
from app.web_sources import WebSourceError, WebSourceService
from app.worker import run_next_task
from test_agent import use_mock
from test_sources import create_course, upload


RSS = b"""<?xml version="1.0" encoding="utf-8"?>
<rss><channel><item>
<title>Data model constraints</title>
<link>https://93.184.216.34/data-model</link>
<description>Data structure, operations and constraints.</description>
</item></channel></rss>"""

HTML = b"""<!doctype html><html><head><title>Ignored</title>
<script>not course evidence</script><style>also ignored</style></head>
<body><article><h1>Data model</h1>
<p>A data model defines data structures, permitted operations and consistency constraints.</p>
<p>Constraints are rules that valid database states must satisfy.</p>
</article></body></html>"""


def public_dns(*args, **kwargs):
    del args, kwargs
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]


def prepare_anchor(client: TestClient, session_factory: sessionmaker, tmp_path) -> str:
    course_id = create_course(client, "数据库基础")
    upload(
        client,
        course_id,
        content="# 数据模型\n\n数据模型由数据结构、数据操作和约束条件组成。".encode(),
        name="数据模型.md",
    )
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads")
    return course_id


def test_web_search_requires_course_anchor_and_does_not_search(client: TestClient) -> None:
    class UnexpectedService:
        def search(self, query: str):
            raise AssertionError(f"不应搜索：{query}")

    client.app.dependency_overrides[get_web_service] = lambda: UnexpectedService()
    course_id = create_course(client)
    response = client.post(f"/api/courses/{course_id}/web/search", json={"query": "数据模型 三要素"})
    assert response.status_code == 409
    assert "资料锚点" in response.json()["detail"]


def test_web_search_parses_public_results(
    client: TestClient, session_factory: sessionmaker, tmp_path, monkeypatch,
) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", public_dns)
    course_id = prepare_anchor(client, session_factory, tmp_path)

    requested_hosts = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_hosts.append(request.url.host)
        assert request.url.params["q"] == '"数据模型" "数据约束条件"'
        assert request.url.params["format"] == "rss"
        if request.url.host == "www.bing.com":
            return httpx.Response(302, headers={"location": str(request.url.copy_with(host="cn.bing.com"))})
        return httpx.Response(200, content=RSS)

    service = WebSourceService(transport=httpx.MockTransport(handler))
    client.app.dependency_overrides[get_web_service] = lambda: service
    response = client.post(
        f"/api/courses/{course_id}/web/search",
        json={"query": "数据模型 数据约束条件"},
    )
    assert response.status_code == 200, response.text
    assert requested_hosts == ["www.bing.com", "cn.bing.com"]
    assert response.json()["results"] == [{
        "title": "Data model constraints",
        "url": "https://93.184.216.34/data-model",
        "snippet": "Data structure, operations and constraints.",
        "assessment": None,
        "read_error": None,
    }]


def test_confirmed_web_import_preserves_provenance_and_queues_parsing(
    client: TestClient, session_factory: sessionmaker, tmp_path, monkeypatch,
) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", public_dns)
    course_id = prepare_anchor(client, session_factory, tmp_path)
    service = WebSourceService(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=HTML),
    ))
    client.app.dependency_overrides[get_web_service] = lambda: service
    response = client.post(
        f"/api/courses/{course_id}/web/import",
        json={"url": "https://93.184.216.34/data-model", "title": "数据模型公开补充"},
    )
    assert response.status_code == 201, response.text
    source = response.json()["source"]
    assert source["status"] == "queued"
    assert source["relative_path"] == "网络补充/数据模型公开补充"
    assert source["origins"][0]["kind"] == "web"
    assert source["origins"][0]["path"] == "https://93.184.216.34/data-model"
    with session_factory() as db:
        assert db.scalar(select(ParseTask).where(ParseTask.source_id == source["id"])) is not None
        assert run_next_task(db, tmp_path / "uploads")
    downloaded = client.get(f"/api/sources/{source['id']}/file")
    assert "来源 URL：https://93.184.216.34/data-model" in downloaded.text
    assert "公开网络补充，不代表本校本专业考试要求" in downloaded.text
    assert "not course evidence" not in downloaded.text
    evidence = client.get(f"/api/sources/{source['id']}/evidence").json()
    assert any("Constraints are rules" in block["text"] for block in evidence)


def test_private_web_address_is_rejected_before_request() -> None:
    def unexpected(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"不应请求私网：{request.url}")

    service = WebSourceService(transport=httpx.MockTransport(unexpected))
    with pytest.raises(WebSourceError) as error:
        service.fetch("http://127.0.0.1/private")
    assert error.value.status_code == 422


def test_public_source_failure_is_not_silently_replaced(
    client: TestClient, session_factory: sessionmaker, tmp_path, monkeypatch,
) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", public_dns)
    course_id = prepare_anchor(client, session_factory, tmp_path)
    service = WebSourceService(transport=httpx.MockTransport(lambda request: httpx.Response(503)))
    client.app.dependency_overrides[get_web_service] = lambda: service
    response = client.post(
        f"/api/courses/{course_id}/web/import",
        json={"url": "https://93.184.216.34/unavailable"},
    )
    assert response.status_code == 502
    assert "503" in response.json()["detail"]
    assert len(client.get(f"/api/courses/{course_id}/sources").json()) == 1


def test_related_supplement_enters_existing_topic_evidence(
    client: TestClient, session_factory: sessionmaker, tmp_path,
) -> None:
    from app.learning_sessions import _evidence_rows, _topic_candidates

    course_id = prepare_anchor(client, session_factory, tmp_path)
    supplement = upload(
        client,
        course_id,
        content=(
            "# 公开网络补充\n\n数据模型的三要素包括数据结构、数据操作和数据的约束条件。"
            "数据约束条件是一组完整性规则，用于保证数据正确、有效和相容。"
        ).encode(),
        name="数据库系统基础知识公开补充.md",
    ).json()["source"]
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads")
        candidates = _topic_candidates(_evidence_rows(db, course_id))
    candidate = next(item for item in candidates if item["knowledge_point"] == "数据模型")
    assert supplement["id"] in {item["source_id"] for item in candidate["evidence"]}


def test_agent_research_explains_gap_and_assesses_without_auto_import(
    client: TestClient, session_factory: sessionmaker, tmp_path, monkeypatch,
) -> None:
    use_mock(client)
    monkeypatch.setattr(socket, "getaddrinfo", public_dns)
    course_id = prepare_anchor(client, session_factory, tmp_path)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.bing.com":
            return httpx.Response(200, content=RSS)
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=HTML)

    service = WebSourceService(transport=httpx.MockTransport(handler))
    client.app.dependency_overrides[get_web_service] = lambda: service
    response = client.post(
        f"/api/courses/{course_id}/web/research",
        json={"focus": "题目未通过质量验收：数据约束条件的答案缺少证据"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["query"] == "数据模型 定义 适用条件"
    assert "数据模型" in payload["evidence_needed"]
    assert payload["rationale"]
    assert payload["results"][0]["title"] == "Data model constraints"
    assessment = payload["results"][0]["assessment"]
    assert assessment["recommendation"] == "recommended"
    assert "Data model" in assessment["evidence_excerpt"]
    usage = client.get(f"/api/courses/{course_id}/usage").json()
    purposes = {record["purpose"] for record in usage["records"]}
    assert {"evidence_gap_research", "web_source_quality_assessment"} <= purposes
    assert len(client.get(f"/api/courses/{course_id}/sources").json()) == 1


class FabricatedAssessmentProvider(MockProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<source_quality_assessment>" in user_prompt:
            payload = json.loads(user_prompt.split("<source_quality_assessment>", 1)[1].split("</source_quality_assessment>", 1)[0])
            content = json.dumps({
                "assessments": [{
                    "url": payload["documents"][0]["url"],
                    "recommendation": "recommended",
                    "confidence": 0.99,
                    "reason": "伪装的推荐",
                    "evidence_excerpt": "这句话没有出现在候选正文中",
                }],
            }, ensure_ascii=False)
            return ProviderReply(content, TokenUsage(prompt_tokens=20, completion_tokens=10))
        return super().complete(system_prompt, user_prompt, max_tokens)


def test_fabricated_web_evidence_excerpt_is_rejected(
    client: TestClient, session_factory: sessionmaker, tmp_path, monkeypatch,
) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", public_dns)
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(FabricatedAssessmentProvider())
    course_id = prepare_anchor(client, session_factory, tmp_path)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.bing.com":
            return httpx.Response(200, content=RSS)
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=HTML)

    service = WebSourceService(transport=httpx.MockTransport(handler))
    client.app.dependency_overrides[get_web_service] = lambda: service
    response = client.post(f"/api/courses/{course_id}/web/research", json={})
    assert response.status_code == 502
    assert "伪造的正文摘录" in response.json()["detail"]
    assert len(client.get(f"/api/courses/{course_id}/sources").json()) == 1
