"""Public synthetic fixtures. No gateway invoked, not even a mock gateway."""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from app.assistant_workspace import digest, public_task
from app.assistant_workspace_models import Topic, WorkItem, WorkspaceCommand
from app.models import AssistantSnapshot, LearningAttempt, LearningEvent, LearningSession, LearningTask, ReaderSnapshot, Source, TutoringTurn, UsageRecord
from app.reader_routes import PREVIEW_VERSION


def cmd(rev=0, **values):
    return {'command_id': str(uuid4()), 'expected_revision': rev, **values}


@pytest.fixture
def ws(client, session_factory, tmp_path):
    courses = [client.post('/api/courses', json={'school': '公开测试学校', 'name': name}).json()['id'] for name in ('并发课程A', '隔离课程B')]
    sources = []
    from reportlab.pdfgen import canvas
    for n, course in enumerate(courses):
        pdf = BytesIO(); c = canvas.Canvas(pdf); c.drawString(40, 700, f'Public fixture {n} page 1'); c.showPage(); c.drawString(40, 700, f'Public fixture {n} page 2'); c.save()
        r = client.post(f'/api/courses/{course}/sources', files={'file': ('same-name.pdf', pdf.getvalue(), 'application/pdf')}, data={'rights_confirmed': 'true'})
        assert r.status_code == 201, r.text
        sources.append(r.json()['source'])
    tasks = []
    with session_factory() as db:
        for n, course in enumerate(courses):
            s = LearningSession(course_id=course, stage='diagnosing'); db.add(s); db.flush()
            course_tasks = []
            for m in range(2):
                task = LearningTask(session_id=s.id, kind='diagnostic', ordinal=m, knowledge_point=f'公开计算{n}-{m}', question_type='short_answer', stem=f'计算 {n + 2} + {m + 3}', options=[], reference_answer='PRIVATE_TEACHER_REFERENCE', remediation_answer='PRIVATE_REMEDIATION', analysis='PRIVATE_TEACHER_ANALYSIS', rubric=['PRIVATE_RUBRIC'], evidence_ids=[], provenance='original')
                db.add(task); db.flush(); course_tasks.append(task.id)
            s.current_task_id = course_tasks[0]; tasks.append((s.id, course_tasks))
        db.commit()
    return {'client': client, 'factory': session_factory, 'courses': courses, 'sources': sources, 'tasks': tasks, 'root': tmp_path, 'url': f'/api/courses/{courses[0]}/assistant/v2'}


def item(w, index=0, task=0):
    course = w['courses'][index]; session, tasks = w['tasks'][index]
    r = w['client'].post(f'/api/courses/{course}/assistant/v2/items', json=cmd(kind='platform_task', title='公开题目', session_id=session, task_id=tasks[task]))
    assert r.status_code == 200, r.text
    return r.json()


def topic(w, items=(), mode=None):
    r = w['client'].post(w['url'] + '/topics', json=cmd(title='公开主题', mode=mode or ('single' if len(items) == 1 else 'compare' if len(items) == 2 else 'independent'), item_ids=[i['id'] for i in items]))
    assert r.status_code == 200, r.text
    return r.json()


def binding(w, role='document_excerpt', index=0, task=0, **patch):
    if role == 'document_excerpt':
        source = w['sources'][index]
        return dict(role=role, source_id=source['id'], source_sha256=source['sha256'], preview_version=PREVIEW_VERSION, page=1, regions=[dict(x=.1, y=.2, width=.3, height=.1)], precision='text', text=f'公开用户片段{index}', **patch)
    session, tasks = w['tasks'][index]
    return dict(role=role, session_id=session, task_id=tasks[task], **patch)


def attach(w, t, b, **values):
    return w['client'].post(w['url'] + '/topics/' + t['id'] + '/bindings', json=cmd(t['revision'], confirmed=True, binding=b, **values))


def preview(w, t, **patch):
    body = dict(expected_revision=t['revision'], context_revision=t['context_revision'], question='解释这个概念')
    body.update(patch)
    return w['client'].post(w['url'] + '/topics/' + t['id'] + '/manifest', json=body)


