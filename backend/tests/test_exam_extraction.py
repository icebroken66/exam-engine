import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.exam_extraction import _stem_identity, _stem_matches_source
from app.main import get_model_gateway
from app.model_gateway import ModelGateway, MockProvider, ProviderReply, TokenUsage
from app.models import LearningTask
from app.worker import run_next_task
from test_sources import create_course, upload


EXAM_TEXT = """# 2025 数据库系统原理期末试卷（回忆版）

一、简述死锁产生的四个必要条件。

二、数据库事务的隔离性是否要求并发执行互不干扰？

三、关系数据库中，用于唯一标识元组的是？
A. 主码
B. 外码
"""


class ExamProvider(MockProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<exam_extraction>" in user_prompt:
            blocks = json.loads(user_prompt.split("<evidence>", 1)[1].split("</evidence>", 1)[0])
            specs = [
                ("简述死锁产生的四个必要条件。", "short_answer", [], ["死锁"]),
                ("数据库事务的隔离性是否要求并发执行互不干扰？", "true_false", [], ["事务隔离性"]),
                ("关系数据库中，用于唯一标识元组的是？", "single_choice", ["A. 主码", "B. 外码"], ["关系键"]),
            ]
            questions = []
            for stem, question_type, options, points in specs:
                evidence_ids = [block["evidence_id"] for block in blocks if stem in block["text"]]
                questions.append({
                    "question_number": str(len(questions) + 1),
                    "stem": stem,
                    "question_type": question_type,
                    "options": options,
                    "answer": "",
                    "analysis": "",
                    "knowledge_points": points,
                    "evidence_ids": evidence_ids,
                    "origin_year": 2025,
                    "confidence": 0.96,
                })
            content = json.dumps({
                "questions": questions,
                "covered_evidence_ids": [block["evidence_id"] for block in blocks],
            }, ensure_ascii=False)
            return ProviderReply(content, TokenUsage(prompt_tokens=100, completion_tokens=100))
        if "<exam_solution>" in user_prompt:
            question = json.loads(user_prompt.split("<question>", 1)[1].split("</question>", 1)[0])
            answer = {
                "short_answer": "互斥、占有且等待、不可剥夺和循环等待。",
                "true_false": "正确",
                "single_choice": "A. 主码",
            }[question["question_type"]]
            content = json.dumps({
                "answer": answer,
                "analysis": "根据对应概念的约束条件作答。",
                "rubric": ["结论正确", "关键条件完整"],
                "confidence": 0.93,
            }, ensure_ascii=False)
            return ProviderReply(content, TokenUsage(prompt_tokens=50, completion_tokens=30))
        return super().complete(system_prompt, user_prompt, max_tokens)


def upload_exam(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> tuple[str, str]:
    course_id = create_course(client, "数据库基础")
    source_id = upload(
        client, course_id, content=EXAM_TEXT.encode(), name="2025数据库系统原理期末试卷（回忆版）.md",
    ).json()["source"]["id"]
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(ExamProvider()))
    return course_id, source_id


def test_exam_is_automatically_structured_and_first_task_is_real_original(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    provider = ExamProvider()
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(provider)
    course_id, _ = upload_exam(client, session_factory, tmp_path)
    questions = client.get(f"/api/courses/{course_id}/questions").json()
    assert len(questions) == 3
    assert {question["status"] for question in questions} == {"verified"}
    assert {question["question_type"] for question in questions} == {"short_answer", "true_false", "single_choice"}
    assert {point for question in questions for point in question["knowledge_points"]} == {"死锁", "事务隔离性", "关系键"}
    assert {question["answer_provenance"] for question in questions} == {"ai"}
    assert all(question["options"] == ["正确", "错误"] for question in questions if question["question_type"] == "true_false")

    context = client.get(f"/api/courses/{course_id}/learning-context").json()
    assert context["can_start"] is True
    assert set(context["topics"]) == {"死锁", "事务隔离性", "关系键"}
    assert all("试卷" not in topic and "第" not in topic for topic in context["topics"])
    assert not any("近年往年题" in item for item in context["missing_materials"])

    session = client.post(f"/api/courses/{course_id}/learning-sessions").json()
    task = session["current_task"]
    original = next(question for question in questions if question["id"] == task["origin_question_id"])
    assert task["provenance"] == "original"
    assert task["stem"] == original["stem"]
    assert task["answer_provenance"] == "ai"
    assert "AI 参考答案" in task["visible_limitation"]
    purposes = [record["purpose"] for record in client.get(f"/api/courses/{course_id}/usage").json()["records"]]
    assert "course_question_generation" not in purposes
    assert "course_question_validation" not in purposes


def test_used_original_is_adapted_with_traceable_origin(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(ExamProvider())
    course_id, _ = upload_exam(client, session_factory, tmp_path)
    session = client.post(f"/api/courses/{course_id}/learning-sessions").json()
    original_id = session["current_task"]["origin_question_id"]
    wrong = client.post(f"/api/learning-sessions/{session['id']}/attempts", json={
        "answer": "不知道", "duration_seconds": 5,
    })
    assert wrong.status_code == 200, wrong.text
    remediation = client.post(f"/api/learning-sessions/{session['id']}/next").json()
    assert remediation["stage"] == "remediating"
    practice = client.post(f"/api/learning-sessions/{session['id']}/next").json()
    assert practice["current_task"]["provenance"] == "adapted"
    assert practice["current_task"]["origin_question_id"] == original_id
    assert practice["current_task"]["answer_provenance"] == "ai"
    with session_factory() as db:
        tasks = list(db.scalars(select(LearningTask).where(LearningTask.session_id == session["id"])).all())
    assert len(tasks) == 2


class ForgedExtractionProvider(ExamProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<exam_extraction>" not in user_prompt:
            return super().complete(system_prompt, user_prompt, max_tokens)
        blocks = json.loads(user_prompt.split("<evidence>", 1)[1].split("</evidence>", 1)[0])
        evidence_id = blocks[0]["evidence_id"]
        content = json.dumps({
            "questions": [
                {
                    "question_number": "1", "stem": "简述死锁产生的四个必要条件。", "question_type": "short_answer",
                    "options": [], "answer": "", "analysis": "", "knowledge_points": ["死锁"],
                    "evidence_ids": ["伪造证据"], "origin_year": None, "confidence": 0.99,
                },
                {
                    "question_number": "2", "stem": "请解释一个原卷中不存在的问题。", "question_type": "short_answer",
                    "options": [], "answer": "", "analysis": "", "knowledge_points": ["死锁"],
                    "evidence_ids": [evidence_id], "origin_year": None, "confidence": 0.99,
                },
                {
                    "question_number": "3", "stem": "数据库事务的隔离性是否要求并发执行互不干扰？", "question_type": "short_answer",
                    "options": [], "answer": "", "analysis": "", "knowledge_points": ["数据库系统原理期末试卷（回忆版）"],
                    "evidence_ids": [evidence_id], "origin_year": None, "confidence": 0.99,
                },
            ],
            "covered_evidence_ids": [block["evidence_id"] for block in blocks],
        }, ensure_ascii=False)
        return ProviderReply(content, TokenUsage(prompt_tokens=50, completion_tokens=50))


def test_forged_evidence_stem_and_filename_topic_stay_draft(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id = create_course(client, "数据库基础")
    upload(client, course_id, content=EXAM_TEXT.encode(), name="2025数据库期末试卷.md")
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(ForgedExtractionProvider()))
    questions = client.get(f"/api/courses/{course_id}/questions").json()
    assert len(questions) == 3
    assert {question["status"] for question in questions} == {"draft"}
    assert any("证据" in issue for question in questions for issue in question["extraction_issues"])
    assert any("逐字对账" in issue for question in questions for issue in question["extraction_issues"])
    assert any("非语义" in issue for question in questions for issue in question["extraction_issues"])


def test_shared_context_and_subquestion_reconcile_in_original_order() -> None:
    source = "已知关系 R 与 S。\n1. 第一问。\n2. 第二问要求说明自然连接。"
    assert _stem_matches_source("已知关系 R 与 S。\n2. 第二问要求说明自然连接。", source)
    assert not _stem_matches_source("已知关系 R 与 S。\n2. 原卷没有的第三问。", source)


def test_section_heading_does_not_create_a_duplicate_question_identity() -> None:
    stem = "对于以下 SQL 查询，画出经过代数优化的语法树。"
    assert _stem_identity(f"查询优化 (5 分)\n{stem}") == _stem_identity(stem)
    assert _stem_identity("已知 R、S、T。\n1. (6 分)") != _stem_identity("已知 R、S、T。\n2. (6 分)")


class SourceAnswerProvider(ExamProvider):
    def complete(self, system_prompt: str, user_prompt: str, max_tokens: int) -> ProviderReply:
        if "<exam_extraction>" not in user_prompt:
            return super().complete(system_prompt, user_prompt, max_tokens)
        blocks = json.loads(user_prompt.split("<evidence>", 1)[1].split("</evidence>", 1)[0])
        stem = "简述死锁产生的四个必要条件。"
        content = json.dumps({
            "questions": [{
                "question_number": "1", "stem": stem, "question_type": "short_answer", "options": [],
                "answer": "互斥、占有且等待、不可剥夺和循环等待。", "analysis": "四个条件缺一不可。",
                "knowledge_points": ["死锁"], "origin_year": 2025, "confidence": 0.98,
                "evidence_ids": [block["evidence_id"] for block in blocks if stem in block["text"]],
            }],
            "covered_evidence_ids": [block["evidence_id"] for block in blocks],
        }, ensure_ascii=False)
        return ProviderReply(content, TokenUsage(prompt_tokens=50, completion_tokens=50))


def test_explicit_source_answer_is_not_replaced_by_ai(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id = create_course(client, "数据库基础")
    content = "# 2025 数据库期末试卷\n\n一、简述死锁产生的四个必要条件。\n答案：互斥、占有且等待、不可剥夺和循环等待。"
    upload(client, course_id, content=content.encode(), name="2025数据库期末试卷.md")
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(SourceAnswerProvider()))
    questions = client.get(f"/api/courses/{course_id}/questions").json()
    assert len(questions) == 1
    assert questions[0]["answer_provenance"] == "source"
    assert questions[0]["answer"] == "互斥、占有且等待、不可剥夺和循环等待。"
    purposes = [record["purpose"] for record in client.get(f"/api/courses/{course_id}/usage").json()["records"]]
    assert "exam_answer_solving" not in purposes
