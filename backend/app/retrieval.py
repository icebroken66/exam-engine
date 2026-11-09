"""Small, deterministic lexical retrieval over a course's parsed evidence."""

from dataclasses import dataclass
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ingestion import ParseStatus
from .models import DocumentNode, EvidenceBlock, Source


_WORD = re.compile(r"[a-z0-9_]{2,}", re.IGNORECASE)
_CJK_RUN = re.compile(r"[\u3400-\u9fff]+")
_QUESTION_FILLER = {
    "什么", "怎么", "怎样", "如何", "为何", "为什么", "请问", "一下", "简述", "解释", "说明", "是指",
}


@dataclass(frozen=True)
class RetrievedEvidence:
    evidence_id: str
    source_id: str
    source_name: str
    node_title: str
    page_number: int | None
    text: str
    score: float


def query_terms(text: str) -> set[str]:
    """Extract English words and Chinese bigrams without requiring a search service."""
    normalized = text.casefold()
    terms = set(_WORD.findall(normalized))
    for run in _CJK_RUN.findall(normalized):
        if len(run) == 1:
            terms.add(run)
            continue
        terms.update(run[index:index + 2] for index in range(len(run) - 1))
        if 2 <= len(run) <= 4:
            terms.add(run)
    return terms.difference(_QUESTION_FILLER)


def search_course_evidence(
    db: Session,
    course_id: str,
    question: str,
    limit: int = 3,
    *, focus: str = "",
) -> list[RetrievedEvidence]:
    terms = query_terms(question)
    focus_terms = query_terms(focus)
    if not terms:
        return []
    rows = db.execute(
        select(EvidenceBlock, Source, DocumentNode.title)
        .join(Source, EvidenceBlock.source_id == Source.id)
        .join(DocumentNode, EvidenceBlock.node_id == DocumentNode.id)
        .where(
            Source.course_id == course_id, Source.removed_at.is_(None),
            Source.status.in_([ParseStatus.READY.value, ParseStatus.NEEDS_REVIEW.value]),
        )
    ).all()
    ranked: list[RetrievedEvidence] = []
    for block, source, node_title in rows:
        searchable = f"{node_title}\n{block.text}".casefold()
        matched = {term for term in terms if term in searchable}
        if not matched:
            continue
        # Longer exact terms and distinctive English words contribute more than generic bigrams.
        weight = sum(min(len(term), 6) for term in matched)
        score = weight / sum(min(len(term), 6) for term in terms)
        if focus_terms:
            # A bounded topical tie-breaker for dialogue. Other retrieval callers
            # keep their existing ranking. Definitions often live in page headings.
            heading = f"{node_title}\n" + "\n".join(block.text.splitlines()[:3])
            topical = sum(min(len(term), 6) for term in focus_terms if term in heading.casefold())
            score += 0.2 * topical / sum(min(len(term), 6) for term in focus_terms)
        ranked.append(RetrievedEvidence(
            evidence_id=block.id,
            source_id=source.id,
            source_name=source.original_name,
            node_title=node_title,
            page_number=block.page_number,
            text=block.text,
            score=round(score, 4),
        ))
    ranked.sort(key=lambda item: (-item.score, item.source_name, item.evidence_id))
    return ranked[:limit]