def formal(w):
    with w['factory']() as db:
        return [[json.dumps({c.name: str(getattr(row, c.name)) for c in model.__table__.columns}, sort_keys=True) for row in db.scalars(select(model).order_by(model.id))] for model in (LearningSession, LearningTask, LearningAttempt, LearningEvent, TutoringTurn, UsageRecord, ReaderSnapshot)]


def test_image_upload_rejects_non_image_and_returns_normalized_metadata(ws):
    bad=ws['client'].post('/api/courses/'+ws['courses'][0]+'/assistant/v2/images',files={'file':('notes.txt',b'not-an-image','text/plain')})
    assert bad.status_code in (415,422)
    from PIL import Image
    image=BytesIO(); Image.new('RGB',(96,96),(40,80,120)).save(image,format='PNG')
    good=ws['client'].post('/api/courses/'+ws['courses'][0]+'/assistant/v2/images',files={'file':('paper.png',image.getvalue(),'image/png')})
    assert good.status_code==201 and good.json()['image_version']=='assistant-image-normalized-v1'
    assert good.json()['image_width']==96 and good.json()['image_height']==96


def paper_image(w,index=0):
    from PIL import Image
    image=BytesIO();Image.new('RGB',(96,96),(40,80,120)).save(image,format='PNG')
    r=w['client'].post(f"/api/courses/{w['courses'][index]}/assistant/v2/images",files={'file':('paper.png',image.getvalue(),'image/png')})
    assert r.status_code==201,r.text
    return {key:value for key,value in r.json().items() if key.startswith('image_')}


def test_paper_binding_scope_version_single_image_and_no_learning_writes(ws):
    from app.models import LearningSession
    before=formal(ws);t=topic(ws,[item(ws)]);meta=paper_image(ws)
    draft=binding(ws,role='student_work',text='',**meta)
    for patch in ({'image_sha256':'f'*64},{'image_version':'old'},{'image_width':95}):
        assert attach(ws,t,{**draft,**patch}).status_code==409
    other=paper_image(ws,index=1)
    assert attach(ws,t,{**draft,**other}).status_code==410
    assert attach(ws,t,{**draft,'role':'question'}).status_code==422
    assert attach(ws,t,binding(ws,role='student_work',text='',image_correction='没有图片')).status_code==422
    assert attach(ws,t,{**draft,'image_correction':' '*4}).status_code==422
    t=attach(ws,t,draft).json();assert t['bindings'][0]['role']=='student_work'
    assert attach(ws,t,draft).status_code==422
    replacement=attach(ws,t,draft,replace_id=t['bindings'][0]['id']);assert replacement.status_code==200
    assert len(replacement.json()['bindings'])==1
    compare=topic(ws,[item(ws),item(ws,task=1)])
    with ws['factory']() as db:
        db.get(LearningSession,ws['tasks'][0][0]).current_task_id=ws['tasks'][0][1][1];db.commit()
    assert attach(ws,compare,draft).status_code==409
    after=formal(ws);assert before[1:]==after[1:]


@pytest.mark.parametrize('case',['small','pixels','bytes','gif','corrupt'])
def test_paper_image_rejects_invalid_bounds(ws,case,monkeypatch):
    from PIL import Image
    from app import assistant_images
    image=BytesIO()
    if case=='small':Image.new('RGB',(63,96)).save(image,format='PNG')
    elif case=='gif':Image.new('RGB',(96,96)).save(image,format='GIF')
    elif case=='corrupt':image.write(b'invalid image')
    else:
        Image.new('RGB',(96,96)).save(image,format='PNG')
        monkeypatch.setattr(assistant_images,'MAX_PIXELS' if case=='pixels' else 'MAX_UPLOAD_BYTES',100)
    result=ws['client'].post(ws['url']+'/images',files={'file':('paper.png',image.getvalue(),'image/png')})
    assert result.status_code in (413,415,422),result.text


