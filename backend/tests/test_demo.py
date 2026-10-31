import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "demo" / "周会演示_操作系统.md").read_text(encoding="utf-8")
QUESTIONS = json.loads((ROOT / "demo" / "周会演示_题目.json").read_text(encoding="utf-8"))


def test_demo_questions_resolve_to_unique_source_evidence() -> None:
    assert len(QUESTIONS) == 6
    for question in QUESTIONS:
        assert SOURCE.count(question["evidence_keyword"]) == 1
        assert question["stem"] and question["answer"] and question["analysis"]
        assert question["knowledge_points"]


def test_demo_questions_support_auditable_year_decay() -> None:
    assert {question["origin_year"] for question in QUESTIONS} == {2025, 2026}
    assert all(question["question_type"] == "short_answer" for question in QUESTIONS)
    repeated = [name for name in ("银行家算法", "死锁避免")]
    for name in repeated:
        matching = [question for question in QUESTIONS if name in question["knowledge_points"]]
        assert {question["origin_year"] for question in matching} == {2025, 2026}
