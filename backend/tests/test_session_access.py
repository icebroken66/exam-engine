"""Public session contract: dependency direction and caller-owned transactions."""
import ast
from pathlib import Path

import pytest
from sqlalchemy import select

from app import learning_sessions, session_access, tutoring
from app.models import LearningEvent, LearningSession, LearningTask
from app.session_access import (
    LearningSessionError, assert_session_progress, get_current_task,
    get_learning_session, get_progress_version, record_session_event,
)
from test_learning_sessions import start, use_mock
from test_questions import evidence_for_course


def test_shared_contract_dependency_direction_and_exception_compatibility():
    assert learning_sessions.LearningSessionError is LearningSessionError
    assert tutoring.LearningSessionError is LearningSessionError
    for module in (session_access, tutoring):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if module is session_access:
                    assert node.module not in {"learning_sessions", "tutoring", "main"}
                elif node.module == "learning_sessions":
                    assert all(not name.name.startswith("_") for name in node.names)


def test_recording_event_leaves_commit_and_rollback_to_caller(session_factory):
    with session_factory() as db:
        record_session_event(db, "contract-session", "contract-event", "contract-task", reason="fixture")
        event = next(row for row in db.new if isinstance(row, LearningEvent))
        assert event.payload == {"reason": "fixture"}
        assert event.task_id == "contract-task"
        assert event.created_at.tzinfo is not None
        db.flush()
        db.rollback()
    with session_factory() as db:
        assert db.scalar(select(LearningEvent.id)) is None


def test_session_and_task_errors_preserve_http_contract(session_factory):
    with session_factory() as db:
        with pytest.raises(LearningSessionError) as missing:
            get_learning_session(db, "missing")
        assert (missing.value.status_code, missing.value.message) == (404, "学习会话不存在")
        session = LearningSession(id="session", course_id="course", stage="diagnosing")
        with pytest.raises(LearningSessionError) as no_task:
            get_current_task(db, session)
        assert no_task.value.status_code == 409
        db.add(LearningTask(id="foreign-task", session_id="other-session", kind="diagnostic", ordinal=1,
                            knowledge_point="fixture", question_type="short_answer", stem="fixture",
                            options=[], reference_answer="fixture", remediation_answer="fixture",
                            analysis="fixture", evidence_ids=[], provenance="generated"))
        db.flush()
        session.current_task_id = "foreign-task"
        with pytest.raises(LearningSessionError) as foreign:
            get_current_task(db, session)
        assert (foreign.value.status_code, foreign.value.message) == (409, "当前学习任务不可用")


def test_progress_check_refreshes_session_after_another_transaction(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    current = start(client, course)
    with session_factory() as reader:
        session = get_learning_session(reader, current["id"])
        version = get_progress_version(reader, session)
        assert version == current["progress_version"]
        assert_session_progress(reader, session, current["current_task"]["id"], version)
        with session_factory() as writer:
            writer.get(LearningSession, session.id).stage = "remediating"
            writer.commit()
        with pytest.raises(LearningSessionError) as stale:
            assert_session_progress(reader, session, current["current_task"]["id"], version)
        assert stale.value.status_code == 409
        assert session.stage == "remediating"