def test_learning_focus_only_current_task_and_no_formal_mutation(ws):
    before=formal(ws);t=topic(ws,[item(ws)])
    assert attach(ws,t,{**binding(ws),'learning_focus':'无题目身份'}).status_code==422
    assert attach(ws,t,binding(ws,role='student_work',text='草稿',learning_focus=' ')).status_code==422
    good=attach(ws,t,binding(ws,role='student_work',text='我卡在第二步',learning_focus='只讲第二步计算'))
    assert good.status_code==200,good.text
    assert len(good.json()['bindings'][0]['learning_focus_version'])==64
    assert formal(ws)==before
    compare=topic(ws,[item(ws),item(ws,task=1)])
    assert attach(ws,compare,binding(ws,role='student_work',task=1,text='旧题说明',learning_focus='不可跨题沿用')).status_code==409


def test_saved_paper_preview_is_scoped_version_checked_and_read_only(ws):
    from PIL import Image
    t=topic(ws,[item(ws)]);meta=paper_image(ws)
    t=attach(ws,t,binding(ws,role='student_work',text='保留草稿',**meta)).json()
    b=t['bindings'][0];path=ws['url']+'/topics/'+t['id']+'/bindings/'+b['id']+'/image'
    before=formal(ws)
    result=ws['client'].get(path);assert result.status_code==200,result.text
    assert result.headers['content-type']=='image/jpeg' and result.headers['cache-control']=='no-store'
    assert result.headers['x-content-type-options']=='nosniff'
    with Image.open(BytesIO(result.content)) as pixels:assert pixels.size==(96,96)
    assert formal(ws)==before
    cross=path.replace(ws['courses'][0],ws['courses'][1]);assert ws['client'].get(cross).status_code==404
    other=topic(ws,[item(ws)]);assert ws['client'].get(path.replace(t['id'],other['id'])).status_code==404
    with ws['factory']() as db:
        row=db.get(Topic,t['id']);changed=[dict(row.bindings[0])];changed[0]['image_sha256']='f'*64;row.bindings=changed;db.commit()
    assert ws['client'].get(path).status_code==409
    with ws['factory']() as db:
        row=db.get(Topic,t['id']);row.bindings=[];db.commit()
    assert ws['client'].get(path).status_code==404
    assert formal(ws)==before


def test_original_paper_preserves_bytes_mapping_and_rejects_tampering(ws):
    from PIL import Image
    image=BytesIO();original=Image.new('RGB',(3000,100),(20,80,120));exif=Image.Exif();exif[274]=6
    original.save(image,format='JPEG',exif=exif)
    data=image.getvalue();result=ws['client'].post(ws['url']+'/images',files={'file':('camera.jpg',data,'image/jpeg')})
    assert result.status_code==201,result.text
    meta={k:v for k,v in result.json().items() if k.startswith('image_')}
    t=topic(ws,[item(ws)]);t=attach(ws,t,binding(ws,role='student_work',text='',**meta)).json();b=t['bindings'][0]
    mapping=b['image_original'];assert mapping['original_sha256']==sha256(data).hexdigest()
    assert mapping['original_width']==3000 and mapping['original_height']==100 and mapping['exif_orientation']==6
    assert mapping['normalized_height']==2400 and mapping['normalized_width']==80
    assert mapping['transform']=='exif_transpose_then_contain_no_crop'
    path=ws['url']+'/topics/'+t['id']+'/bindings/'+b['id']+'/image?original=true'
    before=formal(ws);response=ws['client'].get(path)
    assert response.status_code==200 and response.content==data
    assert response.headers['content-type']=='image/jpeg' and 'attachment' in response.headers['content-disposition']
    assert ws['client'].get(path.replace(ws['courses'][0],ws['courses'][1])).status_code==404
    original_path=ws['root']/'uploads'/'assistant_images'/ws['courses'][0]/(b['image_id']+'.original')
    original_path.write_bytes(b'changed');assert ws['client'].get(path).status_code==409
    original_path.unlink();assert ws['client'].get(path).status_code==410
    assert formal(ws)==before


