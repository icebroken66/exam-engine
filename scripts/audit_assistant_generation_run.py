"""Read-only deterministic audit of persisted live responses; never dispatches a model."""
import argparse, json, os, sys, sqlite3
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-directory',required=True,type=Path);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];run=args.run_directory.resolve()
allowed_roots=[(root/'data/acceptance-fev10').resolve(),(root/'data/acceptance-m4').resolve()]
if not any(run.is_relative_to(base) for base in allowed_roots):raise SystemExit('Only an isolated acceptance database is allowed')
os.environ['DATABASE_URL']='sqlite:///'+(run/'evaluation.db').as_posix();os.environ['EXAM_ENGINE_DATA_DIR']=str(run);os.environ['MODEL_PROVIDER']='mock'
sys.path.insert(0,str(root/'backend'))
from app.database import SessionLocal
from app.assistant_generation import citation
from app.assistant_generation_models import AssistantRequest, AssistantMessage
from app.models import UsageRecord
from sqlalchemy import select
from fastapi import HTTPException

def snapshot():
    with sqlite3.connect(run/'evaluation.db') as db:
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") if not r[0].startswith('sqlite_')]
        return {t:sorted([repr(tuple(r)) for r in db.execute('SELECT * FROM "'+t+'"')]) for t in tables}
before=snapshot();checks=[]
with SessionLocal() as db:
    published=list(db.scalars(select(AssistantRequest).where(AssistantRequest.state=='published')))
    for r in published:
        message=db.scalar(select(AssistantMessage).where(AssistantMessage.request_id==r.id,AssistantMessage.role=='assistant'))
        if not message:raise AssertionError('Published request has no assistant message')
        ids=sorted({eid for claim in message.claims for eid in claim['evidence_ids']})
        for eid in ids:
            evidence=next(e for e in r.evidence if e['evidence_id']==eid)
            if evidence['action'] is None:
                try:citation(db,r.course_id,r.id,eid,run/'uploads')
                except HTTPException as e:assert e.status_code==422
                else:raise AssertionError('User provided text acquired a source action')
                checks.append({'request_id':r.id,'evidence_id':eid,'status':'correctly_no_source_action','provenance':evidence['provenance']});continue
            result=citation(db,r.course_id,r.id,eid,run/'uploads');assert result['action']==evidence['action']
            action=result['action'];assert action['course_id']==r.course_id
            if action['kind']=='document':assert action['source_id']==evidence['snapshot']['source_id'] and action['page']==evidence['snapshot']['page'] and action['source_sha256']==evidence['snapshot']['source_sha256']
            elif action['kind']=='task':assert action['task_id']==evidence['snapshot']['task_id'] and action['session_id']==evidence['snapshot']['session_id']
            else:raise AssertionError('Unknown navigation action')
            checks.append({'request_id':r.id,'evidence_id':eid,'status':'valid','action':action,'quote':result['quote']})
    request_states=[{'id':r.id,'state':r.state,'usage_id':r.usage_id} for r in db.scalars(select(AssistantRequest))]
after=snapshot();assert before==after,'Citation reads mutated persisted data'
ledger=json.loads((run/'provider-ledger.json').read_text(encoding='utf-8'))
report={'status':'passed','scope':'deterministic identity/version/action checks, not semantic support or human review','published_requests':len(published),'citation_checks':checks,'database_unchanged':True,'additional_provider_calls':0,'provider_attempts':len(ledger['attempts']),'actual_tokens':sum(a.get('actual_tokens',0) for a in ledger['attempts']),'reserved_unknown_tokens':sum(a['reserved_tokens'] for a in ledger['attempts'] if a['state']!='returned'),'requests':request_states}
(run/'citation-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in {'citation_checks','requests'}},ensure_ascii=False,indent=2))
