"""Course-level completeness is aggregated from persisted state, never model prose."""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Course, DocumentNode, EvidenceBlock, Source


@dataclass(frozen=True)
class CompletenessIssue:
    source_id: str
    source_name: str
    code: str
    message: str
    node_id: str | None = None


STATUS_ISSUES = {
    "uploaded": ("not_parsed", "资料已上传，尚未加入解析"),
    "queued": ("queued", "资料正在等待解析"),
    "running": ("running", "资料正在解析"),
    "failed": ("parse_failed", "资料解析失败，请检查原件或重试"),
    "needs_review": ("needs_review", "资料有需要人工确认的内容"),
    "needs_transcription_review": ("needs_transcription_review", "视觉转录尚未确认，不参与范围分析或出题"),
}


def course_completeness(db: Session, course_id: str) -> dict | None:
    course = db.get(Course, course_id)
    if course is None:
        return None
    sources = list(db.scalars(select(Source).where(Source.course_id == course_id).order_by(Source.created_at)).all())
    source_ids = [source.id for source in sources]
    issues: list[CompletenessIssue] = []
    total_nodes = 0
    evidence_blocks = 0
    empty_nodes = 0

    for source in sources:
        if source.status in STATUS_ISSUES:
            code, message = STATUS_ISSUES[source.status]
            issues.append(CompletenessIssue(source.id, source.original_name, code, message))

    if source_ids:
        total_nodes = db.scalar(select(func.count(DocumentNode.id)).where(DocumentNode.source_id.in_(source_ids))) or 0
        evidence_blocks = db.scalar(select(func.count(EvidenceBlock.id)).where(EvidenceBlock.source_id.in_(source_ids))) or 0
        rows = db.execute(
            select(DocumentNode, Source.original_name)
            .join(Source, DocumentNode.source_id == Source.id)
            .outerjoin(EvidenceBlock, EvidenceBlock.node_id == DocumentNode.id)
            .where(DocumentNode.source_id.in_(source_ids))
            .group_by(DocumentNode.id, Source.original_name)
            .having(func.count(EvidenceBlock.id) == 0)
            .order_by(DocumentNode.source_id, DocumentNode.ordinal)
        ).all()
        empty_nodes = len(rows)
        for node, source_name in rows:
            issues.append(CompletenessIssue(
                node.source_id,
                source_name,
                "empty_node",
                f"{node.title}未提取到文本，请检查扫描件或补充原件",
                node.id,
            ))

    ready_sources = sum(source.status == "ready" for source in sources)
    return {
        "course_id": course_id,
        "total_sources": len(sources),
        "ready_sources": ready_sources,
        "attention_sources": len(sources) - ready_sources,
        "total_nodes": total_nodes,
        "empty_nodes": empty_nodes,
        "evidence_blocks": evidence_blocks,
        "complete": bool(sources) and ready_sources == len(sources) and empty_nodes == 0,
        "issues": [issue.__dict__ for issue in issues],
    }
