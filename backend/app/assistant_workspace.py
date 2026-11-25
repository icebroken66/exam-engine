"""No-model workspace domain. Only explicit commands write these three tables."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pypdf import PdfReader
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from .assistant_workspace_models import Topic, WorkItem, WorkspaceCommand
from .models import AssistantSnapshot, Course, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, Source, TutoringTurn
from .reader_routes import PREVIEW_VERSION
from .session_access import get_latest_attempt, get_progress_version
from .source_lifecycle import task_uses_removed_source


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def fail(code, message, status=409):
    raise HTTPException(status, detail={'code': code, 'message': message})


def course_for(db, course_id, write=False):
    course = db.get(Course, course_id)
    if not course:
        fail('course_not_found', '课程不存在', 404)
    if write and course.archived_at:
        fail('course_read_only', '课程已归档，只能读取和导出')
    return course


def scoped(db, model, course_id, identity):
    row = db.scalar(select(model).where(model.course_id == course_id, model.id == identity))
    if not row:
        fail('not_found', '当前课程中没有此记录', 404)
    return row


def task_for(db, course_id, session_id, task_id):
    session = db.get(LearningSession, session_id)
    task = db.get(LearningTask, task_id)
    if not session or session.course_id != course_id or not task or task.session_id != session.id:
        fail('task_unavailable', '任务不属于当前课程或学习轮次', 404)
    return session, task


def public_task(task):
    # Allowlist: never serialize teacher reference_answer, analysis or rubric.
    return {'id': task.id, 'session_id': task.session_id, 'stem': task.stem, 'options': task.options,
            'question_type': task.question_type, 'knowledge_point': task.knowledge_point}


def projection(db, course, item):
    if item.kind != 'platform_task':
        return None
    try:
        session, task = task_for(db, course.id, item.session_id, item.task_id)
    except HTTPException:
        return {'available': False, 'can_submit': False, 'can_tutor': False, 'reason': '任务已失效，请重新选择'}
    current = session.current_task_id == task.id
    removed = task_uses_removed_source(db, task)
    running = db.scalar(select(TutoringTurn.id).where(TutoringTurn.task_id == task.id, TutoringTurn.status == 'running').limit(1)) is not None
    reason = ('课程已归档' if course.archived_at else '历史题目，仅供查看，不能重新正式作答' if not current else
              '题目资料已移除' if removed else '任务已结束' if session.stage == 'completed' or task.status == 'withdrawn' else
              '原带学正在运行，等待原入口处理' if running else '')
    latest = get_latest_attempt(db, task.id)
    submit_block = ('题目未通过质量验收' if task.validation_status != 'validated' else
                    '本题已判分，请使用原学习入口推进' if latest and latest.verdict != 'ungraded' and session.stage != 'blocked' else '')
    can_submit = not reason and not submit_block and session.stage in ('diagnosing', 'practicing', 'retesting', 'blocked')
    if not reason and not can_submit:
        submit_reason = submit_block or '当前阶段不接受正式提交，请返回原学习入口'
    else:
        submit_reason = reason
    evidence = db.execute(select(EvidenceBlock.id, Source.course_id, Source.status, Source.removed_at)
                          .join(Source, Source.id == EvidenceBlock.source_id).where(EvidenceBlock.id.in_(task.evidence_ids or []))).all()
    valid_evidence = bool(evidence) and len(evidence) == len(set(task.evidence_ids or [])) and all(c == course.id and s in ('ready', 'needs_review') and not r for _, c, s, r in evidence)
    return {'available': True, 'stage': session.stage, 'task_status': task.status, 'is_current': current,
            'progress_version': get_progress_version(db, session), 'task_fingerprint': digest(public_task(task)),
            'can_submit': bool(can_submit), 'can_tutor': not reason and valid_evidence,
            'reason': submit_reason, 'tutor_reason': reason or ('' if valid_evidence else '资料依据尚不可用于带学'),
            'retest_consent_required': task.kind == 'retest', 'public_task': public_task(task)}


def item_output(db, course, row):
    return {**jsonable_encoder({c.name: getattr(row, c.name) for c in row.__table__.columns}),
            'business': projection(db, course, row), 'read_only': bool(course.archived_at)}


def topic_output(row, read_only=False, summary=False):
    result = jsonable_encoder({c.name: getattr(row, c.name) for c in row.__table__.columns
                               if not summary or c.name not in ('text', 'bindings')})
    result.update(read_only=read_only, binding_count=len(row.bindings))
    return result


def command(db, course_id, body, operation, action):
    course_for(db, course_id, write=True)
    fingerprint = digest({'operation': operation, 'body': body.model_dump(mode='json')})
    def receipt():
        old = db.scalar(select(WorkspaceCommand).where(WorkspaceCommand.course_id == course_id, WorkspaceCommand.command_id == body.command_id))
        if old:
            if old.payload_hash != fingerprint:
                fail('command_id_conflict', '相同命令标识已用于不同操作或内容')
            return old.result
        return None
    old = receipt()
    if old is not None:
        return old
    try:
        # Unique reservation and mutation share one transaction. A concurrent replay
        # cannot perform a second mutation, even if the first receipt was lost.
        row = WorkspaceCommand(course_id=course_id, command_id=body.command_id, payload_hash=fingerprint, result={})
        db.add(row)
        db.flush()
        result = jsonable_encoder(action())
        row.result = result
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        old = receipt()
        if old is not None:
            return old
        fail('revision_conflict', '其他窗口已创建或修改记录；当前内存保留，请导出并显式重读')
    except OperationalError:
        db.rollback()
        fail('storage_busy', '保存未确认，请保留当前内容并用原命令重试', 503)
    except Exception:
        db.rollback()
        raise


def cas(db, model, row, expected, **values):
    changed = db.execute(update(model).where(model.id == row.id, model.course_id == row.course_id, model.revision == expected)
                         .values(**values, revision=expected + 1, updated_at=datetime.now(timezone.utc)),
                         execution_options={'synchronize_session': False})
    if changed.rowcount != 1:
        fail('revision_conflict', '其他窗口已更新；停止覆盖，当前内容保留，请导出或显式重读')
    db.expire(row)
    return row


def create_item(db, course_id, body):
    if body.expected_revision != 0:
        fail('revision_conflict', '新事项 expected_revision 必须为0')
    if body.kind == 'platform_task':
        _, task = task_for(db, course_id, body.session_id, body.task_id)
        existing = db.scalar(select(WorkItem).where(WorkItem.course_id == course_id, WorkItem.task_id == task.id))
        if existing:
            return item_output(db, course_for(db, course_id), existing)
        title = task.knowledge_point or body.title
    else:
        title = body.title
    row = WorkItem(course_id=course_id, kind=body.kind, title=title, session_id=body.session_id, task_id=body.task_id)
    db.add(row); db.flush()
    return item_output(db, course_for(db, course_id), row)


def validate_bookmark(db, course_id, bookmark):
    if not bookmark:
        return None
    for view in (bookmark.origin, bookmark.target):
        if view.task_id:
            task_for(db, course_id, view.session_id, view.task_id)
        elif view.session_id:
            session = db.get(LearningSession, view.session_id)
            if not session or session.course_id != course_id:
                fail('bookmark_invalid', '恢复目标不属于当前课程', 422)
        if view.source_id:
            source = db.get(Source, view.source_id)
            if not source or source.course_id != course_id or source.removed_at:
                fail('bookmark_invalid', '恢复资料不可用', 422)
        if view.view == 'reader' and not view.source_id:
            fail('bookmark_invalid', '资料恢复需要明确来源', 422)
    return bookmark.model_dump(mode='json')


def attention(db, course_id, identity, body):
    row = scoped(db, WorkItem, course_id, identity)
    if body.attention == 'finished' and row.kind != 'exploration':
        fail('formal_completion_forbidden', '平台事项不能伪造正式完成', 422)
    bookmark = validate_bookmark(db, course_id, body.bookmark)
    cas(db, WorkItem, row, body.expected_revision, attention=body.attention, bookmark=bookmark if body.bookmark else row.bookmark)
    return item_output(db, course_for(db, course_id), row)


def create_topic(db, course_id, body):
    if body.expected_revision != 0:
        fail('revision_conflict', '新主题 expected_revision 必须为0')
    for identity in body.item_ids:
        scoped(db, WorkItem, course_id, identity)
    row = Topic(course_id=course_id, title=body.title, mode=body.mode, item_ids=body.item_ids)
    db.add(row); db.flush()
    return topic_output(row)


def save_composer(db, course_id, identity, body):
    row = scoped(db, Topic, course_id, identity)
    cas(db, Topic, row, body.expected_revision, text=body.text)
    return topic_output(row)


def update_topic(db, course_id, identity, body):
    row = scoped(db, Topic, course_id, identity)
    changes = {}
    if body.title is not None:
        changes['title'] = body.title.strip()
    if body.mode is not None:
        targets = [scoped(db, WorkItem, course_id, i) for i in body.item_ids]
        task_ids = {t.task_id for t in targets if t.task_id}
        if any(b.get('task_id') and b['task_id'] not in task_ids for b in row.bindings):
            fail('target_has_attachments', '现有附件属于其他题目，请先移除或使用新对话')
        if row.mode != body.mode or row.item_ids != body.item_ids:
            changes.update(mode=body.mode, item_ids=body.item_ids, context_revision=row.context_revision + 1)
    cas(db, Topic, row, body.expected_revision, **changes)
    return topic_output(row)


def source_content(db, course_id, binding, upload_dir):
    source = db.get(Source, binding['source_id'])
    if not source or source.course_id != course_id or source.removed_at:
        fail('source_removed', '资料已失效或移除')
    if source.sha256 != binding['source_sha256']:
        fail('source_hash_changed', '资料版本变化，请重新取材')
    if binding['preview_version'] != PREVIEW_VERSION:
        fail('preview_changed', '预览版本变化，请重新取材')
    if source.extension.lower().lstrip('.') != 'pdf':
        fail('source_unsupported', '本卡资料取材仅支持PDF', 422)
    root = Path(upload_dir).resolve(); file = (root / source.storage_key).resolve()
    if not file.is_relative_to(root) or not file.is_file():
        fail('source_missing', '资料原件缺失', 410)
    if sha256(file.read_bytes()).hexdigest() != source.sha256:
        fail('source_hash_changed', '资料原件版本变化，请重新取材')
    try:
        pages = len(PdfReader(file).pages)
    except Exception:
        fail('source_unreadable', '资料原件无法读取', 422)
    if not 1 <= binding['page'] <= pages:
        fail('page_out_of_range', '资料页码超出原件', 422)
    return source


def resolve_binding(db, course_id, topic, binding, upload_dir, checking=False):
    b = dict(binding)
    if b['role'] == 'document_excerpt':
        source = source_content(db, course_id, b, upload_dir)
        b.update(title=source.original_name, provenance='user_excerpt_unverified', limitation='仅定位及用户片段；未OCR或理解图片')
        return b
    session, task = task_for(db, course_id, b['session_id'], b['task_id'])
    item_tasks = [scoped(db, WorkItem, course_id, i).task_id for i in topic.item_ids]
    if task.id not in item_tasks:
        fail('needs_context_choice', '请先为此题创建或选择目标主题')
    if task.status == 'withdrawn' or task_uses_removed_source(db, task):
        fail('task_source_removed', '题目已撤回或其资料已移除')
    if b['role'] == 'student_work' and b.get('image_id'):
        from . import assistant_images
        if session.current_task_id != task.id:
            fail('task_not_current', '纸稿只能绑定当前题，请重新选择当前作答')
        assistant_images.resolve(upload_dir, course_id, b)
        if not checking:
            metadata=assistant_images.original_metadata(upload_dir,course_id,b)
            if metadata is not None:
                b['image_original']=metadata
        b['image_correction_version'] = digest({'image_sha256':b['image_sha256'],'text':b.get('image_correction','')})
    if checking and topic.mode != 'compare' and session.current_task_id != task.id:
        fail('task_not_current', '该题已推进，仅可历史查看；重新选择上下文')
    if not checking and topic.mode != 'compare' and session.current_task_id != task.id:
        fail('task_not_current', '历史题仅供查看；如需两题比较请明确建立比较主题')
    current = digest(public_task(task))
    if b.get('task_fingerprint') and b['task_fingerprint'] != current:
        fail('task_changed', '公开题目版本已变化')
    b.update(task_fingerprint=current, title=task.knowledge_point)
    if b.get('learning_focus'):
        if session.current_task_id != task.id:
            fail('task_not_current', '卡点说明只能用于当前题，请重新选择')
        b['learning_focus_version'] = digest({'task_fingerprint':current,'text':b['learning_focus']})
    if b['role'] == 'question':
        b['text'] = task.stem + ('\n' + '\n'.join(task.options) if task.options else '')
        b['provenance'] = 'server_public_question'
    elif b['role'] == 'student_work':
        b['provenance'] = 'user_declared_unsubmitted'
        b['limitation'] = '未提交快照；后续修改原答案不会同步'
    else:
        attempt = db.get(LearningAttempt, b['attempt_id'])
        if not attempt or attempt.task_id != task.id or attempt.session_id != session.id:
            fail('attempt_unavailable', '已提交作答记录不可用')
        if b['role'] == 'visible_feedback' and attempt.verdict == 'ungraded':
            fail('feedback_not_visible', '此作答暂无已显示判分反馈')
        value = attempt.answer if b['role'] == 'submitted_answer' else attempt.feedback
        version = digest({'id': attempt.id, 'role': b['role'], 'text': value, 'verdict': attempt.verdict})
        if checking and b.get('content_fingerprint') != version:
            fail('attempt_changed', '作答或可见反馈已修订，请重新取材')
        b.update(text=value, content_fingerprint=version, provenance='server_submitted_record')
    if len(b['text']) > 10000:
        fail('text_limit', '所选公开内容超过10000字符，请选择其他上下文', 422)
    return b


def bind(db, course_id, identity, body, upload_dir):
    row = scoped(db, Topic, course_id, identity)
    if row.revision != body.expected_revision:
        fail('revision_conflict', '主题已更新；停止覆盖，请导出或显式重读')
    bindings = list(row.bindings)
    if body.replace_id and not any(b['id'] == body.replace_id for b in bindings):
        fail('binding_not_found', '待替换附件不存在', 404)
    if not body.replace_id and len(bindings) >= 4:
        fail('binding_limit', '最多4个确认附件；请移除或明确替换', 422)
    binding = resolve_binding(db, course_id, row, body.binding.model_dump(mode='json'), upload_dir)
    if binding.get('image_id') and any(b.get('image_id') and b['id'] != body.replace_id for b in bindings):
        fail('image_limit', '每次仅支持一张纸稿图片，请移除或明确替换已有图片', 422)
    binding.update(id=str(uuid4()), confirmed=True, supersedes=body.replace_id)
    bindings = [binding if b['id'] == body.replace_id else b for b in bindings] if body.replace_id else [*bindings, binding]
    cas(db, Topic, row, body.expected_revision, bindings=bindings, context_revision=row.context_revision + 1)
    return topic_output(row)


def unbind(db, course_id, identity, binding_id, body):
    row = scoped(db, Topic, course_id, identity)
    if not any(b['id'] == binding_id for b in row.bindings):
        fail('binding_not_found', '附件不存在', 404)
    cas(db, Topic, row, body.expected_revision, bindings=[b for b in row.bindings if b['id'] != binding_id], context_revision=row.context_revision + 1)
    return topic_output(row)


def manifest(db, course_id, identity, body, upload_dir):
    course = course_for(db, course_id)
    topic = scoped(db, Topic, course_id, identity)
    if topic.revision != body.expected_revision or topic.context_revision != body.context_revision:
        fail('context_stale', '主题或附件版本已变化；请保留草稿并显式重新读取')
    if not body.question.strip():
        fail('empty_question', '请输入本次问题', 422)
    included, excluded = [], []
    targets = [item_output(db, course, scoped(db, WorkItem, course_id, i)) for i in topic.item_ids]
    groups = [{'item_id': i['id'], 'title': i['title'], 'task_id': i['task_id'], 'bindings': []} for i in targets]
    status = 'ready_model_disabled'
    for b in topic.bindings:
        try:
            valid = resolve_binding(db, course_id, topic, b, upload_dir, checking=True)
            included.append(valid)
            for group in groups:
                if b.get('task_id') == group['task_id']:
                    group['bindings'].append(valid['id'])
        except HTTPException as error:
            detail = error.detail if isinstance(error.detail, dict) else {'code': 'unavailable', 'message': '附件不可用'}
            excluded.append({'binding_id': b['id'], 'reason': detail['code'], 'message': detail['message']})
            status = 'context_stale'
    # Deterministic metadata ambiguity only. No language-based intent inference.
    if topic.mode == 'independent' and any(b.get('task_id') for b in topic.bindings):
        status = 'needs_context_choice'
    if any(not t['business'].get('available') for t in targets if t['business']):
        status = 'needs_context_choice'
    defaults = [{'scope': s, 'reason': r} for s, r in [
        ('other_courses', '课程权限隔离'), ('other_topics_and_legacy', '未明确附带的历史不纳入'),
        ('unselected_answers_and_notes', '未授权读取草稿、个人批注或笔记'),
        ('teacher_private_fields', '普通上下文无权读取教师私有字段'), ('course_fulltext', '本卡不检索整课')]]
    return {'schema_version': 2, 'status': status, 'model_called': False, 'can_send': False,
            'course': {'id': course.id, 'name': course.name, 'read_only': bool(course.archived_at)},
            'topic': {'id': topic.id, 'title': topic.title, 'mode': topic.mode, 'revision': topic.revision, 'context_revision': topic.context_revision},
            'question': body.question, 'targets': targets, 'groups': groups, 'included': included,
            'excluded': excluded, 'trace': {'included': [{'binding_id': b['id'], 'reason': 'explicitly_confirmed'} for b in included],
                                           'excluded': [*excluded, *defaults]},
            'candidates': [{'item_id': t['id'], 'title': t['title']} for t in targets] if status == 'needs_context_choice' else [],
            'limitations': ['上下文准备，尚未发送 AI', '未调用OCR、视觉识别、检索或模型', '区域坐标不代表已识别文字', '无附件概念问题可预览']}


def legacy(db, course_id):
    course = course_for(db, course_id)
    row = db.get(AssistantSnapshot, course_id)
    raw = row.snapshot if row else None
    return {'schema_version': 2, 'legacy': True, 'source_fingerprint': digest(raw), 'snapshot': raw,
            'supported': isinstance(raw, dict) and type(raw.get('schema')) is int and raw['schema'] == 1,
            'read_only': bool(course.archived_at), 'context_authorized': False}


def copy_legacy(db, course_id, identity, body):
    row = scoped(db, Topic, course_id, identity)
    old = legacy(db, course_id)
    if not old['supported'] or old['source_fingerprint'] != body.source_fingerprint:
        fail('legacy_stale', '历史源版本变化或未知格式；原始数据仍可导出')
    if row.text or row.bindings:
        fail('composer_not_empty', '目标主题非空；复制不会覆盖现有草稿或附件')
    snapshot = old['snapshot']
    if body.entry_id:
        entry = next((e for e in snapshot.get('entries', []) if e.get('id') == body.entry_id), None)
        if not entry:
            fail('legacy_entry_missing', '旧记录不存在', 404)
        value = entry.get('message')
    else:
        value = snapshot.get('draft')
    if not isinstance(value, str) or not value or len(value) > 10000:
        fail('legacy_text_invalid', '旧文字为空或超限，不能复制', 422)
    cas(db, Topic, row, body.expected_revision, text=value, legacy_origin={'source_fingerprint': body.source_fingerprint, 'entry_id': body.entry_id, 'legacy': True})
    return topic_output(row)
