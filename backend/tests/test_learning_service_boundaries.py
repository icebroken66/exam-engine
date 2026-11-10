"""Enforce domain ownership and public compatibility after the PR-02 split."""
import ast
from pathlib import Path

from app import course_context, learning_evidence, learning_grading
from app import learning_questions, learning_reads, learning_sessions


def test_domain_dependencies_do_not_point_back_to_session_orchestration():
    allowed = {
        course_context: set(),
        learning_questions: {"course_context"},
        learning_reads: {"course_context"},
        learning_grading: {"learning_reads"},
        learning_evidence: {"course_context"},
    }
    domains = {module.__name__.split(".")[-1] for module in allowed} | {"learning_sessions", "tutoring", "main"}
    for module, permitted in allowed.items():
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level:
                dependency = node.module
                if dependency in domains:
                    assert dependency in permitted, (module.__name__, dependency)
                assert all(not alias.name.startswith("_") for alias in node.names)
            assert not (isinstance(node, ast.Import) and any(alias.name.startswith("app.learning_sessions") for alias in node.names))


def test_existing_public_entries_resolve_to_their_domain_owner():
    for name, owner in {
        "prepare_course_context": course_context,
        "read_learning_session": learning_reads,
        "read_session_history": learning_reads,
        "submit_attempt": learning_grading,
        "correct_attempt": learning_grading,
        "review_current_attempt": learning_grading,
    }.items():
        assert getattr(learning_sessions, name) is getattr(owner, name)
    assert learning_evidence.course_signature is course_context.course_signature
