"""Read-only ledger of observed source links, never an estimate of course mastery."""
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import DocumentNode, EvidenceBlock, LearningAttempt, LearningSession, LearningTask, Question, QuestionEvidence, Source
from .source_lifecycle import active_question


def course_coverage(db: Session, course_id: str) -> dict:
    sources = list(db.scalars(select(Source).where(Source.course_id == course_id, Source.removed_at.is_(None)).order_by(Source.created_at, Source.id)))
    source_ids = [source.id for source in sources]
    nodes = list(db.scalars(select(DocumentNode).where(DocumentNode.source_id.in_(source_ids)).order_by(DocumentNode.ordinal, DocumentNode.id)))
    blocks = list(db.scalars(select(EvidenceBlock).where(EvidenceBlock.source_id.in_(source_ids))))
    usable = {source.id for source in sources if source.status in {"ready", "needs_review"}}
    block_map = {block.id: block for block in blocks}
    active_origins = set(db.scalars(select(Question.id).where(Question.course_id == course_id, active_question())))
    question_rows = db.execute(select(Question, QuestionEvidence.evidence_id).join(QuestionEvidence, QuestionEvidence.question_id == Question.id).where(Question.course_id == course_id, Question.id.in_(active_origins), QuestionEvidence.evidence_id.in_(block_map))).all()
    tasks = list(db.scalars(select(LearningTask).join(LearningSession, LearningSession.id == LearningTask.session_id).where(LearningSession.course_id == course_id)))
    attempts = list(db.scalars(select(LearningAttempt).where(LearningAttempt.task_id.in_([task.id for task in tasks])).order_by(LearningAttempt.attempt_number, LearningAttempt.created_at, LearningAttempt.id)))
    latest = {attempt.task_id: attempt for attempt in attempts}
    nodes_by_source = defaultdict(list)
    blocks_by_node = defaultdict(list)
    for node in nodes:
        nodes_by_source[node.source_id].append(node)
    for block in blocks:
        blocks_by_node[(block.source_id, block.node_id)].append(block)
    units = {}
    for source in sources:
        source_nodes = nodes_by_source[source.id]
        for node in source_nodes or [None]:
            key = node.id if node else source.id
            unit_blocks = sorted(blocks_by_node[(source.id, node.id)], key=lambda block: (block.ordinal, block.id)) if node else []
            units[key] = dict(source_id=source.id, source_name=source.original_name, source_status=source.status,
                node_id=node.id if node else None, title=node.title if node else "尚未提取章节或页面",
                page_start=node.page_start if node else None, page_end=node.page_end if node else None,
                text_status="available" if unit_blocks and source.id in usable else "unavailable",
                semantic_status="untracked", evidence=[dict(id=b.id, page_number=b.page_number, excerpt=b.text[:180]) for b in unit_blocks],
                questions={}, topics=set(), diagnostic_tasks={}, retest_tasks={})
    for question, evidence_id in question_rows:
        block = block_map[evidence_id]
        unit = units.get(block.node_id)
        if unit is None:
            continue
        unit["questions"][question.id] = dict(id=question.id, status=question.status, provenance=question.provenance)
        unit["topics"].update(question.knowledge_points or [])
    for task in tasks:
        ids = set(task.evidence_ids or [])
        # Reject the whole link when any cited evidence is missing, foreign, or inactive.
        if not ids or any(key not in block_map or block_map[key].source_id not in usable for key in ids) or (task.origin_question_id and task.origin_question_id not in active_origins) or task.status == "withdrawn" or task.validation_status != "validated":
            continue
        attempt = latest.get(task.id)
        if not attempt or attempt.mocked or attempt.verdict not in {"correct", "incorrect"}:
            continue
        if attempt.grading_layer not in {"deterministic", "human_correction"} and (attempt.confidence is None or attempt.confidence < 0.8):
            continue
        for node_id in {block_map[key].node_id for key in ids}:
            unit = units.get(node_id)
            if unit is None:
                continue
            if task.kind == "diagnostic":
                unit["diagnostic_tasks"][task.id] = dict(id=task.id, session_id=task.session_id, knowledge_point=task.knowledge_point, sub_skill=task.sub_skill, verdict=attempt.verdict)
            if task.kind == "retest" and attempt.verdict == "correct" and attempt.hints_used == 0:
                unit["retest_tasks"][task.id] = dict(id=task.id, session_id=task.session_id, knowledge_point=task.knowledge_point, sub_skill=task.sub_skill, verdict=attempt.verdict)
    rows = []
    for unit in units.values():
        unit["topics"] = sorted(unit["topics"])
        for field in ["questions", "diagnostic_tasks", "retest_tasks"]:
            unit[field] = list(unit[field].values())
        rows.append(unit)
    return dict(course_id=course_id, source_count=len(sources), unit_count=len(rows),
        text_available_units=sum(row["text_status"] == "available" for row in rows),
        diagnostic_linked_units=sum(bool(row["diagnostic_tasks"]) for row in rows),
        retest_linked_units=sum(bool(row["retest_tasks"]) for row in rows),
        units=rows, limitation="仅盘点已提供资料与已有引用。文本可用不代表逐章理解；题目引用某页不代表整页或全部考点已检查。未建立语义处理台账，整课考试范围与覆盖分母未知，不计算整课覆盖率。重测记录不等于长期掌握。")
