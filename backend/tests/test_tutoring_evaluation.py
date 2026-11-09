"""Guard against invalid claims from mismatched or incomplete frozen comparisons."""
import importlib.util
import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter
from app.schemas import LearningTaskRead


spec = importlib.util.spec_from_file_location("tutoring_eval", Path(__file__).resolve().parents[2] / "scripts/evaluate_tutoring.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


def frozen():
    context = {"student_message": "why", "evidence": [{"id": "e1", "text": "source"}],
               "history": [{"tutor": {"message": "keep A and B?"}}]}
    report = {"group": "system", "source_sha256": "hash", "provider": "test", "model": "test", "max_tokens": 2000,
              "cases": [{"id": "a", "initial_answer": None, "turns": [{"student": "why", "context": context, "reply": {"message": "because"}}]}]}
    return report, [{"id": "a", "messages": ["why"]}]


def test_exact_frozen_context_keeps_question_and_evidence():
    report, cases = frozen()
    contexts = evaluation.frozen_contexts(report, cases, "hash", "test", "test")
    assert contexts["a", 0] == report["cases"][0]["turns"][0]["context"]
    assert contexts["a", 0]["history"][0]["tutor"]["message"] == "keep A and B?"


@pytest.mark.parametrize("change", ["source", "model", "budget", "error", "partial", "message", "answer"])
def test_rejects_incomparable_frozen_run(change):
    report, cases = frozen()
    if change == "source": report["source_sha256"] = "other"
    if change == "model": report["model"] = "other"
    if change == "budget": report["max_tokens"] = 1000
    if change == "error": report["cases"][0]["error"] = "timeout"
    if change == "partial": report["cases"][0]["turns"] = []
    if change == "message": cases[0]["messages"] = ["something else"]
    if change == "answer": cases[0]["answer"] = "different formal answer"
    with pytest.raises(ValueError):
        evaluation.frozen_contexts(report, cases, "hash", "test", "test")


def test_checked_fixtures_use_public_task_field_types():
    fixtures = Path(__file__).resolve().parents[2] / 'evals/tutoring'
    for path in fixtures.glob('*.fixture.json'):
        task = json.loads(path.read_text(encoding='utf-8'))['task']
        for key, value in task.items():
            if key in LearningTaskRead.model_fields:
                TypeAdapter(LearningTaskRead.model_fields[key].annotation).validate_python(value)
