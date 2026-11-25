"""Reuse existing tutoring locks/events without dispatching tutoring.send again."""
from uuid import UUID, uuid5
from sqlalchemy import select
from . import assistant_workspace as ws, tutoring
from .assistant_workspace_models import WorkItem
from .models import TutoringTurn
from .session_access import get_progress_version, record_session_event, get_latest_attempt

def inspect(db,request,topic):
    targets=[]
    for identity in topic.item_ids:
        item=ws.scoped(db,WorkItem,request.course_id,identity)
        if not item.task_id:
            continue
        session,task=ws.task_for(db,request.course_id,item.session_id,item.task_id)
        business=ws.projection(db,ws.course_for(db,request.course_id),item)
        latest=get_latest_attempt(db,task.id)
        historical_compare=topic.mode=='compare' and not business['is_current'] and latest is not None and latest.verdict!='ungraded' and task.status!='withdrawn' and not db.scalar(select(TutoringTurn.id).where(TutoringTurn.task_id==task.id,TutoringTurn.status=='running'))
        if not business['can_tutor'] and not historical_compare:
            ws.fail('teaching_unavailable',business['tutor_reason'] or '此题当前不能提供真实帮助')
        rows=tutoring._check_source(db,task,request.course_id)
        targets.append({'session_id':session.id,'task_id':task.id,'material_version':tutoring._material_version(task,rows),'consent_required':task.kind=='retest' and not tutoring._consented(db,task.id)})
    return targets

def reserve(db,request,topic,allow_help=False):
    targets=inspect(db,request,topic)
    if any(t['consent_required'] for t in targets) and not allow_help:
        ws.fail('help_required','此讨论包含独立重测题。接受帮助后，该题不再计作无提示重测；是否继续？')
    # Inspect every target before recording any permission or lock.
    for target in targets:
        session,task=ws.task_for(db,request.course_id,target['session_id'],target['task_id'])
        if target['consent_required']:
            record_session_event(db,session.id,'tutoring_retest_consent',task.id,request_id=request.id)
            record_session_event(db,session.id,'hint_requested',task.id,kind_of_help='explicit_retest_opt_out',request_id=request.id)
        prior=tutoring._turns(db,session.id,task.id)
        turn=TutoringTurn(session_id=session.id,task_id=task.id,request_id=str(uuid5(UUID(request.id),task.id)),sequence=(prior[-1].sequence if prior else 0)+1,student_message=request.intent['text'],progress_version=get_progress_version(db,session),context={'assistant_request_id':request.id,'public_only':True},reply={})
        db.add(turn);db.flush()
        target['turn_id']=turn.id;target['turn_request_id']=turn.request_id
    for target in targets:
        session,_=ws.task_for(db,request.course_id,target['session_id'],target['task_id'])
        target['progress_version']=get_progress_version(db,session)
    return targets

def validate(db,request):
    for target in request.teaching:
        session,task=ws.task_for(db,request.course_id,target['session_id'],target['task_id'])
        db.refresh(session)
        if get_progress_version(db,session)!=target['progress_version'] or tutoring._material_version(task,tutoring._check_source(db,task,request.course_id))!=target['material_version']:
            ws.fail('context_stale','题目或学习进度已变化，本次回答未发布')
        turn=db.get(TutoringTurn,target['turn_id'])
        if not turn or turn.status!='running':
            ws.fail('context_stale','帮助请求状态已变化，回答未发布')

def finish(db,request,published=False,reply=None):
    for target in request.teaching:
        turn=db.get(TutoringTurn,target['turn_id'])
        if not turn or turn.status!='running':
            continue
        turn.usage_id=request.usage_id
        turn.status='saved' if published else 'failed'
        turn.error='' if published else '统一助手请求未发布；已有许可及用量保留'
        if published:
            # Conservative full-help classification avoids a new model call to classify help.
            turn.reply={'message':reply['reply'],'action':'explain','reason':'统一助手已校验发布','evidence_ids':[],'help_level':'worked_answer','observation':'不作为掌握证据','uncertainty':'帮助按完整解法保守记录'}
            record_session_event(db,turn.session_id,'hint_requested',turn.task_id,kind_of_help='tutoring',turn_id=turn.id,request_id=request.id,help_level='worked_answer',delivery='saved_unconfirmed')
            record_session_event(db,turn.session_id,'tutoring_saved',turn.task_id,turn_id=turn.id,request_id=request.id,action='explain')
