"""Deterministic learning rules; model output never bypasses these functions."""

from dataclasses import dataclass
import re
from typing import Iterable, Literal


RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)
CONFIDENCE_CAP = {1: 0.5, 2: 0.8}


def normalize_answer(value: str) -> str:
    return re.sub(r"[\s，。；、,.;:!?！？（）()\[\]【】]", "", value).casefold()


def grade_exact(answer: str, expected: str, accepted: Iterable[str] = ()) -> bool:
    normalized = normalize_answer(answer)
    return bool(normalized) and normalized in {
        normalize_answer(item) for item in (expected, *accepted)
    }


@dataclass(frozen=True)
class MasteryResult:
    score: float
    mastered: bool
    evidence_count: int


def compute_mastery(correct_oldest_first: Iterable[bool]) -> MasteryResult:
    attempts = list(correct_oldest_first)[-len(RECENCY_WEIGHTS):]
    if not attempts:
        return MasteryResult(score=0.0, mastered=False, evidence_count=0)

    weights = RECENCY_WEIGHTS[-len(attempts):]
    weighted = sum(weight for weight, correct in zip(weights, attempts) if correct)
    raw = weighted / sum(weights)
    score = min(raw, CONFIDENCE_CAP.get(len(attempts), 1.0))
    return MasteryResult(
        score=round(score, 4),
        mastered=len(attempts) >= 3 and score >= 0.9,
        evidence_count=len(attempts),
    )


@dataclass(frozen=True)
class CoverageResult:
    expected: tuple[str, ...]
    covered: tuple[str, ...]
    missing: tuple[str, ...]
    complete: bool


def audit_coverage(expected: Iterable[str], covered: Iterable[str]) -> CoverageResult:
    expected_set = frozenset(expected)
    covered_set = frozenset(covered) & expected_set
    missing = tuple(sorted(expected_set - covered_set))
    return CoverageResult(
        expected=tuple(sorted(expected_set)),
        covered=tuple(sorted(covered_set)),
        missing=missing,
        complete=not missing,
    )


Verdict = Literal["correct", "incorrect", "ungraded"]


def accept_model_grade(confidence: float, is_correct: bool) -> Verdict:
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    if confidence < 0.8:
        return "ungraded"
    return "correct" if is_correct else "incorrect"
