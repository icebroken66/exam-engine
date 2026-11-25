"""Versioned no-model workspace HTTP adapter."""
import os
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from .dependencies import get_db
from . import assistant_workspace as domain
from .assistant_workspace_models import Topic, WorkItem
from .assistant_workspace_dto import AttentionWrite, BindingWrite, Command, ComposerWrite, ItemCreate, LegacyCopy, ManifestRead, TopicCreate, TopicUpdate
from . import assistant_images

router = APIRouter(prefix='/api/courses/{course_id}/assistant/v2', tags=['assistant-workspace'])


@router.get('/topics/{identity}/bindings/{binding_id}/image')
def binding_image(course_id: str, identity: str, binding_id: str, request: Request, original: bool = False, db: Session = Depends(get_db)):
    domain.course_for(db, course_id)
    topic = domain.scoped(db, Topic, course_id, identity)
    binding = next((b for b in topic.bindings if b['id'] == binding_id and b.get('image_id') and b['role'] == 'student_work'), None)
    if binding is None:
        domain.fail('image_binding_unavailable', '图片附件已移除或替换，请重新读取对话', 404)
    if original:
        data,metadata=assistant_images.resolve_original(request.app.state.reader_upload_dir,course_id,binding)
        extension='png' if metadata['original_media_type']=='image/png' else 'jpg'
        return Response(content=data,media_type=metadata['original_media_type'],headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':f'attachment; filename="paper-original.{extension}"'})
    _, data = assistant_images.resolve(request.app.state.reader_upload_dir, course_id, binding)
    return Response(content=data, media_type='image/jpeg', headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="paper.jpg"'})


@router.post('/images', status_code=201)
async def upload_image(course_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if os.getenv('ASSISTANT_WORKSPACE_WRITES', '1') == '0':
        domain.fail('workspace_read_only', 'v2写入口已关闭，记录仍可读取和导出')
    domain.course_for(db, course_id, write=True)
    data = await file.read(assistant_images.MAX_UPLOAD_BYTES + 1)
    stored = assistant_images.store(request.app.state.reader_upload_dir, course_id, data)
    return {'image_id': stored.image_id, 'image_sha256': stored.sha256, 'image_version': stored.version,
            'image_width': stored.width, 'image_height': stored.height, 'size_bytes': stored.size_bytes,
            'media_type': 'image/jpeg'}


def write(db, course_id, body, operation, action):
    if os.getenv('ASSISTANT_WORKSPACE_WRITES', '1') == '0':
        domain.fail('workspace_read_only', 'v2写入口已关闭，记录仍可读取和导出')
    return domain.command(db, course_id, body, operation, action)


@router.get('/items')
def items(course_id: str, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50), db: Session = Depends(get_db)):
    course = domain.course_for(db, course_id)
    rows = list(db.scalars(select(WorkItem).where(WorkItem.course_id == course_id).order_by(WorkItem.id).offset(offset).limit(limit + 1)))
    return {'schema_version': 2, 'items': [domain.item_output(db, course, r) for r in rows[:limit]], 'next_offset': offset + limit if len(rows) > limit else None, 'read_only': bool(course.archived_at)}


@router.get('/topics')
def topics(course_id: str, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50), db: Session = Depends(get_db)):
    course = domain.course_for(db, course_id)
    rows = list(db.scalars(select(Topic).where(Topic.course_id == course_id).order_by(Topic.id).offset(offset).limit(limit + 1)))
    return {'schema_version': 2, 'items': [domain.topic_output(r, bool(course.archived_at), summary=True) for r in rows[:limit]], 'next_offset': offset + limit if len(rows) > limit else None, 'read_only': bool(course.archived_at)}


@router.get('/items/{identity}')
def item(course_id: str, identity: str, db: Session = Depends(get_db)):
    course = domain.course_for(db, course_id)
    return domain.item_output(db, course, domain.scoped(db, WorkItem, course_id, identity))


@router.post('/items')
def new_item(course_id: str, body: ItemCreate, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'create_item', lambda: domain.create_item(db, course_id, body))


@router.post('/items/{identity}/attention')
def attention(course_id: str, identity: str, body: AttentionWrite, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'attention:' + identity, lambda: domain.attention(db, course_id, identity, body))


@router.get('/topics/{identity}')
def topic(course_id: str, identity: str, db: Session = Depends(get_db)):
    course = domain.course_for(db, course_id)
    return domain.topic_output(domain.scoped(db, Topic, course_id, identity), bool(course.archived_at))


@router.post('/topics')
def new_topic(course_id: str, body: TopicCreate, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'create_topic', lambda: domain.create_topic(db, course_id, body))


@router.put('/topics/{identity}/composer')
def composer(course_id: str, identity: str, body: ComposerWrite, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'composer:' + identity, lambda: domain.save_composer(db, course_id, identity, body))


@router.patch('/topics/{identity}')
def update_topic(course_id: str, identity: str, body: TopicUpdate, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'topic_metadata:' + identity, lambda: domain.update_topic(db, course_id, identity, body))


@router.post('/topics/{identity}/bindings')
def binding(course_id: str, identity: str, body: BindingWrite, request: Request, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'bind:' + identity, lambda: domain.bind(db, course_id, identity, body, request.app.state.reader_upload_dir))


@router.delete('/topics/{identity}/bindings/{binding_id}')
def remove_binding(course_id: str, identity: str, binding_id: str, body: Command, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'unbind:' + identity + ':' + binding_id, lambda: domain.unbind(db, course_id, identity, binding_id, body))


@router.post('/topics/{identity}/manifest')
def manifest(course_id: str, identity: str, body: ManifestRead, request: Request, db: Session = Depends(get_db)):
    return domain.manifest(db, course_id, identity, body, request.app.state.reader_upload_dir)


@router.get('/legacy')
def legacy(course_id: str, db: Session = Depends(get_db)):
    return domain.legacy(db, course_id)


@router.post('/topics/{identity}/legacy-copy')
def copy_legacy(course_id: str, identity: str, body: LegacyCopy, db: Session = Depends(get_db)):
    return write(db, course_id, body, 'legacy_copy:' + identity, lambda: domain.copy_legacy(db, course_id, identity, body))