def test_legacy_paper_has_no_fake_original_and_client_cannot_supply_metadata(ws):
    t=topic(ws,[item(ws)]);meta=paper_image(ws)
    root=ws['root']/'uploads'/'assistant_images'/ws['courses'][0]
    (root/(meta['image_id']+'.original')).unlink();(root/(meta['image_id']+'.json')).unlink()
    draft=binding(ws,role='student_work',text='',**meta)
    assert attach(ws,t,{**draft,'image_original':{'original_sha256':'fake'}}).status_code==422
    response=attach(ws,t,draft);assert response.status_code==200,response.text
    t=response.json();b=t['bindings'][0];assert not b.get('image_original')
    path=ws['url']+'/topics/'+t['id']+'/bindings/'+b['id']+'/image'
    assert ws['client'].get(path).status_code==200
    assert ws['client'].get(path+'?original=true').status_code==410


def test_paper_upload_honors_write_switch(ws,monkeypatch):
    monkeypatch.setenv('ASSISTANT_WORKSPACE_WRITES','0')
    result=ws['client'].post(ws['url']+'/images',files={'file':('paper.png',b'invalid','image/png')})
    assert result.status_code==409 and result.json()['detail']['code']=='workspace_read_only'


def test_retake_replaces_single_image_preserves_original_and_cas(ws):
    t=topic(ws,[item(ws)]);first=paper_image(ws)
    t=attach(ws,t,binding(ws,role='student_work',text='第一版',image_correction='旧图负号',**first)).json()
    old=t['bindings'][0];second=paper_image(ws);before=formal(ws)
    payload=cmd(t['revision'],confirmed=True,replace_id=old['id'],binding=binding(ws,role='student_work',text='第二版',**second))
    path=ws['url']+'/topics/'+t['id']+'/bindings'
    response=ws['client'].post(path,json=payload);assert response.status_code==200,response.text
    result=response.json();assert len(result['bindings'])==1
    new=result['bindings'][0];assert new['supersedes']==old['id'] and new['image_id']==second['image_id'] and not new['image_correction']
    assert ws['client'].post(path,json=payload).json()==result
    assert ws['client'].post(path,json={**payload,'command_id':str(uuid4())}).status_code==409
    old_path=ws['root']/'uploads'/'assistant_images'/ws['courses'][0]/(old['image_id']+'.original')
    assert old_path.is_file() and sha256(old_path.read_bytes()).hexdigest()==old['image_original']['original_sha256']
    assert formal(ws)==before


def test_items_identity_pause_history_and_no_formal_mutation(ws):
    before = formal(ws); a = item(ws); b = item(ws, task=1)
    assert a['id'] != b['id'] and item(ws)['id'] == a['id']
    assert a['business']['is_current'] and not b['business']['can_submit']
    assert '历史' in b['business']['reason']
    url = ws['url'] + '/items/' + a['id'] + '/attention'
    pause = cmd(a['revision'], attention='paused')
    paused = ws['client'].post(url, json=pause).json()
    assert paused['revision'] == 2 and paused['attention'] == 'paused'
    assert ws['client'].post(url, json=pause).json() == paused
    assert ws['client'].post(url, json={**pause, 'attention': 'ongoing'}).status_code == 409
    assert ws['client'].post(url, json=cmd(1, attention='ongoing')).status_code == 409
    assert ws['client'].post(url, json=cmd(2, attention='finished')).status_code == 422
    assert ws['client'].post(url, json=cmd(2, attention='ongoing')).json()['revision'] == 3
    exploration = ws['client'].post(ws['url'] + '/items', json=cmd(kind='exploration', title='独立探索')).json()
    assert ws['client'].post(ws['url'] + '/items/' + exploration['id'] + '/attention', json=cmd(1, attention='finished')).json()['attention'] == 'finished'
    assert formal(ws) == before


