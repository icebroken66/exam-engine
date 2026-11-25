"""Public V10 browser fixture, explicit isolated database only, mock dispatch only."""
import os
import json
from pathlib import Path
import sys
from hashlib import sha256
import time
if os.getenv('FEV10_ISOLATED_FIXTURE')!='1' or not os.getenv('DATABASE_URL') or not os.getenv('EXAM_ENGINE_DATA_DIR'):raise RuntimeError('Explicit isolated environment required')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.main import create_app
from app.database import Base,engine,SessionLocal
from app.models import Course,Source
from app.model_gateway import ModelGateway,MockProvider,ProviderReply,TokenUsage
from app.dependencies import get_model_gateway
from reportlab.pdfgen import canvas
from fev08_public_fixture import seed
root=Path(os.environ['EXAM_ENGINE_DATA_DIR']);uploads=root/'uploads';uploads.mkdir(parents=True,exist_ok=True)
Base.metadata.create_all(engine) # Explicit fixture, never invoked for normal application migration.
if not (root/'fixture.json').exists():
    with SessionLocal() as db:
        for n in range(2):
            course=Course(school='公开夹具',name='FE-V10公开课程'+str(n+1));db.add(course);db.flush()
            file=uploads/('public-'+str(n)+'.pdf');c=canvas.Canvas(str(file));c.drawString(72,720,'Mutual exclusion protects shared data.');c.showPage();c.drawString(72,720,'Synchronization orders dependent operations.');c.showPage();c.save()
            source=Source(course_id=course.id,original_name='public-os-'+str(n)+'.pdf',storage_key=file.name,extension='.pdf',media_type='application/pdf',size_bytes=file.stat().st_size,sha256=sha256(file.read_bytes()).hexdigest(),status='ready');db.add(source)
        db.commit()
    fixture=seed();(root/'fixture.json').write_text(json.dumps(fixture,ensure_ascii=False),encoding='utf-8')
class FixtureProvider(MockProvider):
    def complete(self,system,user,max_tokens):
        if '"assistant_v10": true' not in user:raise RuntimeError('Fixture allows only V10 mentor calls')
        with (root/'provider-dispatch.jsonl').open('a',encoding='utf-8') as dispatch:dispatch.write(json.dumps({'called_at':time.time()})+'\n')
        payload=json.loads(user.split('<output_json_schema>')[0])
        if 'CANCEL_HOLD' in payload['user_text']:
            from app.assistant_generation_models import AssistantRequest
            from sqlalchemy import select
            for _ in range(200):
                with SessionLocal() as db:
                    state=db.scalar(select(AssistantRequest.state).where(AssistantRequest.intent['text'].as_string()==payload['user_text']))
                if state=='cancelled':break
                time.sleep(.1)
        elif 'RESTART_HOLD' in payload['user_text']:time.sleep(20)
        elif 'SLOW' in payload['user_text']:time.sleep(1.5)
        if 'LAYOUT' in payload['user_text']:
            text='MOCK 布局样本，不用于知识质量评审。\n\n'+('较长的解释用于检查面板内换行与滚动。'*25)+'\n\n$$x_{n+1} = x_n + 1$$\n\n```text\n'+('bounded-context-'*45)+'\n```'
            return ProviderReply(json.dumps({'reply':text,'claims':[{'text':text,'kind':'model_explanation','evidence_ids':[],'quote':''}]},ensure_ascii=False),TokenUsage(200,250))
        return super().complete(system,user,max_tokens)
app=create_app(storage_dir=uploads)
gateway=ModelGateway(FixtureProvider());app.dependency_overrides[get_model_gateway]=lambda:gateway
import uvicorn
uvicorn.run(app,host='127.0.0.1',port=int(os.getenv('FEV10_API_PORT','8037')))
