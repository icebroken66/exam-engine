import pytest

from app.ingestion import ParseStatus, assert_transition, can_transition


def test_happy_path_supports_human_review() -> None:
    assert_transition(ParseStatus.UPLOADED, ParseStatus.QUEUED)
    assert_transition(ParseStatus.QUEUED, ParseStatus.RUNNING)
    assert_transition(ParseStatus.RUNNING, ParseStatus.NEEDS_REVIEW)
    assert_transition(ParseStatus.NEEDS_REVIEW, ParseStatus.QUEUED)
    assert_transition(ParseStatus.RUNNING, ParseStatus.NEEDS_TRANSCRIPTION_REVIEW)
    assert_transition(ParseStatus.NEEDS_TRANSCRIPTION_REVIEW, ParseStatus.QUEUED)


def test_ready_can_be_requeued_but_not_run_without_queue() -> None:
    assert can_transition(ParseStatus.RUNNING, ParseStatus.READY)
    assert not can_transition(ParseStatus.READY, ParseStatus.RUNNING)
    assert_transition(ParseStatus.READY, ParseStatus.QUEUED)


def test_failed_task_can_be_retried_but_not_marked_ready_directly() -> None:
    assert can_transition(ParseStatus.FAILED, ParseStatus.QUEUED)
    assert not can_transition(ParseStatus.FAILED, ParseStatus.READY)


def test_uploaded_file_cannot_skip_queue() -> None:
    with pytest.raises(ValueError, match="非法解析状态流转"):
        assert_transition(ParseStatus.UPLOADED, ParseStatus.READY)