def test_topics_composer_cas_replay_and_context_revision(ws):
    t = topic(ws); other = topic(ws); url = ws['url'] + '/topics/' + t['id'] + '/composer'
    payload = cmd(1, text='窗口一的中文草稿')
    a = ws['client'].put(url, json=payload).json()
    assert a['text'] == payload['text'] and a['revision'] == 2 and a['context_revision'] == 0
    assert ws['client'].put(url, json=payload).json() == a
    assert ws['client'].put(url, json={**payload, 'text': '异载荷'}).status_code == 409
    assert ws['client'].put(url, json=cmd(1, text='窗口二')).status_code == 409
    assert ws['client'].get(ws['url'] + '/topics/' + other['id']).json()['text'] == ''
    bound = attach(ws, a, binding(ws)).json()
    assert bound['context_revision'] == 1
    assert ws['client'].put(url, json=cmd(2, text='竞争正文')).status_code == 409
    assert ws['client'].get(ws['url'] + '/topics/' + t['id']).json()['bindings'] == bound['bindings']
    replacement = attach(ws, bound, {**binding(ws), 'page': 2}, replace_id=bound['bindings'][0]['id']).json()
    assert len(replacement['bindings']) == 1 and replacement['bindings'][0]['supersedes'] == bound['bindings'][0]['id']
    removed = ws['client'].request('DELETE', ws['url'] + '/topics/' + t['id'] + '/bindings/' + replacement['bindings'][0]['id'], json=cmd(replacement['revision'])).json()
    assert removed['bindings'] == [] and removed['context_revision'] == 3


def test_manifest_readonly_no_gateway_no_hidden_content(ws, monkeypatch):
    from app.model_gateway import ModelGateway
    # Any future accidental gateway dispatch must fail this test.
    for name in ('generate_json', '_generate_json_once', 'complete', 'generate', 'chat', 'structured'):
        if hasattr(ModelGateway, name):
            monkeypatch.setattr(ModelGateway, name, lambda *a, **k: pytest.fail('gateway called'))
    a = item(ws); t = topic(ws, [a]); t = attach(ws, t, binding(ws, role='question', text='伪造题干 PRIVATE_CLIENT')).json()
    before = formal(ws)
    with ws['factory']() as db:
        timestamps = [(r.id, r.updated_at) for r in db.scalars(select(Topic))]
        receipts = db.scalar(select(func.count()).select_from(WorkspaceCommand))
    m = preview(ws, t); assert m.status_code == 200, m.text
    m = m.json(); assert m['status'] == 'ready_model_disabled' and not m['model_called'] and not m['can_send']
    raw = json.dumps(m); assert 'PRIVATE_' not in raw and 'reference_answer' not in raw and 'rubric' not in raw and 'storage_key' not in raw
    assert m['included'][0]['text'] == '计算 2 + 3'
    assert formal(ws) == before
    with ws['factory']() as db:
        assert timestamps == [(r.id, r.updated_at) for r in db.scalars(select(Topic))]
        assert receipts == db.scalar(select(func.count()).select_from(WorkspaceCommand))
    assert preview(ws, t, context_revision=99).json()['detail']['code'] == 'context_stale'
    assert preview(ws, topic(ws)).json()['status'] == 'ready_model_disabled'


