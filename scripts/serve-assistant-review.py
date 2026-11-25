"""FE-V09 review server; creates an isolated public SQLite fixture, never production."""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8031)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = root / 'data' / 'acceptance-fev09'
evidence.mkdir(parents=True, exist_ok=True)
directory = Path(tempfile.mkdtemp(prefix='review-', dir=evidence))
for key in list(os.environ):
    if key.startswith(('OPENAI_', 'MODEL_')): os.environ.pop(key)
os.environ.update(EXAM_ENGINE_DATA_DIR=str(directory), DATABASE_URL='sqlite:///' + (directory / 'review.db').as_posix(), MODEL_PROVIDER='mock')
sys.path.insert(0, str(root / 'backend'))
from app.main import create_app
from app.database import Base, engine, SessionLocal
from app.models import Course, Source
from app.model_gateway import ModelGateway
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
import uvicorn


def forbidden(*_args, **_kwargs):
    raise RuntimeError('FEV09_NO_MODEL: review must never invoke a gateway')


ModelGateway.generate_json = forbidden
uploads = directory / 'uploads'; uploads.mkdir()
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
file = uploads / 'public-os-notes.pdf'
c = canvas.Canvas(str(file), pagesize=(800, 1040))
pages = [
    ('进程同步与互斥', '操作系统原理 · 第三章', [('01', '为什么需要协调进程？'), ('', '多个进程并发执行时，可能访问同一份共享资源。'), ('', '如果访问的先后顺序影响结果，就需要明确的协调规则。'), ('02', '互斥：一次只有一个'), ('', '互斥限制多个进程同时进入临界区，保护共享数据。'), ('', '例：两个人同时修改同一个银行账户余额。'), ('03', '同步：按照约定的顺序'), ('', '同步约定不同进程的执行先后，保证依赖关系成立。'), ('', '例：生产者放入数据后，消费者才能取走数据。')]),
    ('用生产者与消费者理解', '操作系统原理 · 第三章', [('01', '共享缓冲区'), ('', '生产者与消费者共同访问有界缓冲区。'), ('02', '互斥关系'), ('', '修改缓冲区和计数器时，需要保证相互排斥。'), ('03', '同步关系'), ('', '缓冲区满时生产者等待，缓冲区空时消费者等待。')]),
    ('自己检查一下', '操作系统原理 · 第三章', [('01', '先识别共享资源'), ('', '哪些操作可能同时修改同一份数据？'), ('02', '再识别先后依赖'), ('', '哪些操作必须等待另一个操作先发生？'), ('03', '用自己的话解释'), ('', '为什么同一个问题里可能同时存在同步与互斥？')])]
for title, subtitle, lines in pages:
    c.setFillColorRGB(.28,.32,.39); c.setFont('STSong-Light',12); c.drawString(72,970,subtitle)
    c.setFillColorRGB(.08,.1,.14); c.setFont('STSong-Light',30); c.drawString(72,904,title)
    c.setStrokeColorRGB(.84,.86,.9);c.line(72,874,728,874)
    y=814
    for number,text in lines:
        c.setFont('STSong-Light',18 if number else 14)
        c.setFillColorRGB(*((.11,.16,.25) if number else (.3,.34,.4)))
        c.drawString(72,y,(number+'  ' if number else '')+text);y-=48 if number else 40
    c.setFont('STSong-Light',11);c.setFillColorRGB(.45,.48,.53);c.drawString(72,62,'公开自制教学样本 · 仅用于 FE-V09 交互评审');c.showPage()
c.save()
Base.metadata.create_all(engine)
with SessionLocal() as db:
    course=Course(name='FE-V09公开评审课',school='公开教学样本');db.add(course);db.flush()
    source=Source(course_id=course.id,original_name='第三章 · 进程同步与互斥.pdf',relative_path='操作系统/第三章.pdf',storage_key=file.name,extension='.pdf',media_type='application/pdf',size_bytes=file.stat().st_size,sha256=sha256(file.read_bytes()).hexdigest(),status='ready')
    db.add(source);db.commit()
    info={'directory':str(directory),'course_id':course.id,'source_id':source.id,'source_sha256':source.sha256,'port':args.port,'model_gateway':'forbidden'}
    (evidence/'review-server.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(info,ensure_ascii=False),flush=True)
app=create_app(storage_dir=uploads)
uvicorn.run(app,host='127.0.0.1',port=args.port)
