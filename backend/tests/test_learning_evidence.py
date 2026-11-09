from datetime import datetime, timedelta, timezone
import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.learning_evidence import course_learning_evidence, prior_learning_context
from app.learning_sessions import _course_signature, _initial_plan, _planner_payload, correct_attempt
from app.model_gateway import ModelGateway, MockProvider
from app.models import Course, DocumentNode, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, Source, UsageRecord


NOW = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)


def seed(db):
    course = Course(school="test", name="信号")
    db.add(course); db.flush()
    source = Source(course_id=course.id, original_name="notes.md", extension=".md", storage_key=course.id,
                    media_type="text/plain", size_bytes=10, sha256="a" * 64, status="ready")
    db.add(source); db.flush()
    node = DocumentNode(id=str(uuid4()), source_id=source.id, title="信号", ordinal=1)
    db.add(node); db.flush()
    block = EvidenceBlock(id=str(uuid4()), source_id=source.id, node_id=node.id, ordinal=1, text="阶跃与冲激", content_hash="b" * 64)
    db.add(block); db.flush()
    session = LearningSession(course_id=course.id, stage="completed")
    db.add(session); db.flush()
    task = LearningTask(session_id=session.id, kind="diagnostic", ordinal=1, knowledge_point="信号微分",
                        sub_skill="零点跳变", stem="求冲激响应", question_type="short_answer", options=[],
                        reference_answer="delta-aexp", remediation_answer="delta-aexp", analysis="分布导数",
                        evidence_ids=[block.id], evidence_version=_course_signature(db, course.id),
                        provenance="generated", validation_status="validated", status="answered")
    db.add(task); db.flush(); session.current_task_id = task.id
    attempt = LearningAttempt(session_id=session.id, task_id=task.id, attempt_number=1, answer="开发答案",
                              verdict="correct", grading_layer="evidence_model", confidence=.99,
                              feedback="正确", missing_points=[], hints_used=0, duration_seconds=0,
                              provider="test", model="test", mocked=False, created_at=NOW-timedelta(days=2))
    db.add(attempt); db.commit()
    return course, source, block, session, task, attempt


def test_due_projection_is_read_only_and_not_mastery(client, session_factory):
    with session_factory() as db:
        course, _, _, session, task, _ = seed(db)
        report = course_learning_evidence(db, course.id, now=NOW)
        assert report["items"][0]["recommendation"] == "due"
        assert report["items"][0]["due_at"] == NOW-timedelta(days=1)
        assert report["usable_count"] == 1
        assert prior_learning_context(db, course.id, {"信号微分"}, session.id)["items"] == []
        payload = _planner_payload(db, session, [{"knowledge_point":"信号微分", "material_types":[]}])
        assert payload["prior_learning"]["items"] == []
        before = db.query(UsageRecord).count()
        course_id, task_id = course.id, task.id
    first = client.get(f"/api/courses/{course_id}/learning-evidence")
    assert first.status_code == 200 and first.json()["items"][0]["task_id"] == task_id
    assert client.get(f"/api/courses/{course_id}/learning-evidence").json() == first.json()
    assert client.get(f"/api/courses/{course_id}/learning-evidence?page=0").status_code == 422
    assert client.get("/api/courses/missing/learning-evidence").status_code == 404
    with session_factory() as db:
        assert db.query(UsageRecord).count() == before
        assert db.get(LearningSession, session.id).stage == "completed"


@pytest.mark.parametrize("change", ["mock", "ungraded", "low", "missing", "removed", "version", "legacy", "unconfirmed", "draft"])
def test_invalid_evidence_is_visible_but_not_reused(session_factory, change):
    with session_factory() as db:
        course, source, block, _, task, attempt = seed(db)
        if change == "mock": attempt.mocked = True
        if change == "ungraded": attempt.verdict = "ungraded"
        if change == "low": attempt.confidence = .5
        if change == "missing": task.evidence_ids = ["missing"]
        if change == "removed": source.removed_at = NOW
        if change == "version": block.content_hash = "c" * 64
        if change == "legacy": task.evidence_version = ""
        if change == "unconfirmed": source.status = "needs_transcription_review"
        if change == "draft": task.validation_status = "draft"
        db.commit()
        report = course_learning_evidence(db, course.id, now=NOW)
        assert report["total"] == report["excluded_count"] == 1
        assert not report["items"][0]["usable"] and report["items"][0]["exclusion_reason"]
        assert report["due_count"] == 0
        assert prior_learning_context(db, course.id, {"信号微分"})["items"] == []


