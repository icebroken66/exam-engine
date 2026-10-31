from enum import StrEnum


class ParseStatus(StrEnum):
    UPLOADED = "uploaded"
    QUEUED = "queued"
    RUNNING = "running"
    NEEDS_REVIEW = "needs_review"
    READY = "ready"
    FAILED = "failed"


ACTIVE_STATUSES = {ParseStatus.QUEUED, ParseStatus.RUNNING}
TERMINAL_STATUSES = {ParseStatus.NEEDS_REVIEW, ParseStatus.READY, ParseStatus.FAILED}

ALLOWED_TRANSITIONS = {
    ParseStatus.UPLOADED: {ParseStatus.QUEUED},
    ParseStatus.QUEUED: {ParseStatus.RUNNING, ParseStatus.FAILED},
    ParseStatus.RUNNING: TERMINAL_STATUSES,
    ParseStatus.NEEDS_REVIEW: {ParseStatus.QUEUED},
    ParseStatus.READY: set(),
    ParseStatus.FAILED: {ParseStatus.QUEUED},
}


def can_transition(current: ParseStatus, target: ParseStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def assert_transition(current: ParseStatus, target: ParseStatus) -> None:
    if not can_transition(current, target):
        raise ValueError(f"非法解析状态流转：{current.value} → {target.value}")
