from sqlalchemy import select,func
from app.models import LearningAttempt,LearningTask,LearningPointState
from test_learning_sessions import use_mock,start,answer,answer_correct
from test_questions import evidence_for_course

def test_explicit_independent_check_uses_formal_unseen_task_and_progress_guard(client,session_factory,tmp_path):
    use_mock(client);course,_=evidence_for_course(client,session_factory,tmp_path);current=start(client,course)
    url=f"/api/learning-sessions/{current['id']}/next"
    def intent(s):return dict(expected_task_id=s['current_task']['id'],expected_progress_version=s['progress_version'],independent_check=True)
    assert client.post(url,json=intent(current)).status_code==409
    graded=answer(client,current['id'],'我不会，先保留这次作答')
    assert client.post(url,json={'independent_check':True}).status_code==422
    with session_factory() as db:points=[(p.id,p.score,p.evidence_count) for p in db.scalars(select(LearningPointState))]
    response=client.post(url,json=intent(graded));assert response.status_code==200,response.text
    fresh=response.json();assert fresh['stage']=='retesting'
    assert fresh['current_task']['id']!=current['current_task']['id']
    assert fresh['current_task']['stem']!=current['current_task']['stem']
    assert fresh['current_task']['latest_attempt'] is None and fresh['current_task']['help_exposures']==0
    assert fresh['current_task']['reference_answer'] is None
    assert client.post(url,json=intent(graded)).status_code==409
    with session_factory() as db:
        assert db.scalar(select(func.count()).select_from(LearningTask))==2
        assert db.scalar(select(func.count()).select_from(LearningAttempt))==1
        assert [(p.id,p.score,p.evidence_count) for p in db.scalars(select(LearningPointState))]==points
    completed=answer_correct(client,session_factory,fresh)
    assert completed['current_task']['latest_attempt']['hints_used']==0
    assert completed['current_task']['latest_attempt']['verdict']=='correct'