def test_correction_and_resubmission_recompute_latest_without_counting_extra_evidence(session_factory):
    with session_factory() as db:
        course, _, _, session, task, attempt = seed(db)
        correct_attempt(db, session.id, attempt.id, "incorrect", "开发纠错")
        report = course_learning_evidence(db, course.id, now=NOW)
        assert report["items"][0]["recommendation"] == "repair"
        assert report["items"][0]["taken_at"] == NOW-timedelta(days=2)
        # Latest ungraded attempt must hide the older correct result, even with an earlier timestamp.
        later = LearningAttempt(session_id=session.id, task_id=task.id, attempt_number=2, answer="待评分的新答",
                                verdict="ungraded", grading_layer="model_error", feedback="待确认", missing_points=[],
                                hints_used=0, duration_seconds=0, provider="test", model="test", mocked=False,
                                created_at=NOW-timedelta(days=3))
        db.add(later); db.commit()
        report = course_learning_evidence(db, course.id, now=NOW)
        assert report["total"] == 1 and report["items"][0]["attempt_id"] == later.id
        assert not report["items"][0]["usable"]


def test_help_and_24_hour_boundary_and_course_isolation(session_factory):
    with session_factory() as db:
        course, _, _, _, _, attempt = seed(db)
        other, *_ = seed(db)
        attempt.created_at = NOW-timedelta(hours=23)
        db.commit()
        report = course_learning_evidence(db, course.id, now=NOW)
        assert report["total"] == 1 and report["items"][0]["recommendation"] == "later"
        attempt.created_at = NOW-timedelta(hours=24); db.commit()
        assert course_learning_evidence(db, course.id, now=NOW)["due_count"] == 1
        assert course_learning_evidence(db, other.id, now=NOW)["due_count"] == 1
        attempt.hints_used = 1; db.commit()
        item = course_learning_evidence(db, course.id, now=NOW)["items"][0]
        assert item["recommendation"] == "without_help" and item["due_at"] is None


def test_pagination_counts_all_records_but_only_returns_requested_rows(session_factory):
    with session_factory() as db:
        course, _, _, _, task, _ = seed(db)
        second = LearningSession(course_id=course.id, stage="completed")
        db.add(second); db.flush()
        fields = {c.key: getattr(task, c.key) for c in LearningTask.__table__.columns
                  if c.key not in {"id", "session_id", "created_at"}}
        second_task = LearningTask(session_id=second.id, **fields)
        db.add(second_task); db.flush()
        db.add(LearningAttempt(session_id=second.id, task_id=second_task.id, attempt_number=1, answer="另一题作答",
                               verdict="incorrect", grading_layer="evidence_model", confidence=.99, feedback="缺失条件",
                               missing_points=[], hints_used=0, duration_seconds=0, provider="test", model="test",
                               mocked=False, created_at=NOW))
        db.commit()
        first = course_learning_evidence(db, course.id, page_size=1, now=NOW)
        last = course_learning_evidence(db, course.id, page=2, page_size=1, now=NOW)
        assert first["total"] == last["total"] == 2
        assert first["items"][0]["task_id"] == second_task.id
        assert last["items"][0]["task_id"] == task.id


def test_initial_planner_receives_valid_prior_context_without_importing_scores(session_factory):
    with session_factory() as db:
        course, _, _, _, _, _ = seed(db)
        class Recorder(MockProvider):
            def complete(self, system_prompt, user_prompt, max_tokens):
                self.payload = json.loads(user_prompt.split("<initial_learning_plan>")[1].split("</initial_learning_plan>")[0])
                return super().complete(system_prompt, user_prompt, max_tokens)
        provider = Recorder()
        plan = _initial_plan(db, course, ModelGateway(provider), [{"knowledge_point":"信号微分", "questions":[], "material_types":[]}])
        item = provider.payload["prior_learning"]["items"][0]
        assert item["verdict"] == "correct" and "score" not in item
        assert plan.action == "diagnostic"


def test_new_round_skips_exposed_original_across_sessions(session_factory, monkeypatch):
    from app import learning_sessions
    from app.models import Question
    from app.schemas import LearningPlanContent
    with session_factory() as db:
        course, source, _, _, task, _ = seed(db)
        seen = Question(course_id=course.id, source_id=source.id, stem="已见原题", question_type="short_answer",
                        answer="答案", analysis="分析", knowledge_points=["信号微分"], status="validated")
        fresh = Question(course_id=course.id, source_id=source.id, stem="未见原题", question_type="short_answer",
                         answer="答案", analysis="分析", knowledge_points=["信号微分"], status="validated")
        db.add_all([seen, fresh]); db.flush(); task.origin_question_id = seen.id
        new_session = LearningSession(course_id=course.id, stage="diagnosing")
        db.add(new_session); db.commit()
        monkeypatch.setattr(learning_sessions, "_new_original_task", lambda *args: args[5]["id"])
        plan = LearningPlanContent(action="diagnostic", knowledge_point="信号微分", sub_skill="零点跳变",
                                   cognitive_level="apply", difficulty_prior="basic", reason="检查保持")
        selected = learning_sessions._new_generated_task(db, new_session, course, None,
                    [{"knowledge_point":"信号微分", "questions":[{"id":seen.id}, {"id":fresh.id}]}], plan, "diagnostic")
        assert selected == fresh.id
