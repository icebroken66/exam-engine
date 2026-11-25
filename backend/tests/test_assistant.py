from copy import deepcopy
from sqlalchemy import select, func
from app.models import AssistantSnapshot, LearningEvent, UsageRecord
from test_reader import setup as reader_setup

def setup(client):
    c = client.post('/api/courses', json={'school':'测试学校','name':'助手会话课程'}).json()
    s = {'schema':1,'courseId':c['id'],'revision':0,'draft':'服务端问题','context':None,'entries':[]}
    return c, '/api/courses/'+c['id']+'/assistant', s

def test_assistant_roundtrip_conflict_and_lost_ack(client):
    _, url, s = setup(client)
    assert client.get(url).json()['snapshot'] is None
    assert client.put(url,json={'revision':0,'snapshot':s}).json()['revision']==1
    assert client.put(url,json={'revision':0,'snapshot':s}).json()['revision']==1
    stale=deepcopy(s);stale['draft']='冲突窗口'
    assert client.put(url,json={'revision':0,'snapshot':stale}).status_code==409
    assert client.get(url).json()['snapshot']['draft']=='服务端问题'
    stale['revision']=1
    assert client.put(url,json={'revision':1,'snapshot':stale}).json()['revision']==2

def test_assistant_validation_isolation_archive_delete(client,session_factory):
    c,url,s=setup(client);other,other_url,other_s=setup(client)
    assert client.put(other_url,json={'revision':0,'snapshot':s}).status_code==422
    for patch in [{'schema':99},{'draft':'x'*10001},{'context':{'kind':'document'}},{'entries':[{}]}]:
        bad={**s,**patch}
        assert client.put(url,json={'revision':0,'snapshot':bad}).status_code==422
    assert client.get(url).json()['revision']==0
    assert client.put(url,json={'revision':0,'snapshot':s}).status_code==200
    client.patch('/api/courses/'+c['id']+'/archive',json={'archived':True})
    assert client.get(url).json()['readOnly']
    assert client.put(url,json={'revision':0,'snapshot':s}).status_code==409
    assert client.post(url+'/preflight',json={'message':'问题','context':None}).status_code==409
    client.patch('/api/courses/'+c['id']+'/archive',json={'archived':False})
    assert client.request('DELETE','/api/courses/'+c['id'],json={'confirmation':c['name']}).status_code==204
    with session_factory() as db:
        assert db.get(AssistantSnapshot,c['id']) is None

def test_preflight_checks_original_page_and_never_calls_model(client,session_factory):
    course,source,_,snap=reader_setup(client)
    url='/api/courses/'+course['id']+'/assistant/preflight'
    context={'kind':'document','title':'片段','text':'用户所选片段','sourceId':source['id'],'documentId':source['sha256'],'previewVersion':snap['document']['previewVersion'],'page':1,'regions':[{'x':.1,'y':.1,'width':.2,'height':.2}]}
    with session_factory() as db:
        before=[db.scalar(select(func.count()).select_from(m)) for m in (LearningEvent,UsageRecord)]
    r=client.post(url,json={'message':'请解释','context':context})
    assert r.status_code==200 and r.json()['canSend'] is False and r.json()['modelCalled'] is False
    for patch,code in [({'page':99},422),({'documentId':'changed'},409),({'regions':[{'x':.9,'y':0,'width':.2,'height':.3}]},422),({'sourceId':'missing'},409)]:
        assert client.post(url,json={'message':'问题','context':{**context,**patch}}).status_code==code
    assert client.post(url,json={'message':'  ','context':None}).status_code==422
    with session_factory() as db:
        assert before==[db.scalar(select(func.count()).select_from(m)) for m in (LearningEvent,UsageRecord)]

def test_preflight_rejects_stale_task(client):
    _,url,_=setup(client)
    context={'kind':'question','title':'题目','text':'用户题目','sessionId':'missing','taskId':'missing','progressVersion':'stale','stage':'retesting'}
    assert client.post(url+'/preflight',json={'message':'请解释','context':context}).status_code==409

def test_current_question_preflight_uses_tutoring_without_help_side_effect(client,session_factory,tmp_path):
    from test_agent import use_mock
    from test_questions import evidence_for_course
    from test_learning_sessions import start
    use_mock(client)
    course_id,_=evidence_for_course(client,session_factory,tmp_path)
    current=start(client,course_id); task=current['current_task']
    url='/api/courses/'+course_id+'/assistant/preflight'
    context={'kind':'question','title':'题目','text':task['stem'],'sessionId':current['id'],'taskId':task['id'],'progressVersion':current['progress_version'],'stage':current['stage']}
    with session_factory() as db:
        before=[db.scalar(select(func.count()).select_from(m)) for m in (LearningEvent,UsageRecord)]
    result=client.post(url,json={'message':'解释一下','context':context})
    assert result.status_code==200 and result.json()['status']=='use_tutoring'
    assert client.post(url,json={'message':'问题','context':{**context,'kind':'answer'}}).status_code==409
    with session_factory() as db:
        assert before==[db.scalar(select(func.count()).select_from(m)) for m in (LearningEvent,UsageRecord)]
