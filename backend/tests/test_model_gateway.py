import json

import httpx
from pydantic import BaseModel
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.model_gateway import (
    MockProvider, ModelError, ModelGateway, OpenAIProvider, ProviderReply, TokenUsage, VisionImage,
)
from app.models import Course, UsageRecord


class Explanation(BaseModel):
    summary: str
    key_points: list[str]


def course(db: Session) -> str:
    item = Course(school="测试学校", name="模型网关")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.id


def test_mock_gateway_validates_json_and_records_usage(session_factory: sessionmaker) -> None:
    gateway = ModelGateway(MockProvider(), input_usd_per_million=1, output_usd_per_million=2)
    with session_factory() as db:
        course_id = course(db)
        result, record = gateway.generate_json(
            db, course_id, "test", "system", "<evidence>第一段\n第二段</evidence>", Explanation,
        )
        assert result.summary.startswith("Mock 讲解")
        assert result.key_points == ["第一段", "第二段"]
        assert record.status == "succeeded"
        assert record.total_tokens > 0 and record.reserved_tokens == 0
        assert record.estimated_cost_usd > 0


def test_gateway_sends_exact_output_schema_to_provider(session_factory: sessionmaker) -> None:
    class CapturingProvider(MockProvider):
        prompt = ""

        def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
            self.prompt = user_prompt
            return super().complete(system_prompt, user_prompt, max_tokens)

    provider = CapturingProvider()
    gateway = ModelGateway(provider)
    with session_factory() as db:
        gateway.generate_json(db, course(db), "test", "system", "<evidence>内容</evidence>", Explanation)
        assert '"summary"' in provider.prompt
        assert '"key_points"' in provider.prompt
        assert "必须使用其中定义的字段名" in provider.prompt


def test_invalid_json_is_not_retried_and_failure_releases_reservation(session_factory: sessionmaker) -> None:
    class InvalidProvider(MockProvider):
        calls = 0

        def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
            self.calls += 1
            return ProviderReply("not-json", TokenUsage(10, 5))

    provider = InvalidProvider()
    gateway = ModelGateway(provider)
    with session_factory() as db:
        course_id = course(db)
        with pytest.raises(ModelError, match="结构化内容"):
            gateway.generate_json(db, course_id, "test", "system", "user", Explanation)
        assert provider.calls == 1
        record = db.scalar(select(UsageRecord))
        assert record.status == "failed" and record.total_tokens == 15
        assert record.reserved_tokens == 0


def test_legacy_positive_budget_environment_does_not_enable_local_limits(
    session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "mock")
    monkeypatch.delenv("MODEL_ENFORCE_TOKEN_BUDGET", raising=False)
    monkeypatch.setenv("MODEL_COURSE_TOKEN_BUDGET", "20000")
    monkeypatch.setenv("MODEL_DAILY_TOKEN_BUDGET", "200000")
    gateway = ModelGateway.from_env()
    assert gateway.course_token_budget is None
    assert gateway.daily_token_budget is None
    with session_factory() as db:
        course_id = course(db)
        gateway.generate_json(
            db, course_id, "test", "system", "<evidence>内容</evidence>", Explanation,
            max_tokens=1_000_000,
        )
        summary = gateway.usage_summary(db, course_id)
        assert summary["course_remaining_tokens"] is None
        assert summary["course_token_budget"] is None
        assert summary["daily_token_budget"] is None


def test_local_budget_requires_explicit_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODEL_PROVIDER", "mock")
    monkeypatch.setenv("MODEL_ENFORCE_TOKEN_BUDGET", "true")
    monkeypatch.setenv("MODEL_COURSE_TOKEN_BUDGET", "20000")
    monkeypatch.setenv("MODEL_DAILY_TOKEN_BUDGET", "200000")
    gateway = ModelGateway.from_env()
    assert gateway.course_token_budget == 20000
    assert gateway.daily_token_budget == 200000


def test_course_budget_stops_before_another_provider_call(session_factory: sessionmaker) -> None:
    class CountingProvider(MockProvider):
        calls = 0

        def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
            self.calls += 1
            return super().complete(system_prompt, user_prompt, max_tokens)

    provider = CountingProvider()
    gateway = ModelGateway(provider, course_token_budget=500)
    with session_factory() as db:
        course_id = course(db)
        gateway.generate_json(db, course_id, "test", "system", "<evidence>内容</evidence>", Explanation, max_tokens=50)
        with pytest.raises(ModelError) as error:
            gateway.generate_json(db, course_id, "test", "system", "user", Explanation, max_tokens=490)
        assert error.value.status_code == 429
        assert provider.calls == 1


def test_openai_compatible_retries_only_transient_failure() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["Authorization"] == "Bearer test-key"
        if calls == 1:
            return httpx.Response(500)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps({"summary": "摘要", "key_points": ["重点"]})}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8},
        })

    provider = OpenAIProvider("test-key", "https://api.example.com/v1", "test-model", httpx.MockTransport(handler))
    reply = provider.complete("system", "user", 100)
    assert calls == 2
    assert reply.usage.total_tokens == 20
    assert json.loads(reply.content)["summary"] == "摘要"


def test_openai_compatible_does_not_retry_client_rejection() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400, json={"error": "bad request"})

    provider = OpenAIProvider("test-key", "https://api.example.com/v1", "test-model", httpx.MockTransport(handler))
    with pytest.raises(ModelError, match="拒绝了请求"):
        provider.complete("system", "user", 100)
    assert calls == 1


def test_openai_compatible_uses_node_after_tls_connect_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("TLS handshake failed", request=request)

    def run(command: list[str], **kwargs: object) -> object:
        request = json.loads(kwargs["input"])
        assert request["api_key"] == "test-key"
        assert request["base_url"] == "https://api.example.com/v1"
        assert request["payload"]["model"] == "test-model"
        assert command[-1].endswith("openai_chat.mjs")
        stdout = json.dumps({
            "status": 200,
            "body": json.dumps({
                "choices": [{"message": {"content": json.dumps({"summary": "摘要", "key_points": ["重点"]})}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 8},
            }),
        })
        return type("Completed", (), {"returncode": 0, "stdout": stdout})()

    monkeypatch.setattr("app.model_gateway.subprocess.run", run)
    provider = OpenAIProvider("test-key", "https://api.example.com/v1", "test-model", httpx.MockTransport(handler))
    reply = provider.complete("system", "user", 100)
    assert reply.usage.total_tokens == 20
    assert json.loads(reply.content)["summary"] == "摘要"


def test_openai_vision_uses_multimodal_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        content = payload["messages"][1]["content"]
        assert content[0] == {"type": "text", "text": "transcribe"}
        assert content[1]["text"] == "第 1 页"
        assert content[2]["image_url"]["url"] == "data:image/jpeg;base64,aW1hZ2U="
        assert content[2]["image_url"]["detail"] == "high"
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps({"summary": "图像", "key_points": []})}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 4},
        })

    provider = OpenAIProvider("test-key", "https://api.example.com/v1", "test-model", httpx.MockTransport(handler))
    reply = provider.complete_with_images(
        "system", "transcribe", [VisionImage(b"image", "image/jpeg", "第 1 页")], 100,
    )
    assert json.loads(reply.content)["summary"] == "图像"
