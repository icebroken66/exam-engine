"""Offline support-quality packets using the production assistant harness. Never calls live models."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / 'evals/support-quality/cases.json'


def fingerprint(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def check_review(packet, review):
    """Bind every manual judgement to the exact case, prompt and output it reviewed."""
    errors = []
    if review.get('packet_sha256') != fingerprint(packet):
        errors.append('packet fingerprint mismatch')
    if not isinstance(review.get('reviewer'), str) or not review['reviewer'].strip():
        errors.append('reviewer required')
    rows = review.get('cases', [])
    if not isinstance(rows, list):
        rows = []
    by_id = {r.get('case_id'): r for r in rows if isinstance(r, dict)}
    if len(rows) != len(packet['cases']) or set(by_id) != {r['case_id'] for r in packet['cases']}:
        errors.append('review must cover each case exactly once')
    for result in packet['cases']:
        row = by_id.get(result['case_id'], {})
        if row.get('output_sha256') != fingerprint(result['messages']):
            errors.append(result['case_id'] + ': output fingerprint mismatch')
        scores = row.get('checks', [])
        if not isinstance(scores, list) or len(scores) != len(result['checks']):
            errors.append(result['case_id'] + ': incomplete checks')
            continue
        for index, score in enumerate(scores):
            if not isinstance(score, dict) or score.get('check') != result['checks'][index] or score.get('verdict') not in ('pass', 'fail', 'uncertain') or not isinstance(score.get('reason'), str) or not score['reason'].strip():
                errors.append(result['case_id'] + ': verdict and reason required for each check')
    return {'review_valid': not errors, 'errors': errors, 'quality_passed': False,
            'model_quality_evaluated': False,
            'scope': 'Offline/mock rehearsal only; manual marks cannot establish live model quality.'}


def run_mock(cases):
    # Set isolation before importing any app module. No dotenv/provider factory is used.
    with tempfile.TemporaryDirectory(prefix='exam-support-quality-') as temporary:
        os.environ['DATABASE_URL'] = 'sqlite://'
        os.environ['EXAM_ENGINE_DATA_DIR'] = temporary
        os.environ['ASSISTANT_GENERATION_ENABLED'] = '1'
        os.environ['ASSISTANT_GENERATION_MOCK'] = '1'
        sys.path.insert(0, str(ROOT / 'backend'))
        from unittest.mock import patch
        # The normal config module loads .env; suppress that read in this offline runner.
        with patch('dotenv.load_dotenv', return_value=False):
            from app import config
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from app.database import Base
        from app import models
        from app.assistant_workspace_models import Topic
        from app.assistant_generation_models import AssistantRequest, AssistantMessage
        from app.assistant_generation import Runtime, accept, messages, SYSTEM
        from app.assistant_generation_dto import RequestCreate
        from app.model_gateway import ModelGateway, MockProvider

        class RecordingMock(MockProvider):
            def __init__(self): self.calls = []
            def complete(self, system_prompt, user_prompt, max_tokens):
                self.calls.append({'system': system_prompt, 'user': user_prompt, 'max_tokens': max_tokens})
                return super().complete(system_prompt, user_prompt, max_tokens)

        class SynchronousRuntime:
            timeout = Runtime.timeout

        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        Base.metadata.create_all(engine)
        provider = RecordingMock()
        gateway = ModelGateway(provider)
        packet = {'schema_version': 1, 'mode': 'mock', 'network_calls': 0, 'quality_passed': False,
                  'model_quality_evaluated': False, 'cases_sha256': fingerprint(cases),
                  'system_sha256': sha256(SYSTEM.encode()).hexdigest(),
                  'code_sha256': fingerprint({name:sha256((ROOT/name).read_bytes()).hexdigest() for name in
                      ('backend/app/assistant_generation.py','backend/app/assistant_evidence.py','backend/app/assistant_generation_dto.py','backend/app/model_gateway.py')}), 'cases': []}
        try:
            for case in cases:
                with factory() as db:
                    course = models.Course(school='合成隔离案例', name='Support ' + case['id'])
                    db.add(course); db.flush()
                    topic = Topic(course_id=course.id, title=case['id'], mode='independent', item_ids=[])
                    db.add(topic); db.flush()
                    for pair in case['history']:
                        prior = AssistantRequest(id=str(uuid4()), course_id=course.id, topic_id=topic.id,
                            payload_hash='synthetic-history', intent={'text': pair['user']}, state='published',
                            frozen={'item_ids': [], 'bindings': [], 'topic_mode': 'independent', 'mocked': True})
                        db.add(prior); db.flush()
                        db.add_all([AssistantMessage(request_id=prior.id, course_id=course.id, topic_id=topic.id, role='user', text=pair['user'], claims=[]),
                            AssistantMessage(request_id=prior.id, course_id=course.id, topic_id=topic.id, role='assistant', text=pair['assistant'], claims=[{'text':pair['assistant'],'kind':'model_explanation','evidence_ids':[],'quote':''}])])
                    db.commit()
                    body = RequestCreate(request_id=uuid4(), expected_revision=topic.revision, context_revision=topic.context_revision, text=case['question'], support_mode=case['support_mode'])
                    row, _ = accept(db, course.id, topic.id, body, gateway)
                    identity, course_id, topic_id = row.id, course.id, topic.id
                before = len(provider.calls)
                # Synchronous run uses the exact same preparation/validation path as the background worker.
                Runtime.run(SynchronousRuntime(), factory, identity, gateway, Path(temporary))
                with factory() as db:
                    row = db.get(AssistantRequest, identity)
                    output = messages(db, course_id, topic_id)['items']
                    current = [message for message in output if message['request_id'] == identity]
                    for message in current:
                        if message.get('created_at') is not None:
                            message['created_at'] = message['created_at'].isoformat()
                    packet['cases'].append({'case_id': case['id'], 'support_mode': case['support_mode'],
                        'state': row.state, 'request': row.intent, 'provider_calls': len(provider.calls)-before,
                        'prompt': provider.calls[-1] if len(provider.calls)>before else None,
                        'prompt_sha256': fingerprint(provider.calls[-1]) if len(provider.calls)>before else None,
                        'messages': current, 'notices': row.notices,
                        'checks': case['checks'], 'reference_notes': case['reference_notes'],
                        'learning_records': {model.__tablename__: len(list(db.scalars(select(model)))) for model in
                            (models.LearningAttempt, models.LearningPointState, models.TutoringTurn)}})
            return packet
        finally:
            engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mock', action='store_true')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--packet', type=Path)
    parser.add_argument('--review', type=Path)
    args = parser.parse_args(argv)
    cases = json.loads(CASES.read_text(encoding='utf-8'))
    if args.review:
        if not args.packet or args.mock or args.output:
            parser.error('review requires --packet and cannot run models or write outputs')
        result = check_review(json.loads(args.packet.read_text(encoding='utf-8')), json.loads(args.review.read_text(encoding='utf-8')))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result['review_valid'] else 1
    if not args.mock:
        print(json.dumps({'status':'plan_only','network_calls':0,'cases':[c['id'] for c in cases], 'quality_passed':False},ensure_ascii=False))
        return 0
    if not args.output:
        parser.error('--mock requires a new --output directory under data/acceptance-support-quality')
    output = args.output.resolve()
    root = (ROOT / 'data/acceptance-support-quality').resolve()
    if output == root or not output.is_relative_to(root) or output.exists():
        parser.error('use a fresh child directory under data/acceptance-support-quality')
    packet = run_mock(cases)
    output.mkdir(parents=True, exist_ok=False)
    (output/'packet.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2),encoding='utf-8')
    review = {'packet_sha256':fingerprint(packet),'reviewer':None,'cases':[{'case_id':r['case_id'],'output_sha256':fingerprint(r['messages']),
        'checks':[{'check':check,'verdict':None,'reason':''} for check in r['checks']]} for r in packet['cases']]}
    (output/'review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':'mock_packet_ready','directory':str(output),'network_calls':0,'quality_passed':False,
        'cases':[{'id':r['case_id'],'state':r['state'],'provider_calls':r['provider_calls']} for r in packet['cases']]},ensure_ascii=False))
    return 0 if all(r['state']=='published' for r in packet['cases']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
