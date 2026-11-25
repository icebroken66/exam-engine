"""Explicitly authorized course-path review; isolated data and a persistent shared cap."""
import argparse
from dataclasses import asdict
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import sys
import threading
from datetime import datetime, timezone
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]


class CappedProvider:
    def __init__(self,provider,directory,attempt_limit,token_limit):
        self.provider=provider;self.name=provider.name;self.model=provider.model;self.mocked=provider.mocked
        self.directory=directory;self.path=directory/'provider-ledger.json';self.lock=threading.Lock()
        self.attempt_limit=attempt_limit;self.token_limit=token_limit
        self.ledger=json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else {
            'model':self.model,'attempt_limit':attempt_limit,'token_limit':token_limit,'committed_tokens':0,'attempts':[]}
        if any(self.ledger[k]!=v for k,v in [('model',self.model),('attempt_limit',attempt_limit),('token_limit',token_limit)]):
            raise RuntimeError('Review configuration differs from existing ledger')
        adjusted=0
        for entry in self.ledger['attempts']:
            if entry['state']!='returned':
                conservative=12000+int(entry.get('max_output_tokens',1500))
                adjusted+=max(0,conservative-entry['reserved_tokens'])
                entry['reserved_tokens']=max(entry['reserved_tokens'],conservative)
        if adjusted:
            self.ledger['committed_tokens']+=adjusted
            self.save()

    def save(self):
        temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.ledger,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(self.path)

    def complete(self,system,user,max_tokens):
        from app.model_gateway import ModelError
        if '"assistant_v10": true' not in user:raise ModelError(403,'本次授权仅允许统一助手路径，不允许自动规划／评分调用')
        reserved=12000+max_tokens
        with self.lock:
            entries=self.ledger['attempts']
            if any(e['state']!='returned' for e in entries):raise ModelError(409,'存在未与供应商用量记录对账的调用；停止后续真实请求')
            if len(entries)>=self.attempt_limit or self.ledger['committed_tokens']+reserved>self.token_limit:
                raise ModelError(429,'已达到本次授权调用数或总token上限')
            entry={'attempt':len(entries)+1,'state':'dispatched_unknown','reserved_tokens':reserved,'max_output_tokens':max_tokens,
                   'prompt_sha256':sha256((system+user).encode()).hexdigest(),'started_at':datetime.now(timezone.utc).isoformat()}
            entries.append(entry);self.ledger['committed_tokens']+=reserved;self.save()
            (self.directory/('prompt-%02d.json'%entry['attempt'])).write_text(json.dumps({'system':system,'user':user},ensure_ascii=False),encoding='utf-8')
        try:
            reply=self.provider.complete(system,user,max_tokens)
            with self.lock:
                actual=reply.usage.total_tokens
                entry.update(state='returned',actual_tokens=actual,finish_reason=reply.finish_reason,ended_at=datetime.now(timezone.utc).isoformat())
                self.ledger['committed_tokens']+=actual-reserved
                (self.directory/('response-%02d.json'%entry['attempt'])).write_text(json.dumps({'text':reply.content,'usage':asdict(reply.usage)},ensure_ascii=False),encoding='utf-8')
                self.save()
            return reply
        except Exception as error:
            with self.lock:
                entry.update(state='failed_or_unknown',error_type=type(error).__name__,ended_at=datetime.now(timezone.utc).isoformat());self.save()
            raise

    def complete_with_images(self,*args):
        from app.model_gateway import ModelError
        raise ModelError(403,'本次课程文字路径不包含图片模型调用')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--serve',action='store_true',help='Without this flag only prepare isolated materials, never call a model')
    args=parser.parse_args();config_path=args.config.resolve()
    allowed=(ROOT/'data/acceptance-course-path').resolve()
    if not config_path.is_relative_to(allowed):raise SystemExit('Config must be inside ignored course-path acceptance directory')
    config=json.loads(config_path.read_text(encoding='utf-8'));run=config_path.parent
    if config.get('approval')!='confirmed' or config.get('attempt_limit')!=6 or config.get('token_limit')!=50000:
        raise SystemExit('Explicit current authorization (6 attempts / 50000 tokens) required')
    files=[Path(p).resolve() for p in config['materials']]
    if len(files)!=2 or any(not p.is_file() or p.suffix.lower()!='.pdf' for p in files):raise SystemExit('Exactly two existing PDFs required')
    os.environ.update(EXAM_ENGINE_DATA_DIR=str(run),DATABASE_URL='sqlite:///'+(run/'review.db').as_posix(),
                      ASSISTANT_GENERATION_ENABLED='1',ASSISTANT_GENERATION_MOCK='0')
    sys.path.insert(0,str(ROOT/'backend'))
    from app.database import Base,engine,SessionLocal
    from app.main import create_app
    from app.models import Course,Source,DocumentNode,EvidenceBlock,LearningSession,LearningTask
    from app.parsing import parse_pdf
    from app.dependencies import get_model_gateway
    from app.model_gateway import ModelGateway,OpenAIProvider
    uploads=run/'uploads';uploads.mkdir(exist_ok=True)
    Base.metadata.create_all(engine) # Only this explicit isolated review database.
    manifest_path=run/'manifest.json'
    if not manifest_path.exists():
        with SessionLocal() as db:
            course=Course(name=config['course_name'],school='本机真实课程隔离演练');db.add(course);db.flush()
            sources=[];task_evidence=[]
            for index,file in enumerate(files):
                identity=str(uuid4());target=uploads/(identity+'.pdf');shutil.copyfile(file,target)
                digest=sha256(target.read_bytes()).hexdigest();parsed=parse_pdf(identity,target)
                if parsed.status!='ready':raise RuntimeError('PDF extraction needs review: '+str(parsed.error))
                source=Source(id=identity,course_id=course.id,original_name=file.name,storage_key=target.name,
                    extension='.pdf',media_type='application/pdf',size_bytes=target.stat().st_size,sha256=digest,status='ready',
                    material_type='courseware',processing_stage='ready',processing_note='隔离演练：复用确定性PDF解析，无额外模型分析')
                db.add(source);db.flush()
                for n in parsed.nodes:db.add(DocumentNode(source_id=identity,**asdict(n)))
                db.flush()
                for b in parsed.blocks:
                    db.add(EvidenceBlock(source_id=identity,**asdict(b)))
                    if index==0 and b.page_number==config['exercise_page']:task_evidence.append(b.id)
                sources.append({'id':identity,'name':file.name,'sha256':digest,'pages':len(parsed.nodes)})
            if not task_evidence:raise RuntimeError('Exercise source page missing')
            session=LearningSession(course_id=course.id,stage='diagnosing',knowledge_mode='course_specific');db.add(session);db.flush()
            task=LearningTask(session_id=session.id,kind='diagnostic',ordinal=0,knowledge_point=config['knowledge_point'],
                question_type='short_answer',stem=config['exercise_text'],options=[],reference_answer='',remediation_answer='',analysis='',
                evidence_ids=task_evidence,provenance='original',answer_provenance='missing',validation_status='validated',
                visible_limitation='原资料练习人工选入隔离演练；未验证自动选题与判分，仅验证草稿中断恢复。')
            db.add(task);db.flush();session.current_task_id=task.id;db.commit()
            manifest={'course_id':course.id,'session_id':session.id,'task_id':task.id,'sources':sources,
                      'limits':{'attempts':6,'tokens':50000},'grading_verified':False}
            manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    else:
        manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
        if [sha256(p.read_bytes()).hexdigest() for p in files]!=[s['sha256'] for s in manifest['sources']]:raise RuntimeError('Materials changed')
    if not args.serve:
        print(json.dumps({'state':'prepared_no_model_calls','manifest':manifest},ensure_ascii=False));return
    gateway=ModelGateway.from_env()
    if not isinstance(gateway.provider,OpenAIProvider) or gateway.provider.mocked:raise RuntimeError('Configured live model required')
    gateway.provider.request_attempts=1;gateway.provider.allow_connection_fallback=False
    gateway.provider=CappedProvider(gateway.provider,run,6,50000)
    gateway.course_token_budget=50000;gateway.daily_token_budget=50000
    app=create_app(storage_dir=uploads);app.dependency_overrides[get_model_gateway]=lambda:gateway
    print(json.dumps({'state':'ready_no_call_until_explicit_send','model':gateway.provider.model,'port':config['port'],'course_id':manifest['course_id']},ensure_ascii=False),flush=True)
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=config['port'])


if __name__=='__main__':main()