def test_drafts_submitted_feedback_and_compare_scope(ws):
    a, b = item(ws), item(ws, task=1); t = topic(ws, [a]); old = topic(ws, [a]); new = topic(ws, [b])
    draft = binding(ws, role='student_work', text='未提交：5')
    t = attach(ws, t, draft).json()
    assert t['bindings'][0]['provenance'] == 'user_declared_unsubmitted'
    assert attach(ws, new, draft).status_code == 409
    assert preview(ws, new).json()['included'] == []
    with ws['factory']() as db:
        s, tasks = ws['tasks'][0]
        attempt = LearningAttempt(session_id=s, task_id=tasks[0], attempt_number=1, answer='公开已提交5', verdict='correct', grading_layer='human', feedback='公开可见反馈', missing_points=[], provider='human', model='none')
        db.add(attempt); db.commit(); aid = attempt.id
    t = attach(ws, t, binding(ws, role='submitted_answer', attempt_id=aid, text='客户端伪造')).json()
    t = attach(ws, t, binding(ws, role='visible_feedback', attempt_id=aid)).json()
    assert t['bindings'][1]['text'] == '公开已提交5' and t['bindings'][2]['text'] == '公开可见反馈'
    compare = topic(ws, [a, b]); compare = attach(ws, compare, draft).json()
    compare = attach(ws, compare, binding(ws, role='question', task=1)).json()
    m = preview(ws, compare).json(); assert len(m['groups']) == 2 and all(g['bindings'] for g in m['groups'])
    with ws['factory']() as db:
        session = db.get(LearningSession, ws['tasks'][0][0]); session.current_task_id = ws['tasks'][0][1][1]; db.commit()
    m = preview(ws, t).json(); assert m['status'] == 'context_stale' and all(x['reason'] == 'task_not_current' for x in m['excluded'])
    assert preview(ws, compare).json()['status'] == 'ready_model_disabled'
    assert preview(ws, old).json()['included'] == []


@pytest.mark.parametrize('mutation,reason', [('removed', 'source_removed'), ('hash', 'source_hash_changed'), ('preview', 'preview_changed'), ('page', 'page_out_of_range'), ('physical', 'source_hash_changed')])
def test_document_stale_versions(ws, mutation, reason):
    t = topic(ws); t = attach(ws, t, binding(ws)).json()
    with ws['factory']() as db:
        source = db.get(Source, ws['sources'][0]['id']); row = db.get(Topic, t['id'])
        if mutation == 'removed': source.removed_at = datetime.now(timezone.utc)
        if mutation == 'hash': source.sha256 = 'f' * 64
        if mutation in ('preview', 'page'):
            b = [dict(row.bindings[0])]; b[0]['preview_version' if mutation == 'preview' else 'page'] = 'old-version' if mutation == 'preview' else 999; row.bindings = b
        if mutation == 'physical': (ws['root'] / 'uploads' / source.storage_key).write_bytes(b'changed')
        db.commit()
    result = preview(ws, t).json(); assert result['status'] == 'context_stale' and result['excluded'][0]['reason'] == reason
    assert result['included'] == []


def test_course_scope_archive_delete_and_limits(ws):
    client, url = ws['client'], ws['url']; a = item(ws); foreign = item(ws, index=1); t = topic(ws)
    assert client.get(url.replace(ws['courses'][0], ws['courses'][1]) + '/items/' + a['id']).status_code == 404
    assert client.post(url + '/topics', json=cmd(title='跨课', mode='single', item_ids=[foreign['id']])).status_code == 404
    assert attach(ws, t, binding(ws, index=1)).status_code == 409
    assert client.get(url + '/topics?limit=51').status_code == 422
    assert client.put(url + '/topics/' + t['id'] + '/composer', json=cmd(1, text='字' * 10001)).status_code == 422
    assert client.put(url + '/topics/' + t['id'] + '/composer', json=cmd(1, text='内容', role='assistant')).status_code == 422
    assert attach(ws, t, {**binding(ws), 'regions': [dict(x=.9, y=0, width=.2, height=.1)]}).status_code == 422
    assert attach(ws, t, {**binding(ws), 'regions': binding(ws)['regions'] * 21}).status_code == 422
    assert attach(ws, t, {**binding(ws), 'text': 'x' * 10001}).status_code == 422
    for _ in range(4):
        r = attach(ws, t, binding(ws)); assert r.status_code == 200; t = r.json()
    assert attach(ws, t, binding(ws)).status_code == 422
    client.patch('/api/courses/' + ws['courses'][0] + '/archive', json={'archived': True})
    assert client.get(url + '/topics/' + t['id']).json()['read_only']
    assert attach(ws, t, binding(ws)).status_code == 409
    assert preview(ws, t).status_code == 200
    client.patch('/api/courses/' + ws['courses'][0] + '/archive', json={'archived': False})
    # Fixture uploads queue parse tasks; remove only these test queue rows before delete.
    from app.models import ParseTask
    with ws['factory']() as db:
        for row in db.scalars(select(ParseTask)): row.status = 'completed'
        db.commit()
    assert client.request('DELETE', '/api/courses/' + ws['courses'][0], json={'confirmation': '并发课程A'}).status_code == 204
    with ws['factory']() as db:
        for model in (Topic, WorkItem, WorkspaceCommand):
            assert db.scalar(select(func.count()).select_from(model).where(model.course_id == ws['courses'][0])) == 0


