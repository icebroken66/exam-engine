"""Explicit saved-answer relations. No learning evidence or formal notes are written."""
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import inspect, select
from . import assistant_generation as generation, assistant_workspace as workspace
from .assistant_generation_models import SavedExplanation, AssistantMessage
from .assistant_workspace_models import Topic
from .assistant_generation_dto import SaveExplanation, RevokeExplanation

def ready(db):return inspect(db.connection()).has_table(SavedExplanation.__tablename__)


def output(row, valid=True):
    return {'id':row.id,'course_id':row.course_id,'topic_id':row.topic_id,'request_id':row.request_id,
            'content':row.content,'anchors':row.anchors,'revision':row.revision,'valid':valid,
            'revoked_at':row.revoked_at,'created_at':row.created_at}


def save(db, course_id, request_id, body:SaveExplanation, upload_dir):
    if not ready(db):workspace.fail('saved_explanations_unavailable','保存关系表未迁移；请先执行增量备份迁移',503)
    workspace.course_for(db,course_id,write=True)
    def create():
        request=generation.row(db,course_id,request_id)
        if request.state!='published':workspace.fail('explanation_unavailable','只有已发布回答可保存',409)
        if request.revision!=body.expected_revision:workspace.fail('revision_conflict','回答状态已变化，请重新读取后再保存',409)
        topic=workspace.scoped(db,Topic,course_id,request.topic_id)
        message=db.scalar(select(AssistantMessage).where(AssistantMessage.course_id==course_id,AssistantMessage.request_id==request_id,AssistantMessage.role=='assistant'))
        if not message:workspace.fail('explanation_unavailable','已发布回答记录不存在',404)
        question=db.scalar(select(AssistantMessage.text).where(AssistantMessage.course_id==course_id,AssistantMessage.request_id==request_id,AssistantMessage.role=='user')) or ''
        anchors=[];citations=[]
        for evidence_id in body.evidence_ids:
            citation=generation.citation(db,course_id,request_id,evidence_id,upload_dir)
            action=citation['action']
            citations.append({'evidence_id':evidence_id,'title':citation['title'],'provenance':citation['provenance'],'kind':action['kind'],'actionable':True,'page':action.get('page'),'action':action})
            if action['kind']=='document':
                anchors.append({'kind':'document','source_id':action['source_id'],'source_sha256':action['source_sha256'],'preview_version':action['preview_version'],'page':action['page'],'evidence_id':evidence_id,'title':citation['title']})
            else:
                anchors.append({'kind':'task','session_id':action['session_id'],'task_id':action['task_id'],'task_fingerprint':action.get('task_fingerprint'),'evidence_id':evidence_id,'title':citation['title']})
        payload={'request_id':request_id,'expected_revision':body.expected_revision,'content':{'question':question,'text':message.text,'claims':message.claims,'citations':citations,'mocked':request.frozen.get('mocked',False)},'anchors':anchors}
        fingerprint=workspace.digest(payload)
        existing=db.scalar(select(SavedExplanation).where(SavedExplanation.course_id==course_id,SavedExplanation.request_id==request_id,SavedExplanation.payload_hash==fingerprint,SavedExplanation.revoked_at.is_(None)))
        if existing:return output(existing,_valid(db,existing,upload_dir))
        row=SavedExplanation(id=str(uuid4()),course_id=course_id,topic_id=topic.id,request_id=request_id,
                             command_id=body.command_id,payload_hash=fingerprint,
                             content=payload['content'],anchors=anchors,revision=1)
        db.add(row);db.flush()
        return output(row)
    return workspace.command(db,course_id,body,'save_explanation:'+request_id,create)


def revoke(db,course_id,identity,body:RevokeExplanation):
    if not ready(db):workspace.fail('saved_explanations_unavailable','保存关系表未迁移；当前记录只读',503)
    workspace.course_for(db,course_id,write=True)
    def action():
        row=workspace.scoped(db,SavedExplanation,course_id,identity)
        if row.revoked_at:return output(row,False)
        if row.revision!=body.expected_revision:workspace.fail('revision_conflict','关联已在另一窗口更新，请重新读取',409)
        row.revoked_at=datetime.now(timezone.utc);row.revision+=1
        db.flush()
        return output(row,False)
    return workspace.command(db,course_id,body,'revoke_explanation:'+identity,action)


def read(db,course_id,identity,upload_dir):
    workspace.course_for(db,course_id)
    if not ready(db):workspace.fail('saved_explanations_unavailable','保存关系表未迁移',503)
    row=workspace.scoped(db,SavedExplanation,course_id,identity)
    if row.revoked_at:return output(row,False)
    return output(row,_valid(db,row,upload_dir))


def list_for_anchor(db,course_id,upload_dir,source_id=None,session_id=None,task_id=None,request_id=None,offset=0,limit=100):
    workspace.course_for(db,course_id)
    if not ready(db):return {'items':[],'next_offset':None,'enabled':False}
    rows=db.scalars(select(SavedExplanation).where(SavedExplanation.course_id==course_id,SavedExplanation.revoked_at.is_(None)).order_by(SavedExplanation.created_at.desc(),SavedExplanation.id.desc()))
    found=[]
    for row in rows:
        if request_id and row.request_id!=request_id:continue
        if not (source_id or session_id or task_id) or any((source_id and a['kind']=='document' and a['source_id']==source_id) or
               (session_id and a['kind']=='task' and a['session_id']==session_id and (not task_id or a['task_id']==task_id))
               for a in row.anchors):
            found.append(row)
            if len(found)>offset+limit:break
    page=found[offset:offset+limit]
    return {'items':[output(row,_valid(db,row,upload_dir)) for row in page],
            'next_offset':offset+limit if len(found)>offset+limit else None,'enabled':True}


def _valid(db,row,upload_dir):
    if not row.anchors:return True
    try:
        for anchor in row.anchors:
            citation=generation.citation(db,row.course_id,row.request_id,anchor['evidence_id'],upload_dir)
            action=citation['action']
            if anchor['kind']=='document' and any(action.get(key)!=anchor.get(key) for key in ('source_id','source_sha256','preview_version','page')):return False
            if anchor['kind']=='task' and any(action.get(key)!=anchor.get(key) for key in ('session_id','task_id','task_fingerprint')):return False
    except HTTPException:
        return False
    return True
