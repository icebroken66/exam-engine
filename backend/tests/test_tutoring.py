import json

from sqlalchemy import select

from app.main import get_model_gateway
from app.model_gateway import ModelGateway, MockProvider, ProviderReply, TokenUsage, ModelError
from app.models import EvidenceBlock, LearningAttempt, LearningEvent, LearningPointState, LearningSession, LearningTask, Source, TutoringTurn, UsageRecord
from app.tutoring import recover_interrupted
from test_learning_sessions import use_mock, start
from test_questions import evidence_for_course


class TutorProvider:
    name = "test-tutor"
    model = "fixture"
    mocked = True

    def __init__(self, hook=None, invalid=False):
        self.calls = []
        self.hook = hook
        self.invalid = invalid

    def complete(self, system_prompt, user_prompt, max_tokens):
        context = json.loads(user_prompt.split("<output_json_schema>")[0].strip())
        self.calls.append(context)
        if self.hook:
            self.hook()
        return ProviderReply(json.dumps(dict(message="请先指出投影后还保留哪几列。", action="check", reason="检查中间结果", evidence_ids=["foreign"] if self.invalid else [context["evidence"][0]["id"]], help_level="step", observation="尚待确认", uncertainty="不能据此判断掌握")), TokenUsage(10, 20))


def setup(client, session_factory, tmp_path):
    use_mock(client)
    course, _ = evidence_for_course(client, session_factory, tmp_path)
    current = start(client, course)
    provider = TutorProvider()
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(provider)
    return current, provider


def payload(current, sequence=0, request_id="r1", **kwargs):
    return dict(expected_task_id=current["current_task"]["id"], expected_progress_version=current["progress_version"], request_id=request_id, expected_sequence=sequence, message="我觉得先投影更快，第二步不明白", **kwargs)


def url(current):
    return f"/api/learning-sessions/{current['id']}/tutoring"


def read(client, current):
    return client.get(f"/api/learning-sessions/{current['id']}/tasks/{current['current_task']['id']}/tutoring")


def test_tutoring_persists_context_recovers_and_never_grades(client, session_factory, tmp_path):
    current, provider = setup(client, session_factory, tmp_path)
    response = client.post(url(current), json=payload(current))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session"]["stage"] == current["stage"]
    assert body["session"]["current_task"]["reference_answer"] is None
    assert body["turns"][0]["reply"]["action"] == "check"
    assert body["turns"][0]["delivered_at"] is None
    assert "reference_answer" not in str(body["turns"])
    assert provider.calls[0]["student_message"] == payload(current)["message"]
    assert provider.calls[0]["task"]["reference_answer"]
    assert client.post(url(current), json=payload(current)).json()["sequence"] == 1
    assert len(provider.calls) == 1
    assert read(client, current).json()["sequence"] == 1
    turn = body["turns"][0]
    received = client.post(url(current) + f"/{turn['id']}/received")
    assert received.status_code == 200 and received.json()["turns"][0]["delivered_at"]
    second = client.post(url(current), json=payload(body["session"], 1, "r2"))
    assert second.status_code == 200, second.text
    assert len(provider.calls[1]["history"]) == 1
    with session_factory() as db:
        assert db.query(LearningAttempt).count() == db.query(LearningPointState).count() == 0
        assert db.query(TutoringTurn).count() == 2
        assert db.query(LearningEvent).filter(LearningEvent.kind == "hint_requested").count() == 2
    assert client.post(url(current), json=payload(current, 0, "old-tab")).status_code == 409
    assert len(provider.calls) == 2


def test_retest_requires_explicit_consent_then_marks_real_attempt_helped(client, session_factory, tmp_path):
    current, provider = setup(client, session_factory, tmp_path)
    with session_factory() as db:
        task = db.get(LearningTask, current["current_task"]["id"])
        task.kind = "retest"
        task.question_type = "single_choice"
        task.options = ["正确", "错误"]
        task.reference_answer = "正确"
        db.get(LearningSession, current["id"]).stage = "retesting"
        db.commit()
    current = client.get(f"/api/learning-sessions/{current['id']}").json()
    assert client.post(url(current), json=payload(current)).status_code == 409
    assert not provider.calls
    response = client.post(url(current), json=payload(current, allow_retest_help=True))
    assert response.status_code == 200, response.text
    after = response.json()["session"]
    formal = client.post(f"/api/learning-sessions/{current['id']}/attempts", json={"answer":"正确","duration_seconds":1,"expected_task_id":after["current_task"]["id"],"expected_progress_version":after["progress_version"]})
    assert formal.status_code == 200, formal.text
    result = formal.json()
    assert result["current_task"]["latest_attempt"]["hints_used"] >= 1
    assert result["retest_passed"] == 0
    assert result["points"][0]["status"] == "fragile"