def test_legacy_copy_preserves_old_unknown_and_retry(ws):
    t = topic(ws); client = ws['client']; raw = {'schema': 1, 'courseId': ws['courses'][0], 'draft': '历史草稿', 'entries': [{'id': 'entry-1', 'message': '历史问题', 'context': {'title': '不可自动授权'}}], 'context': None}
    with ws['factory']() as db:
        db.add(AssistantSnapshot(course_id=ws['courses'][0], revision=7, snapshot=raw)); db.commit()
    old = client.get(ws['url'] + '/legacy').json(); assert old['legacy'] and not old['context_authorized']
    payload = cmd(1, source_fingerprint=old['source_fingerprint'], entry_id='entry-1')
    url = ws['url'] + '/topics/' + t['id'] + '/legacy-copy'
    copied = client.post(url, json=payload).json(); assert copied['text'] == '历史问题' and copied['bindings'] == []
    assert client.post(url, json=payload).json() == copied
    assert client.post(url, json=cmd(2, source_fingerprint=old['source_fingerprint'])).status_code == 409
    with ws['factory']() as db:
        row = db.get(AssistantSnapshot, ws['courses'][0]); assert row.snapshot == raw and row.revision == 7
        row.snapshot = {'schema': 99, 'opaque': '保留未知原始内容'}; db.commit()
    unknown = client.get(ws['url'] + '/legacy').json(); assert not unknown['supported'] and unknown['snapshot']['opaque'] == '保留未知原始内容'


def test_rollback_flag_and_migration(tmp_path, ws, monkeypatch):
    monkeypatch.setenv('ASSISTANT_WORKSPACE_WRITES', '0')
    assert ws['client'].post(ws['url'] + '/topics', json=cmd(title='禁止写', mode='independent')).status_code == 409
    assert ws['client'].get(ws['url'] + '/topics').status_code == 200
    import importlib.util
    from sqlalchemy import create_engine, text, inspect
    spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[2] / 'scripts/migrate_assistant_workspace.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    url = 'sqlite:///' + (tmp_path / 'migration.db').as_posix(); engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE courses (id VARCHAR(36) PRIMARY KEY, legacy TEXT)')); conn.execute(text("INSERT INTO courses VALUES ('old', 'keep')"))
    assert len(module.migrate(url)) == 3; module.migrate(url)
    with engine.connect() as conn:
        assert conn.execute(text('SELECT legacy FROM courses')).scalar() == 'keep'
    assert [c['name'] for c in inspect(engine).get_columns('courses')] == ['id', 'legacy']
    engine.dispose()


