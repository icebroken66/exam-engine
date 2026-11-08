"""OpenAI-compatible and Mock providers with structured output and usage accounting."""

import base64
from dataclasses import dataclass
from datetime import datetime, time, timezone
import json
import os
from pathlib import Path
import re
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
    def __init__(
        self, status_code: int, message: str, retryable: bool = False,
        output_truncated: bool = False,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.retryable = retryable
        self.output_truncated = output_truncated


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
    finish_reason: str | None = None


@dataclass(frozen=True)
class VisionImage:
    data: bytes
    media_type: str
    label: str


class ModelProvider(Protocol):
    name: str
    model: str
    mocked: bool

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply: ...
    def complete_with_images(
        self, system_prompt: str, user_prompt: str, images: list[VisionImage], max_tokens: int,
    ) -> ProviderReply: ...


class MockProvider:
    name = "mock"
    model = "deterministic-mock-v1"
    mocked = True

    def complete_with_images(
        self, system_prompt: str, user_prompt: str, images: list[VisionImage], max_tokens: int,
    ) -> ProviderReply:
        return ProviderReply(
            json.dumps({"text": "", "confidence": 0, "issues": ["Mock 不执行视觉转录"]}),
            TokenUsage(prompt_tokens=1, completion_tokens=1),
        )

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        evidence = user_prompt.split("<evidence>", 1)[-1].split("</evidence>", 1)[0].strip()
        excerpts = [part.strip() for part in evidence.replace("\r", "\n").split("\n") if part.strip()]
        if "<course_scope>" in user_prompt:
            course = user_prompt.split("<course>", 1)[-1].split("</course>", 1)[0].strip()
            evidence = user_prompt.split("<evidence>", 1)[-1].split("</evidence>", 1)[0].strip()
            topics = [topic.strip()[:120] for topic in re.findall(r"<topic>(.*?)</topic>", evidence) if topic.strip()][:12]
            if not topics:
                topics = ["核心概念", "基本原理", "常见应用"]
            content = json.dumps({
                "scope_text": (
                    f"{course}：课程资料中的核心概念、规则与常见应用"
                    if evidence else f"{course}的通用核心概念、基本原理与常见应用"
                ),
                "topics": topics,
            }, ensure_ascii=False)
        elif "<material_classification>" in user_prompt:
            payload = json.loads(user_prompt.split("<material_classification>", 1)[1].split("</material_classification>", 1)[0])
            searchable = payload["filename"] + "\n" + "\n".join(payload["text_samples"])
            material_type = "past_exam" if re.search(r"往年|真题|期末卷|试卷|考题|exam", searchable, re.IGNORECASE) else "courseware"
            content = json.dumps({
                "material_type": material_type,
                "confidence": 0.9,
                "rationale": "Mock：根据文件名与正文样本识别资料用途。",
            }, ensure_ascii=False)
        elif "<evidence_research>" in user_prompt:
            payload = json.loads(user_prompt.split("<evidence_research>", 1)[1].split("</evidence_research>", 1)[0])
            topic = payload["topics"][0] if payload["topics"] else payload["scope"]
            content = json.dumps({
                "query": f"{topic} 定义 适用条件",
                "evidence_needed": f"补充“{topic}”的明确解释、组成或适用条件",
                "rationale": "Mock：根据当前资料主题生成可核查的公开检索词。",
            }, ensure_ascii=False)
        elif "<source_quality_assessment>" in user_prompt:
            payload = json.loads(user_prompt.split("<source_quality_assessment>", 1)[1].split("</source_quality_assessment>", 1)[0])
            content = json.dumps({
                "assessments": [
                    {
                        "url": document["url"],
                        "recommendation": "recommended" if index == 0 else "optional",
                        "confidence": 0.95,
                        "reason": "Mock：正文与当前资料缺口相关，仍需用户核对原文。",
                        "evidence_excerpt": document["text"][:240].strip(),
                    }
                    for index, document in enumerate(payload["documents"])
                ],
            }, ensure_ascii=False)
        elif "<exam_extraction>" in user_prompt:
            source_name = user_prompt.split("<source_name>", 1)[1].split("</source_name>", 1)[0].strip()
            blocks = json.loads(user_prompt.split("<evidence>", 1)[1].split("</evidence>", 1)[0])
            questions = []
            for block in blocks:
                text = block["text"]
                matches = list(re.finditer(r"(?m)^\s*(?:[一二三四五六七八九十]+|\d+)[、.．]\s*", text))
                for index, match in enumerate(matches):
                    end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                    stem = text[match.end():end].strip()
                    if not stem:
                        continue
                    option_matches = re.findall(r"(?m)^\s*[A-H][.．、]\s*.+$", stem)
                    question_type = "single_choice" if option_matches else (
                        "true_false" if stem.startswith("判断题") else "short_answer"
                    )
                    questions.append({
                        "question_number": str(len(questions) + 1),
                        "stem": stem,
                        "question_type": question_type,
                        "options": option_matches,
                        "answer": "",
                        "analysis": "",
                        "knowledge_points": ["死锁" if "死锁" in stem else "数据库基础"],
                        "evidence_ids": [block["evidence_id"]],
                        "origin_year": 2024 if "2024" in source_name + text else None,
                        "confidence": 0.95,
                    })
            content = json.dumps({
                "questions": questions,
                "covered_evidence_ids": [block["evidence_id"] for block in blocks],
            }, ensure_ascii=False)
        elif "<exam_solution>" in user_prompt:
            question = json.loads(user_prompt.split("<question>", 1)[1].split("</question>", 1)[0])
            answer = question["options"][0] if question["question_type"] == "single_choice" else (
                "正确" if question["question_type"] == "true_false" else "Mock：这是供流程测试使用的参考答案，不是原卷答案。"
            )
            content = json.dumps({
                "answer": answer,
                "analysis": "Mock：真实模型应在这里独立求解并解释；当前只验证数据链路。",
                "rubric": ["结论与参考答案一致"],
                "confidence": 0.9,
            }, ensure_ascii=False)
        elif "<exam_validation>" in user_prompt:
            payload = json.loads(user_prompt.split("<exam_validation>", 1)[1].split("</exam_validation>", 1)[0])
            content = json.dumps({
                "results": [
                    {"question_index": item["question_index"], "is_usable": True, "confidence": 0.95, "issues": []}
                    for item in payload
                ],
            }, ensure_ascii=False)
        elif "<initial_learning_plan>" in user_prompt:
            payload = json.loads(user_prompt.split("<initial_learning_plan>", 1)[1].split("</initial_learning_plan>", 1)[0])
            content = json.dumps({
                "action": "diagnostic",
                "knowledge_point": payload["available_topics"][0],
                "sub_skill": "理解核心概念、关键组成与适用条件",
                "cognitive_level": "understand",
                "difficulty_prior": "basic",
                "reason": "Mock：从有效资料候选开始建立基础学习证据。",
            }, ensure_ascii=False)
        elif "<question_generation>" in user_prompt:
            blueprint = json.loads(user_prompt.split("<blueprint>", 1)[1].split("</blueprint>", 1)[0])
            allowed = json.loads(user_prompt.split("<allowed_evidence>", 1)[1].split("</allowed_evidence>", 1)[0])
            topic = blueprint["knowledge_point"]
            action_label = {"diagnostic": "诊断", "practice": "变式练习", "retest": "独立重测"}.get(blueprint["action"], "诊断")
            content = json.dumps({
                "knowledge_point": topic,
                "sub_skill": blueprint["sub_skill"],
                "cognitive_level": blueprint["cognitive_level"],
                "difficulty_prior": blueprint["difficulty_prior"],
                "question_type": "short_answer",
                "stem": f"{action_label}：请说明“{topic}”的准确定义、关键组成和适用条件，并用一个自行构造的例子解释这些条件如何共同发挥作用。",
                "options": [],
                "answer": allowed[0]["text"][:4000],
                "rubric": ["准确定义核心概念", "说明关键组成与适用条件", "例子与概念关系一致"],
                "prerequisites": [],
                "analysis": "Mock 仅生成结构固定的流程样本；真实模型需要根据证据形成具体问题和答案，并通过独立验证。",
                "evidence_ids": [allowed[0]["evidence_id"]],
            }, ensure_ascii=False)
        elif "<question_validation>" in user_prompt:
            content = json.dumps({"is_usable": True, "confidence": 0.99, "issues": []}, ensure_ascii=False)
        elif "<learning_planner>" in user_prompt:
            payload = json.loads(user_prompt.split("<learning_planner>", 1)[1].split("</learning_planner>", 1)[0])
            topics = payload["available_topics"]
            history = payload["recent_history"]
            latest = history[-1]
            used = {item["knowledge_point"] for item in history if item["kind"] == "diagnostic" and item["verdict"]}
            remaining = next((topic for topic in topics if topic not in used), None)
            action = "diagnostic"
            topic = latest["knowledge_point"]
            reason = "Mock 根据最近作答选择下一项诊断。"
            if latest["verdict"] == "incorrect":
                action = "remediation"
                reason = "Mock：当前作答错误，需要先补缺。"
            elif latest["kind"] == "practice":
                action = "retest"
                reason = "Mock：练习已通过，需要撤提示独立重测。"
            elif latest["kind"] == "retest":
                if remaining is None:
                    action = "complete"
                    reason = "Mock：可用主题均有诊断且当前重测通过。"
                else:
                    topic = remaining
                    reason = "Mock：当前重测通过，转向尚未诊断主题。"
            elif remaining is not None:
                topic = remaining
                reason = "Mock：当前诊断完成，转向尚未覆盖主题。"
            else:
                action = "retest"
                reason = "Mock：已有主题诊断完成，需要独立重测。"
            content = json.dumps({
                "action": action,
                "knowledge_point": topic,
                "sub_skill": "核对概念、条件与实际应用",
                "cognitive_level": "understand",
                "difficulty_prior": "basic",
                "reason": reason,
            }, ensure_ascii=False)
        elif "<general_diagnostic>" in user_prompt:
            scope = user_prompt.split("<scope>", 1)[-1].split("</scope>", 1)[0].strip()
            content = json.dumps({
                "questions": [
                    {
                        "knowledge_point": f"{scope[:40]}：学习方法",
                        "sub_skill": "区分记忆与独立应用",
                        "cognitive_level": "understand",
                        "difficulty_prior": "basic",
                        "question_type": "true_false",
                        "stem": "判断题：复习时只要记住定义，就足以证明能够独立解决问题。",
                        "options": ["正确", "错误"],
                        "answer": "错误",
                        "analysis": "记住定义只是基础，还需要在不看解析和提示的情况下应用知识，并通过变式或重测验证。",
                    },
                    {
                        "knowledge_point": f"{scope[:40]}：概念条件",
                        "sub_skill": "核对概念边界",
                        "cognitive_level": "understand",
                        "difficulty_prior": "basic",
                        "question_type": "short_answer",
                        "stem": "通用诊断：学习一个新概念时，除了定义，还应主动核对哪两类信息？",
                        "options": [],
                        "answer": "应核对概念的适用条件和典型例题（或例外情况）。",
                        "analysis": "定义需要和适用条件、典型例子或例外一起理解，才能避免脱离前提机械套用。",
                    },
                    {
                        "knowledge_point": f"{scope[:40]}：独立验证",
                        "sub_skill": "选择有效的掌握证据",
                        "cognitive_level": "apply",
                        "difficulty_prior": "medium",
                        "question_type": "short_answer",
                        "stem": "通用诊断：完成一道练习题后，怎样判断自己是否真正掌握？",
                        "options": [],
                        "answer": "应在不看解析和提示的情况下完成变式或重测，并核对结果。",
                        "analysis": "即时模仿可能依赖短期记忆；独立变式或重测更能说明能否自行调用知识。",
                    },
                    {
                        "knowledge_point": f"{scope[:40]}：题目拆解",
                        "sub_skill": "识别条件与求解目标",
                        "cognitive_level": "apply",
                        "difficulty_prior": "medium",
                        "question_type": "short_answer",
                        "stem": "通用诊断：面对本范围中的一道标准题，第一步应如何拆解题干？",
                        "options": [],
                        "answer": "先识别已知条件、求解目标和适用规则，再选择方法并分步验证。",
                        "analysis": "先分清条件、目标与规则，可以减少机械套用公式或方法造成的错误。",
                    },
                    {
                        "knowledge_point": f"{scope[:40]}：迁移练习",
                        "sub_skill": "识别迁移缺口",
                        "cognitive_level": "analyze",
                        "difficulty_prior": "medium",
                        "question_type": "short_answer",
                        "stem": "通用诊断：如果常规题会做、条件变化后不会，应进行哪类练习？",
                        "options": [],
                        "answer": "应进行改变条件的变式练习，并对照适用条件分析差异。",
                        "analysis": "条件变化后的失败通常需要变式与对比例，而不是重复同一个题目模板。",
                    },
                    {
                        "knowledge_point": f"{scope[:40]}：策略调整",
                        "sub_skill": "在连续失败时改变策略",
                        "cognitive_level": "analyze",
                        "difficulty_prior": "advanced",
                        "question_type": "short_answer",
                        "stem": "通用诊断：连续多轮没有进展时，下一步怎样调整？",
                        "options": [],
                        "answer": "应更换讲解方式、补最小先修知识或降低题目粒度，而不是机械重复同类题。",
                        "analysis": "连续无进展时需要改变教学策略，并保留未解决状态，不能无限重复同类任务。",
                    },
                ],
            }, ensure_ascii=False)
        elif "<grading>" in user_prompt:
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
        choice = payload["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
        raw_usage = payload.get("usage") or {}
        usage = TokenUsage(
            prompt_tokens=max(0, int(raw_usage.get("prompt_tokens", 0))),
            completion_tokens=max(0, int(raw_usage.get("completion_tokens", 0))),
        )
        if finish_reason == "length":
            return ProviderReply(content if isinstance(content, str) else "", usage, finish_reason)
        if not isinstance(content, str) or not content.strip():
            raise ModelError(502, "模型返回了空内容", retryable=True)
        return ProviderReply(content, usage, finish_reason)

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

    def _request(self, request_payload: dict) -> ProviderReply:
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

    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        return self._request({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
        })

    def complete_with_images(
        self, system_prompt: str, user_prompt: str, images: list[VisionImage], max_tokens: int,
    ) -> ProviderReply:
        content: list[dict] = [{"type": "text", "text": user_prompt}]
        for image in images:
            encoded = base64.b64encode(image.data).decode("ascii")
            content.append({"type": "text", "text": image.label})
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{image.media_type};base64,{encoded}", "detail": "high"},
            })
        return self._request({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
        })