def test_invalid_citation_and_removed_source_do_not_publish_help(client, session_factory, tmp_path):
    current, provider = setup(client, session_factory, tmp_path)
    provider.invalid = True
    assert client.post(url(current), json=payload(current)).status_code == 502
    assert read(client,current).json()["turns"][0]["reply"] is None
    provider.invalid = False
    def remove():
        from datetime import datetime, timezone
        with session_factory() as db:
            block = db.get(EvidenceBlock, provider.calls[-1]["evidence"][0]["id"])
            db.get(Source,block.source_id).removed_at = datetime.now(timezone.utc)
            db.commit()
    provider.hook = remove
    latest = read(client,current).json()["session"]
    assert client.post(url(current), json=payload(latest,1,"r2")).status_code == 409
    assert read(client,current).json()["turns"][-1]["status"] == "stale"
    with session_factory() as db:
        assert not db.scalar(select(LearningEvent.id).where(LearningEvent.kind=="hint_requested"))


def test_generation_blocks_writes_and_discards_late_changed_progress(client,session_factory,tmp_path):
    current,provider=setup(client,session_factory,tmp_path)
    def change():
        assert client.post(f"/api/learning-sessions/{current['id']}/attempts",json={"answer":"x","duration_seconds":1}).status_code == 409
        assert client.post(url(current),json=payload(current,1,"race")).status_code == 409
        with session_factory() as db:
            db.get(LearningSession,current["id"]).stage="remediating"
            db.commit()
    provider.hook=change
    assert client.post(url(current),json=payload(current)).status_code == 409
    assert read(client,current).json()["turns"][0]["status"] == "stale"
    with session_factory() as db:
        assert db.query(LearningAttempt).count() == 0


def test_failed_request_does_not_replay_and_restart_releases_pending(client,session_factory,tmp_path):
    current,provider=setup(client,session_factory,tmp_path)
    def fail():raise ModelError(504,"test timeout")
    provider.hook=fail
    assert client.post(url(current),json=payload(current)).status_code==504
    assert client.post(url(current),json=payload(current)).status_code==200
    assert len(provider.calls)==1
    with session_factory() as db:
        db.add(TutoringTurn(session_id=current["id"],task_id=current["current_task"]["id"],request_id="interrupted",sequence=2,student_message="x",progress_version=current["progress_version"]))
        db.commit()
        assert recover_interrupted(db)==1
    assert read(client,current).json()["turns"][-1]["status"]=="failed"

def test_tutoring_rejects_content_change_and_request_reuse(client, session_factory, tmp_path):
    current, provider = setup(client, session_factory, tmp_path)
    def edit():
        with session_factory() as db:
            block = db.get(EvidenceBlock, provider.calls[-1]['evidence'][0]['id'])
            block.text += ' edited during generation'
            db.commit()
    provider.hook = edit
    assert client.post(url(current), json=payload(current)).status_code == 409
    assert read(client, current).json()['turns'][0]['status'] == 'stale'
    changed = payload(current)
    changed['message'] = 'different message with same key'
    assert client.post(url(current), json=changed).status_code == 409
    assert len(provider.calls) == 1


def test_tutoring_never_retries_invalid_json_or_transport(client, session_factory, tmp_path):
    import httpx
    from app.model_gateway import OpenAIProvider
    current, provider = setup(client, session_factory, tmp_path)
    def invalid(system_prompt, user_prompt, max_tokens):
        provider.calls.append(user_prompt)
        return ProviderReply('{invalid', TokenUsage(10, 1))
    provider.complete = invalid
    assert client.post(url(current), json=payload(current)).status_code == 502
    assert len(provider.calls) == 1
    requests = []
    def timeout(request):
        requests.append(request)
        raise httpx.ReadTimeout('test', request=request)
    real_provider = OpenAIProvider('test-only', 'https://fixture.invalid/v1', 'fixture', transport=httpx.MockTransport(timeout))
    client.app.dependency_overrides[get_model_gateway] = lambda: ModelGateway(real_provider)
    current = read(client, current).json()['session']
    assert client.post(url(current), json=payload(current, 1, 'r2')).status_code == 504
    assert len(requests) == 1
    assert real_provider.request_attempts == 2
