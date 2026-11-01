"""OpenAI-compatible and Mock providers with structured output and usage accounting."""

from dataclasses import dataclass
from datetime import datetime, time, timezone
import json
import os
from pathlib import Path
import subprocess
import threading
from typing import Protocol, TypeVar

import httpx
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import UsageRecord


OutputT = TypeVar("OutputT", bound=BaseModel)


class ModelError(Exception):
    def __init__(self, status_code: int, message: str, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class TokenUsage:
    prompt_tokens: int
    completion_tokens: int

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True)
class ProviderReply:
    content: str
    usage: TokenUsage


class ModelProvider(Protocol):
    name: str
    model: str
    mocked: bool

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply: ...


class MockProvider:
    name = "mock"
    model = "deterministic-mock-v1"
    mocked = True

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        evidence = user_prompt.split("<evidence>", 1)[-1].split("</evidence>", 1)[0].strip()
        excerpts = [part.strip() for part in evidence.replace("\r", "\n").split("\n") if part.strip()]
        if "<grading>" in user_prompt:
            student = user_prompt.split("<student_answer>", 1)[-1].split("</student_answer>", 1)[0].strip()
            reference = user_prompt.split("<reference_answer>", 1)[-1].split("</reference_answer>", 1)[0].strip()
            correct = bool(student) and "".join(student.split()).casefold() == "".join(reference.split()).casefold()
            content = json.dumps({
                "is_correct": correct,
                "confidence": 0.99,
                "feedback": "Mock 判分：学生答案与参考答案文本等价。" if correct else "Mock 判分：学生答案与参考答案不一致。",
                "missing_points": [] if correct else ["Mock 只用于流程测试，请用真实模型检查缺失要点"],
            }, ensure_ascii=False)
        elif "<question>" in user_prompt:
            question = user_prompt.split("<question>", 1)[-1].split("</question>", 1)[0].strip()
            first_block = evidence.split("\n\n[证据 ", 1)[0]
            first = first_block.split("原文：", 1)[-1].strip() if "原文：" in first_block else "资料不足"
            first = (first or excerpts[0] if excerpts else "资料不足")[:500]
            headings = list(dict.fromkeys(
                line.split("｜")[2].split("｜", 1)[0].rstrip("]")
                for line in excerpts if line.startswith("[证据 ") and line.count("｜") >= 2
            ))
            content = json.dumps({
                "answer": f"依据当前课程资料：{first}",
                "steps": [
                    f"识别题目中的核心概念：{question[:100]}",
                    "在已解析课程资料中检索相关章节与原文，而不是直接生成无来源答案。",
                    "将匹配原文整理为答案；复杂计算、推理和变式题需要真实模型进一步完成。",
                ],
                "analysis": "这是 Mock 循证解题演示：检索、答案结构、原文引用与用量记录均为真实流程，但当前不会验证复杂推理或保证答案完整。",
                "knowledge_points": headings[:4] or ["课程原文依据"],
            }, ensure_ascii=False)
        else:
            first = excerpts[0][:240] if excerpts else "该证据没有可用文字"
            points = excerpts[:3] or ["原文为空，不能生成可靠讲解"]
            content = json.dumps({
                "summary": f"Mock 讲解：这段资料首先说明“{first}”。真实模型接入后，这里会生成更完整的概念解释。",
                "key_points": points,
            }, ensure_ascii=False)
        usage = TokenUsage(
            prompt_tokens=max(1, (len(system_prompt) + len(user_prompt)) // 4),
            completion_tokens=max(1, len(content) // 4),
        )
        return ProviderReply(content, usage)


class OpenAIProvider:
    name = "openai-compatible"
    mocked = False

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        transport: httpx.BaseTransport | None = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport

    @staticmethod
    def _parse_response(response: httpx.Response) -> ProviderReply:
        if response.status_code == 429 or response.status_code >= 500:
            raise ModelError(502, "模型服务暂时不可用", retryable=True)
        if response.status_code >= 400:
            raise ModelError(502, f"模型服务拒绝了请求（{response.status_code}）")
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        raw_usage = payload.get("usage") or {}
        usage = TokenUsage(
            prompt_tokens=max(0, int(raw_usage.get("prompt_tokens", 0))),
            completion_tokens=max(0, int(raw_usage.get("completion_tokens", 0))),
        )
        if not isinstance(content, str) or not content.strip():
            raise ModelError(502, "模型返回了空内容")
        return ProviderReply(content, usage)

    def _complete_with_node(self, payload: dict) -> ProviderReply:
        script = Path(__file__).resolve().parents[2] / "scripts" / "openai_chat.mjs"
        try:
            completed = subprocess.run(
                ["node", str(script)],
                input=json.dumps({
                    "base_url": self.base_url,
                    "api_key": self.api_key,
                    "payload": payload,
                }),
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ModelError(504, "模型服务连接超时或网络失败", retryable=True) from error
        if completed.returncode != 0:
            raise ModelError(504, "模型服务连接超时或网络失败", retryable=True)
        envelope = json.loads(completed.stdout)
        response = httpx.Response(status_code=int(envelope["status"]), text=envelope["body"])
        return self._parse_response(response)

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        request_payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
        }
        last_error: ModelError | None = None
        for attempt in range(2):
            try:
                try:
                    with httpx.Client(
                        timeout=httpx.Timeout(45.0, connect=10.0),
                        transport=self.transport,
                    ) as client:
                        response = client.post(
                            f"{self.base_url}/chat/completions",
                            headers={"Authorization": f"Bearer {self.api_key}"},
                            json=request_payload,
                        )
                except httpx.ConnectError:
                    return self._complete_with_node(request_payload)
                return self._parse_response(response)
            except (httpx.TimeoutException, httpx.RequestError) as error:
                last_error = ModelError(504, "模型服务连接超时或网络失败", retryable=True)
            except ModelError as error:
                last_error = error
                if not error.retryable:
                    raise
            except (ValueError, KeyError, IndexError, TypeError) as error:
                raise ModelError(502, "模型服务返回了无法识别的响应") from error
            if attempt == 0 and last_error.retryable:
                continue
        raise last_error or ModelError(502, "模型调用失败")


class ModelGateway:
    def __init__(
        self,
        provider: ModelProvider,
        course_token_budget: int = 20_000,
        daily_token_budget: int = 200_000,
        input_usd_per_million: float = 0,
        output_usd_per_million: float = 0,
    ):
        self.provider = provider
        self.course_token_budget = course_token_budget
        self.daily_token_budget = daily_token_budget
        self.input_usd_per_million = input_usd_per_million
        self.output_usd_per_million = output_usd_per_million
        self._budget_lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "ModelGateway":
        provider_name = os.getenv("MODEL_PROVIDER", "").strip().casefold()
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if provider_name == "mock" or (not provider_name and not api_key):
            provider: ModelProvider = MockProvider()
        elif provider_name in {"", "openai", "openai-compatible"} and api_key:
            provider = OpenAIProvider(
                api_key=api_key,
                base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            )
        else:
            raise RuntimeError("MODEL_PROVIDER 配置无效，或 OpenAI 兼容服务缺少 OPENAI_API_KEY")
        return cls(
            provider=provider,
            course_token_budget=int(os.getenv("MODEL_COURSE_TOKEN_BUDGET", "20000")),
            daily_token_budget=int(os.getenv("MODEL_DAILY_TOKEN_BUDGET", "200000")),
            input_usd_per_million=float(os.getenv("MODEL_INPUT_USD_PER_MILLION", "0")),
            output_usd_per_million=float(os.getenv("MODEL_OUTPUT_USD_PER_MILLION", "0")),
        )

    @staticmethod
    def _used(db: Session, course_id: str | None, day_start: datetime | None = None) -> int:
        query = select(func.coalesce(func.sum(UsageRecord.total_tokens + UsageRecord.reserved_tokens), 0))
        if course_id is not None:
            query = query.where(UsageRecord.course_id == course_id)
        if day_start is not None:
            query = query.where(UsageRecord.created_at >= day_start)
        return int(db.scalar(query) or 0)

    def usage_summary(self, db: Session, course_id: str) -> dict[str, int]:
        day_start = datetime.combine(datetime.now(timezone.utc).date(), time.min)
        course_used = self._used(db, course_id)
        daily_used = self._used(db, None, day_start)
        return {
            "course_used_tokens": course_used,
            "course_token_budget": self.course_token_budget,
            "course_remaining_tokens": max(0, self.course_token_budget - course_used),
            "daily_used_tokens": daily_used,
            "daily_token_budget": self.daily_token_budget,
        }

    def generate_json(
        self,
        db: Session,
        course_id: str,
        purpose: str,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
        max_tokens: int = 900,
    ) -> tuple[OutputT, UsageRecord]:
        estimated_prompt = max(1, (len(system_prompt) + len(user_prompt)) // 4)
        reserved = estimated_prompt + max_tokens
        day_start = datetime.combine(datetime.now(timezone.utc).date(), time.min)
        with self._budget_lock:
            course_used = self._used(db, course_id)
            daily_used = self._used(db, None, day_start)
            if course_used + reserved > self.course_token_budget:
                raise ModelError(429, "本课程的模型 token 预算不足，请减少调用或调整预算")
            if daily_used + reserved > self.daily_token_budget:
                raise ModelError(429, "今日全局模型 token 预算不足，请明天再试或调整预算")
            record = UsageRecord(
                course_id=course_id,
                purpose=purpose,
                provider=self.provider.name,
                model=self.provider.model,
                status="running",
                reserved_tokens=reserved,
            )
            db.add(record)
            db.commit()
            db.refresh(record)

        try:
            reply = self.provider.complete(system_prompt, user_prompt, max_tokens)
            record.prompt_tokens = reply.usage.prompt_tokens
            record.completion_tokens = reply.usage.completion_tokens
            record.total_tokens = reply.usage.total_tokens
            record.estimated_cost_usd = (
                reply.usage.prompt_tokens * self.input_usd_per_million
                + reply.usage.completion_tokens * self.output_usd_per_million
            ) / 1_000_000
            try:
                parsed = output_type.model_validate(json.loads(reply.content))
            except (json.JSONDecodeError, ValueError) as error:
                raise ModelError(502, "模型返回的结构化内容未通过校验") from error
            record.status = "succeeded"
            record.reserved_tokens = 0
            db.commit()
            db.refresh(record)
            return parsed, record
        except Exception as error:
            record.status = "failed"
            record.reserved_tokens = 0
            record.error = (error.message if isinstance(error, ModelError) else "模型调用失败")[:1000]
            db.commit()
            if isinstance(error, ModelError):
                raise
            raise ModelError(502, "模型调用失败") from error