class ModelGateway:
    def __init__(
        self,
        provider: ModelProvider,
        course_token_budget: int | None = None,
        daily_token_budget: int | None = None,
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
        enforce_budgets = os.getenv("MODEL_ENFORCE_TOKEN_BUDGET", "false").strip().casefold() in {"1", "true", "yes", "on"}
        course_budget = int(os.getenv("MODEL_COURSE_TOKEN_BUDGET", "0")) if enforce_budgets else 0
        daily_budget = int(os.getenv("MODEL_DAILY_TOKEN_BUDGET", "0")) if enforce_budgets else 0
        return cls(
            provider=provider,
            course_token_budget=course_budget if course_budget > 0 else None,
            daily_token_budget=daily_budget if daily_budget > 0 else None,
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

    def usage_summary(self, db: Session, course_id: str) -> dict[str, int | None]:
        day_start = datetime.combine(datetime.now(timezone.utc).date(), time.min)
        course_used = self._used(db, course_id)
        daily_used = self._used(db, None, day_start)
        return {
            "course_used_tokens": course_used,
            "course_token_budget": self.course_token_budget,
            "course_remaining_tokens": (
                max(0, self.course_token_budget - course_used)
                if self.course_token_budget is not None else None
            ),
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
        images: list[VisionImage] | None = None,
    ) -> tuple[OutputT, UsageRecord]:
        for attempt in range(2):
            try:
                return self._generate_json_once(
                    db, course_id, purpose, system_prompt, user_prompt,
                    output_type, max_tokens, images,
                )
            except ModelError as error:
                # Retry malformed JSON once; schema errors and exhausted transport
                # retries keep their original boundary. Each attempt records usage
                # and checks the budget independently.
                if attempt or not (
                    error.output_truncated or isinstance(error.__cause__, json.JSONDecodeError)
                ):
                    raise
                if error.output_truncated:
                    max_tokens *= 2
        raise AssertionError("JSON retry loop must return or raise")

    def _generate_json_once(
        self,
        db: Session,
        course_id: str,
        purpose: str,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
        max_tokens: int = 900,
        images: list[VisionImage] | None = None,
    ) -> tuple[OutputT, UsageRecord]:
        schema = json.dumps(output_type.model_json_schema(), ensure_ascii=False)
        user_prompt = (
            f"{user_prompt}\n<output_json_schema>{schema}</output_json_schema>\n"
            "最终答案只能是符合 output_json_schema 的 JSON 对象，必须使用其中定义的字段名，不得自行改名。"
        )
        image_estimate = sum(len(image.data) for image in images or []) // 3
        estimated_prompt = max(1, (len(system_prompt) + len(user_prompt)) // 4 + image_estimate)
        reserved = estimated_prompt + max_tokens
        day_start = datetime.combine(datetime.now(timezone.utc).date(), time.min)
        with self._budget_lock:
            course_used = self._used(db, course_id)
            daily_used = self._used(db, None, day_start)
            if self.course_token_budget is not None and course_used + reserved > self.course_token_budget:
                raise ModelError(429, "本课程的模型 token 预算不足，请减少调用或调整预算")
            if self.daily_token_budget is not None and daily_used + reserved > self.daily_token_budget:
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

        started_at = datetime.now(timezone.utc)
        try:
            reply = (
                self.provider.complete_with_images(system_prompt, user_prompt, images, max_tokens)
                if images else self.provider.complete(system_prompt, user_prompt, max_tokens)
            )
            record.prompt_tokens = reply.usage.prompt_tokens
            record.completion_tokens = reply.usage.completion_tokens
            record.total_tokens = reply.usage.total_tokens
            record.estimated_cost_usd = (
                reply.usage.prompt_tokens * self.input_usd_per_million
                + reply.usage.completion_tokens * self.output_usd_per_million
            ) / 1_000_000
            if reply.finish_reason == "length":
                raise ModelError(502, "模型输出达到长度上限，结构化内容可能不完整", output_truncated=True)
            try:
                parsed = output_type.model_validate(json.loads(reply.content))
            except (json.JSONDecodeError, ValueError) as error:
                detail = str(error).replace("\n", " ")[:500]
                raise ModelError(502, f"模型返回的结构化内容未通过校验：{detail}") from error
            record.status = "succeeded"
            record.reserved_tokens = 0
            record.duration_seconds = max(0, (datetime.now(timezone.utc) - started_at).total_seconds())
            db.commit()
            db.refresh(record)
            return parsed, record
        except Exception as error:
            record.status = "failed"
            record.reserved_tokens = 0
            record.duration_seconds = max(0, (datetime.now(timezone.utc) - started_at).total_seconds())
            record.error = (error.message if isinstance(error, ModelError) else "模型调用失败")[:1000]
            db.commit()
            if isinstance(error, ModelError):
                raise
            raise ModelError(502, "模型调用失败") from error
