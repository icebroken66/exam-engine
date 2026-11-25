"""Unified conversation storage and non-generating send preflight."""
from datetime import datetime, timezone
import json
import math
from hashlib import sha256
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from pypdf import PdfReader
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .dependencies import get_db
from .models import AssistantSnapshot, Course, LearningSession, LearningTask, Source, LearningAttempt
from .reader_routes import PREVIEW_VERSION
from .session_access import get_progress_version
from .source_lifecycle import task_uses_removed_source

router = APIRouter(prefix="/api/courses/{course_id}/assistant", tags=["assistant"])


class Write(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    snapshot: dict


class Preflight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=10000)
    context: dict | None = None


def course_for(db, course_id):
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(404, detail="课程不存在")
    return course


def valid_context(c):
    if c is None:
        return True
    if not isinstance(c, dict) or not isinstance(c.get('title'), str) or len(c['title']) > 500 or not isinstance(c.get('text'), str) or len(c['text']) > 100000:
        return False
    def text(key, limit):
        return isinstance(c.get(key), str) and 0 < len(c[key]) <= limit
    if c.get('kind') == 'document':
        if not all(text(k, 100) for k in ('sourceId', 'documentId', 'previewVersion')) or type(c.get('page')) is not int or c['page'] < 1:
            return False
        if not isinstance(c.get('regions'), list) or len(c['regions']) > 1000:
            return False
        for r in c['regions']:
            if not isinstance(r, dict) or not all(type(r.get(k)) in (int, float) and math.isfinite(r[k]) for k in ('x', 'y', 'width', 'height')):
                return False
            if r['x'] < 0 or r['y'] < 0 or r['width'] <= 0 or r['height'] <= 0 or r['x'] + r['width'] > 1.000001 or r['y'] + r['height'] > 1.000001:
                return False
        return True
    return c.get('kind') in ('question', 'answer') and all(text(k, 200) for k in ('sessionId', 'taskId', 'progressVersion', 'stage'))


def validate_snapshot(s, course_id):
    try:
        ok = len(json.dumps(s, allow_nan=False, ensure_ascii=False).encode()) <= 5 * 1024 * 1024
        ok = ok and s.get('schema') == 1 and type(s.get('schema')) is int and s.get('courseId') == course_id
        ok = ok and type(s.get('revision')) is int and s['revision'] >= 0 and isinstance(s.get('draft'), str) and len(s['draft']) <= 10000 and 'context' in s and valid_context(s['context'])
        entries = s.get('entries')
        ok = ok and isinstance(entries, list) and len(entries) <= 200
        ids = set()
        if ok:
            for e in entries:
                if not isinstance(e, dict) or not isinstance(e.get('id'), str) or not 0 < len(e['id']) <= 100 or e['id'] in ids or not isinstance(e.get('message'), str) or len(e['message']) > 10000 or not isinstance(e.get('createdAt'), str) or len(e['createdAt']) > 100 or 'context' not in e or not valid_context(e['context']):
                    ok = False
                    break
                ids.add(e['id'])
        if not ok:
            raise ValueError()
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(422, detail="助手快照格式无效或课程不匹配；旧记录未改动")
    return s


def response(row):
    return {'revision': row.revision if row else 0, 'snapshot': row.snapshot if row else None}


@router.get('')
def read(course_id: str, db: Session = Depends(get_db)):
    course = course_for(db, course_id)
    return {**response(db.get(AssistantSnapshot, course_id)), 'readOnly': course.archived_at is not None, 'modelEnabled': False}


@router.put('')
def save(course_id: str, body: Write, db: Session = Depends(get_db)):
    course = course_for(db, course_id)
    if course.archived_at is not None:
        raise HTTPException(409, detail="课程已归档；请恢复课程后保存助手记录")
    s = validate_snapshot(body.snapshot, course_id)
    if s['revision'] != body.revision:
        raise HTTPException(422, detail="快照修订号与请求不一致")
    row = db.get(AssistantSnapshot, course_id)
    # Store the exact submitted payload, so a lost acknowledgement can be retried.
    if row and row.revision in (body.revision, body.revision + 1) and row.snapshot == s:
        return response(row)
    if row:
        changed = db.execute(update(AssistantSnapshot).where(AssistantSnapshot.course_id == course_id, AssistantSnapshot.revision == body.revision).values(revision=body.revision + 1, snapshot=s, updated_at=datetime.now(timezone.utc)))
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(409, detail="其他窗口已更新服务端会话；当前内容保留，请先导出再重新载入")
    elif body.revision != 0:
        raise HTTPException(409, detail="服务端会话版本变化，请先导出再重新载入")
    else:
        db.add(AssistantSnapshot(course_id=course_id, revision=1, snapshot=s))
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, detail="其他窗口已创建服务端会话；请重新载入") from e
    db.expire_all()
    return response(db.get(AssistantSnapshot, course_id))


@router.post('/preflight')
def preflight(course_id: str, body: Preflight, request: Request, db: Session = Depends(get_db)):
    course = course_for(db, course_id)
    if course.archived_at is not None:
        raise HTTPException(409, detail="课程已归档，不能准备发送")
    if not body.message.strip() or not valid_context(body.context):
        raise HTTPException(422, detail="问题或上下文格式无效")
    c = body.context
    if c and c['kind'] == 'document':
        source = db.get(Source, c['sourceId'])
        if not source or source.course_id != course_id or source.removed_at is not None or source.sha256 != c['documentId'] or c['previewVersion'] != PREVIEW_VERSION:
            raise HTTPException(409, detail="资料上下文已失效，请重新打开资料并选择")
        root = Path(request.app.state.reader_upload_dir).resolve()
        file = (root / source.storage_key).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise HTTPException(410, detail="资料原件缺失，请恢复后重新关联")
        if sha256(file.read_bytes()).hexdigest() != source.sha256:
            raise HTTPException(409, detail="资料原件内容已变化，请重新关联")
        try:
            page_count = len(PdfReader(file).pages)
        except Exception as e:
            raise HTTPException(422, detail="资料PDF无法读取") from e
        if c['page'] > page_count:
            raise HTTPException(422, detail="资料上下文页码超出原件")
        return {'status': 'contract_ready_model_disabled', 'canSend': False, 'modelCalled': False, 'message': '资料版本、页码与区域格式有效；所选文本是用户片段，未独立核验，也未OCR。真实模型尚未启用，本次未发送。'}
    if c:
        session, task = db.get(LearningSession, c['sessionId']), db.get(LearningTask, c['taskId'])
        if not session or session.course_id != course_id or not task or task.session_id != session.id or c['progressVersion'] != get_progress_version(db, session):
            raise HTTPException(409, detail="题目上下文已过期，请从当前题重新关联")
        if session.current_task_id != task.id or c['stage'] != session.stage:
            raise HTTPException(409, detail="关联目标不是当前题，请重新关联")
        if task_uses_removed_source(db, task):
            raise HTTPException(409, detail="当前题资料已移除，请先恢复资料或重新安排学习")
        if c['kind'] == 'answer' and db.scalar(select(LearningAttempt.id).where(LearningAttempt.task_id == task.id).limit(1)) is None:
            raise HTTPException(409, detail="没有可关联的已提交作答")
        return {'status': 'use_tutoring', 'canSend': False, 'modelCalled': False, 'message': '题目求助必须通过原带学接口和独立重测同意；本次未发送、不计帮助。'}
    return {'status': 'contract_ready_model_disabled', 'canSend': False, 'modelCalled': False, 'message': '问题格式有效；真实模型尚未启用，本次只预检，未发送。'}