def test_public_target_fingerprint_feedback_visibility_and_bookmarks(ws):
    a, b = item(ws), item(ws, task=1); t = topic(ws, [a]); client = ws['client']
    wrong = binding(ws, role='question', task_fingerprint='0' * 64)
    assert attach(ws, t, wrong).json()['detail']['code'] == 'task_changed'
    assert attach(ws, topic(ws, [b]), binding(ws, role='question', task=1)).json()['detail']['code'] == 'task_not_current'
    assert attach(ws, t, {**binding(ws), 'role': 'assistant'}).status_code == 422
    with ws['factory']() as db:
        session, tasks = ws['tasks'][0]
        attempt = LearningAttempt(session_id=session, task_id=tasks[0], attempt_number=1, answer='公开答案', verdict='ungraded', grading_layer='human', feedback='暂不可见反馈', missing_points=[], provider='human', model='none')
        db.add(attempt); db.commit(); aid = attempt.id
    assert attach(ws, t, binding(ws, role='visible_feedback', attempt_id=aid)).json()['detail']['code'] == 'feedback_not_visible'
    with ws['factory']() as db:
        row = db.get(LearningAttempt, aid); row.verdict = 'correct'; row.feedback = '已显示反馈'; db.commit()
    t = attach(ws, t, binding(ws, role='visible_feedback', attempt_id=aid)).json()
    with ws['factory']() as db:
        db.get(LearningAttempt, aid).feedback = '人工修订反馈'; db.commit()
    assert preview(ws, t).json()['excluded'][0]['reason'] == 'attempt_changed'
    url = ws['url'] + '/items/' + a['id'] + '/attention'
    bookmark = {'relation': 'known', 'origin': {'view': 'learn', 'session_id': a['session_id'], 'task_id': a['task_id']}, 'target': {'view': 'reader', 'source_id': ws['sources'][0]['id'], 'page': 2}}
    before = formal(ws)
    saved = client.post(url, json=cmd(a['revision'], attention='paused', bookmark=bookmark)).json()
    assert saved['bookmark']['target']['page'] == 2 and saved['bookmark']['relation'] == 'known'
    bookmark['target']['source_id'] = ws['sources'][1]['id']
    assert client.post(url, json=cmd(saved['revision'], attention='ongoing', bookmark=bookmark)).status_code == 422
    assert formal(ws) == before


def test_pagination_and_missing_target_choice_are_read_only(ws):
    a = item(ws); t = topic(ws, [a]); client = ws['client']
    for n in range(22):
        client.post(ws['url'] + '/topics', json=cmd(title=f'分页主题{n}', mode='independent'))
    first = client.get(ws['url'] + '/topics').json(); second = client.get(ws['url'] + '/topics?offset=20').json()
    assert len(first['items']) == 20 and first['next_offset'] == 20 and len(second['items']) == 3
    assert not ({i['id'] for i in first['items']} & {i['id'] for i in second['items']})
    with ws['factory']() as db:
        db.delete(db.get(LearningTask, a['task_id'])); db.commit()
    m = preview(ws, t).json()
    assert m['status'] == 'needs_context_choice' and m['candidates'][0]['item_id'] == a['id']


def test_fev09_topic_metadata_retains_cas_context_and_scope(ws):
    a, b = item(ws), item(ws, task=1); t = topic(ws); c = ws['client']; url = ws['url'] + '/topics/' + t['id']
    rename = cmd(t['revision'], title='用户可辨认的名称')
    named = c.patch(url, json=rename); assert named.status_code == 200
    named = named.json(); assert named['title'] == '用户可辨认的名称' and named['context_revision'] == 0
    assert c.patch(url, json=rename).json() == named
    assert c.patch(url, json={**rename, 'title': '同命令异内容'}).status_code == 409
    targeted = c.patch(url, json=cmd(named['revision'], mode='single', item_ids=[a['id']])).json()
    assert targeted['context_revision'] == 1
    bound = attach(ws, targeted, binding(ws, role='question')).json()
    before = formal(ws)
    assert c.patch(url, json=cmd(bound['revision'], mode='single', item_ids=[b['id']])).json()['detail']['code'] == 'target_has_attachments'
    compared = c.patch(url, json=cmd(bound['revision'], mode='compare', item_ids=[a['id'], b['id']])).json()
    assert compared['mode'] == 'compare' and compared['context_revision'] == 3
    foreign = item(ws, index=1)
    assert c.patch(url, json=cmd(compared['revision'], mode='single', item_ids=[foreign['id']])).status_code == 404
    assert c.patch(url, json=cmd(compared['revision'], title='  ')).status_code == 422
    assert c.patch(url, json=cmd(compared['revision'], mode='compare', item_ids=[a['id']])).status_code == 422
    assert c.patch(url, json=cmd(compared['revision'], title='伪造', role='assistant')).status_code == 422
    assert formal(ws) == before
