"""FE-V10 independent generation endpoints; v2 manifest remains read-only."""
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from .dependencies import get_db, get_model_gateway
from .model_gateway import ModelGateway
from . import assistant_generation as domain
from .assistant_generation_dto import RequestCreate, Resolve, SaveExplanation, RevokeExplanation
from .assistant_generation_models import AssistantRequest
from .assistant_workspace import fail, course_for
from . import assistant_saved_explanations as saved

router=APIRouter(prefix='/api/courses/{course_id}/assistant/v2',tags=['assistant-generation'])

@router.get('/requests/{identity}/images/{binding_id}')
def frozen_image(course_id:str,identity:str,binding_id:str,request:Request,original:bool=False,db:Session=Depends(get_db)):
    from . import assistant_images
    r=domain.row(db,course_id,identity)
    if not r.dispatched or not any(e.get('binding_id')==binding_id and e.get('snapshot',{}).get('image_id') for e in r.evidence):
        fail('image_not_read','本次请求没有实际读取这张纸稿',404)
    binding=next((b for b in r.frozen.get('bindings',[]) if b.get('id')==binding_id and b.get('image_id') and b.get('role')=='student_work'),None)
    if binding is None:fail('image_unavailable','冻结纸稿记录不可用',404)
    if original:
        data,meta=assistant_images.resolve_original(request.app.state.reader_upload_dir,course_id,binding)
        extension='png' if meta['original_media_type']=='image/png' else 'jpg'
        return Response(content=data,media_type=meta['original_media_type'],headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':f'attachment; filename="paper-original.{extension}"'})
    _,data=assistant_images.resolve(request.app.state.reader_upload_dir,course_id,binding)
    return Response(content=data,media_type='image/jpeg',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})

@router.get('/capabilities')
def capabilities(course_id:str,db:Session=Depends(get_db),gateway:ModelGateway=Depends(get_model_gateway)):
    course=course_for(db,course_id)
    cap=domain.capabilities(db,gateway)
    if cap['enabled']:
        budget=gateway.usage_summary(db,course_id)
        if (budget['course_remaining_tokens'] is not None and budget['course_remaining_tokens']<=domain.OUTPUT_LIMIT) or (gateway.daily_token_budget is not None and budget['daily_used_tokens']+domain.OUTPUT_LIMIT>=gateway.daily_token_budget):cap.update(enabled=False,reason='模型预算不足，内容仍可保存')
    if course.archived_at:cap.update(enabled=False,reason='课程已归档，历史回答仍可查看')
    return cap

@router.post('/topics/{topic_id}/requests',status_code=202)
def accept(course_id:str,topic_id:str,body:RequestCreate,request:Request,db:Session=Depends(get_db),gateway:ModelGateway=Depends(get_model_gateway)):
    row,created=domain.accept(db,course_id,topic_id,body,gateway)
    result=domain.public(db,row)
    if created and request.app.state.assistant_runtime.submit(db.get_bind(),row.id,gateway,request.app.state.reader_upload_dir) is False:
        domain.transition(row,'blocked','助手当前繁忙，本次没有派发，请稍后重新生成');db.commit();result=domain.public(db,row)
    return result

@router.get('/requests/{identity}')
def read(course_id:str,identity:str,db:Session=Depends(get_db)):
    return domain.public(db,domain.row(db,course_id,identity))

@router.get('/topics/{topic_id}/messages')
def messages(course_id:str,topic_id:str,request:Request,after:int=Query(0,ge=0),limit:int=Query(30,ge=1,le=100),db:Session=Depends(get_db)):
    course_for(db,course_id)
    return domain.messages(db,course_id,topic_id,after,limit,request.app.state.reader_upload_dir)

@router.post('/requests/{identity}/cancel')
def cancel(course_id:str,identity:str,db:Session=Depends(get_db)):
    return domain.public(db,domain.cancel(db,course_id,identity))

@router.post('/requests/{identity}/resolve',status_code=202)
def resolve(course_id:str,identity:str,body:Resolve,request:Request,db:Session=Depends(get_db),gateway:ModelGateway=Depends(get_model_gateway)):
    cap=domain.capabilities(db,gateway)
    if not cap['enabled']:fail('model_unavailable',cap['reason'],503)
    r=domain.resolve(db,course_id,identity,body);result=domain.public(db,r)
    if request.app.state.assistant_runtime.submit(db.get_bind(),r.id,gateway,request.app.state.reader_upload_dir) is False:
        domain.transition(r,'blocked','助手当前繁忙，本次没有派发，请稍后重新生成');db.commit();result=domain.public(db,r)
    return result

@router.get('/requests/{identity}/citations/{eid}')
def citation(course_id:str,identity:str,eid:str,request:Request,db:Session=Depends(get_db)):
    return domain.citation(db,course_id,identity,eid,request.app.state.reader_upload_dir)

@router.post('/requests/{identity}/saved-explanations')
def save_explanation(course_id:str,identity:str,body:SaveExplanation,request:Request,db:Session=Depends(get_db)):
    return saved.save(db,course_id,identity,body,request.app.state.reader_upload_dir)

@router.get('/saved-explanations')
def saved_explanations(course_id:str,request:Request,source_id:str|None=None,session_id:str|None=None,task_id:str|None=None,request_id:str|None=None,offset:int=Query(0,ge=0),limit:int=Query(100,ge=1,le=100),db:Session=Depends(get_db)):
    return saved.list_for_anchor(db,course_id,request.app.state.reader_upload_dir,source_id,session_id,task_id,request_id,offset,limit)

@router.get('/saved-explanations/{identity}')
def saved_explanation(course_id:str,identity:str,request:Request,db:Session=Depends(get_db)):
    return saved.read(db,course_id,identity,request.app.state.reader_upload_dir)

@router.post('/saved-explanations/{identity}/revoke')
def revoke_explanation(course_id:str,identity:str,body:RevokeExplanation,db:Session=Depends(get_db)):
    return saved.revoke(db,course_id,identity,body)
