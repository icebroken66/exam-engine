"""Offline tests for the authorized review runner's persistent hard stop."""
import importlib.util
from pathlib import Path
import pytest
from app.model_gateway import ProviderReply, TokenUsage, ModelError

spec=importlib.util.spec_from_file_location('course_path_review',Path(__file__).resolve().parents[2]/'scripts/serve-course-path-review.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

class Provider:
    name='test';model='test';mocked=True
    def __init__(self):self.calls=0;self.fail=False
    def complete(self,*args):
        self.calls+=1
        if self.fail:raise ModelError(504,'unknown')
        return ProviderReply('{}',TokenUsage(2,3))

def test_review_cap_persists_actual_usage_and_attempt_limit(tmp_path):
    provider=Provider();cap=review.CappedProvider(provider,tmp_path,1,20000)
    cap.complete('system','"assistant_v10": true',10)
    assert cap.ledger['committed_tokens']==5
    resumed=review.CappedProvider(provider,tmp_path,1,20000)
    with pytest.raises(ModelError):resumed.complete('system','"assistant_v10": true',10)
    assert provider.calls==1

def test_unknown_review_stops_resumed_calls_and_keeps_reservation(tmp_path):
    provider=Provider();provider.fail=True;cap=review.CappedProvider(provider,tmp_path,6,50000)
    with pytest.raises(ModelError):cap.complete('system','"assistant_v10": true',1500)
    assert cap.ledger['committed_tokens']>10
    resumed=review.CappedProvider(provider,tmp_path,6,50000)
    with pytest.raises(ModelError):resumed.complete('system','"assistant_v10": true',10)
    assert provider.calls==1

def test_unresolved_unknown_cannot_be_bypassed_by_new_request(tmp_path):
    provider=Provider();provider.fail=True;first=review.CappedProvider(provider,tmp_path,6,50000)
    with pytest.raises(ModelError):first.complete('system','"assistant_v10": true',10)
    provider.fail=False;resumed=review.CappedProvider(provider,tmp_path,6,50000)
    with pytest.raises(ModelError):resumed.complete('system','"assistant_v10": true new request',10)
    assert [e['state'] for e in resumed.ledger['attempts']]==['failed_or_unknown']
    assert resumed.ledger['attempts'][0]['reserved_tokens']==12010
    assert resumed.ledger['committed_tokens']==12010
    assert provider.calls==1

def test_review_refuses_nonassistant_calls_and_token_overflow(tmp_path):
    provider=Provider();cap=review.CappedProvider(provider,tmp_path,6,20)
    with pytest.raises(ModelError):cap.complete('system','grading',1)
    with pytest.raises(ModelError):cap.complete('system','"assistant_v10": true',10)
    assert provider.calls==0
