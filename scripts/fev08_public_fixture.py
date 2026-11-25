"""Seed only a named isolated database with public FE-V08 pollution fixtures."""
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from sqlalchemy import select
from app.database import SessionLocal
from app.models import AssistantSnapshot, Course, DocumentNode, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, ParseTask, Source


def seed():
    # Refuse default data paths. Callers must establish both isolated paths.
    if not os.environ.get('FEV08_ISOLATED_FIXTURE') or not os.environ.get('DATABASE_URL') or not os.environ.get('EXAM_ENGINE_DATA_DIR'):
        raise RuntimeError('仅显式隔离夹具环境允许写入')
    result = []
    with SessionLocal() as db:
        for n, course in enumerate(db.scalars(select(Course).order_by(Course.name))):
            sources = list(db.scalars(select(Source).where(Source.course_id == course.id).order_by(Source.id)))
            if not sources: continue
            source = sources[0]; source.status = 'ready'
            for parse in db.scalars(select(ParseTask).where(ParseTask.source_id.in_([s.id for s in sources]))): parse.status = 'completed'
            node = DocumentNode(id=f'fev08-node-{n}', source_id=source.id, title='公开计算', ordinal=0); db.add(node); db.flush()
            evidence = EvidenceBlock(id=f'fev08-evidence-{n}', source_id=source.id, node_id=node.id, ordinal=0, text=f'公开计算材料 {n+2} + 3', page_number=1, content_hash=source.sha256); db.add(evidence)
            session = LearningSession(course_id=course.id, stage='diagnosing'); db.add(session); db.flush()
            tasks = []
            for m in range(2):
                task = LearningTask(session_id=session.id, kind='diagnostic', ordinal=m, knowledge_point=f'课程{n+1}公开计算{m+1}', question_type='short_answer', stem=f'公开题：计算 {n+2} + {m+3}', options=[], reference_answer='PRIVATE_TEACHER_REFERENCE', remediation_answer='PRIVATE_REMEDIATION', analysis='PRIVATE_TEACHER_ANALYSIS', rubric=['PRIVATE_RUBRIC'], evidence_ids=[evidence.id], provenance='original', validation_status='validated')
                db.add(task); db.flush(); tasks.append(task.id)
            session.current_task_id = tasks[0]
            attempt = LearningAttempt(session_id=session.id, task_id=tasks[0], attempt_number=1, answer=f'已提交：{n+5}', verdict='incorrect', grading_layer='human', feedback=f'公开反馈{n+1}：请说明计算过程', missing_points=[], provider='human', model='none'); db.add(attempt); db.flush()
            draft_session = LearningSession(course_id=course.id, stage='diagnosing'); db.add(draft_session); db.flush()
            draft_task = LearningTask(session_id=draft_session.id, kind='diagnostic', ordinal=0, knowledge_point=f'课程{n+1}未提交探索', question_type='short_answer', stem=f'说明 {n+7} + 2 的过程', options=[], reference_answer='PRIVATE_DRAFT_REFERENCE', remediation_answer='PRIVATE_DRAFT_REMEDIATION', analysis='PRIVATE_DRAFT_ANALYSIS', evidence_ids=[evidence.id], provenance='original', validation_status='validated'); db.add(draft_task); db.flush(); draft_session.current_task_id = draft_task.id
            db.add(AssistantSnapshot(course_id=course.id, revision=1, snapshot={'schema':1,'courseId':course.id,'revision':0,'draft':'公开历史草稿','context':None,'entries':[{'id':'legacy-entry','message':'公开历史提问','context':None,'createdAt':'2026-11-23T00:00:00Z'}]}))
            result.append({'course_id':course.id,'session_id':session.id,'task_ids':tasks,'attempt_id':attempt.id,'draft_session_id':draft_session.id,'draft_task_id':draft_task.id,'source_ids':[s.id for s in sources]})
        db.commit()
    return result


if __name__ == '__main__': print(json.dumps(seed(),ensure_ascii=False))
