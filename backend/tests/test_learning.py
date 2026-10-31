import pytest

from app.learning import accept_model_grade, audit_coverage, compute_mastery, grade_exact


def test_exact_grade_accepts_equivalent_formatting() -> None:
    assert grade_exact(" 1A362H ", "1a362h")
    assert grade_exact("88%", "88", ["88%", "0.88"])
    assert not grade_exact("", "88")


def test_one_or_two_correct_answers_cannot_master() -> None:
    assert compute_mastery([True]).score == 0.5
    assert compute_mastery([True, True]).score == 0.8
    assert not compute_mastery([True, True]).mastered


def test_three_recent_correct_answers_can_master() -> None:
    result = compute_mastery([True, True, True])
    assert result.score == 1.0
    assert result.mastered


def test_old_success_does_not_hide_recent_failure() -> None:
    result = compute_mastery([True, True, False])
    assert not result.mastered
    assert result.score < 0.9


def test_coverage_never_silently_drops_missing_nodes() -> None:
    result = audit_coverage(["ch1", "ch2", "ch3"], ["ch1", "ch3", "invented"])
    assert result.missing == ("ch2",)
    assert result.covered == ("ch1", "ch3")
    assert not result.complete


@pytest.mark.parametrize("confidence", [0, 0.79])
def test_low_confidence_model_grade_is_ungraded(confidence: float) -> None:
    assert accept_model_grade(confidence, True) == "ungraded"


def test_confident_model_grade_is_accepted() -> None:
    assert accept_model_grade(0.8, True) == "correct"
