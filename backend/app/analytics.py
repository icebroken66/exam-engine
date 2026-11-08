"""Auditable course statistics backed by relational knowledge-point tables."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .source_lifecycle import active_question
from .models import KnowledgePoint, Question, QuestionKnowledgePoint


def normalize_knowledge_name(name: str) -> str:
    return " ".join(name.casefold().split())


def sync_question_knowledge(db: Session, question: Question) -> None:
    db.query(QuestionKnowledgePoint).filter(
        QuestionKnowledgePoint.question_id == question.id,
    ).delete(synchronize_session=False)
    names: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_name in question.knowledge_points or []:
        name = " ".join(raw_name.strip().split())
        normalized = normalize_knowledge_name(name)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        names.append((name, normalized))
    for ordinal, (name, normalized) in enumerate(names):
        point = db.scalar(select(KnowledgePoint).where(
            KnowledgePoint.course_id == question.course_id,
            KnowledgePoint.normalized_name == normalized,
        ))
        if point is None:
            point = KnowledgePoint(
                course_id=question.course_id,
                name=name,
                normalized_name=normalized,
            )
            db.add(point)
            db.flush()
        db.add(QuestionKnowledgePoint(
            question_id=question.id,
            knowledge_point_id=point.id,
            ordinal=ordinal,
        ))
    db.flush()


def sync_course_knowledge(db: Session, course_id: str) -> None:
    """Backfill relations for questions created before the fixed table existed."""
    questions = list(db.scalars(select(Question).where(Question.course_id == course_id)).all())
    for question in questions:
        sync_question_knowledge(db, question)
    db.commit()


def course_knowledge_points(db: Session, course_id: str) -> list[KnowledgePoint]:
    sync_course_knowledge(db, course_id)
    return list(db.scalars(
        select(KnowledgePoint).where(KnowledgePoint.course_id == course_id, KnowledgePoint.id.in_(
            select(QuestionKnowledgePoint.knowledge_point_id).join(Question, Question.id == QuestionKnowledgePoint.question_id).where(active_question())
        )).order_by(KnowledgePoint.name)
    ).all())


def course_analytics(db: Session, course_id: str, half_life_years: float) -> dict:
    sync_course_knowledge(db, course_id)
    as_of_year = datetime.now(timezone.utc).year
    included = (
        Question.course_id == course_id, active_question(),
        Question.status == "verified",
        Question.provenance == "original",
    )
    verified_count = int(db.scalar(select(func.count(Question.id)).where(
        Question.course_id == course_id, active_question(), Question.status == "verified",
    )) or 0)
    included_count = int(db.scalar(select(func.count(Question.id)).where(*included)) or 0)
    draft_count = int(db.scalar(select(func.count(Question.id)).where(
        Question.course_id == course_id, active_question(), Question.status == "draft",
    )) or 0)
    adapted_count = int(db.scalar(select(func.count(Question.id)).where(
        Question.course_id == course_id, active_question(), Question.provenance == "adapted",
    )) or 0)
    unknown_year_count = int(db.scalar(select(func.count(Question.id)).where(
        *included, Question.origin_year.is_(None),
    )) or 0)

    knowledge_rows = db.execute(
        select(KnowledgePoint.id, KnowledgePoint.name, Question.origin_year, func.count(Question.id))
        .join(QuestionKnowledgePoint, QuestionKnowledgePoint.knowledge_point_id == KnowledgePoint.id)
        .join(Question, QuestionKnowledgePoint.question_id == Question.id)
        .where(*included)
        .group_by(KnowledgePoint.id, KnowledgePoint.name, Question.origin_year)
    ).all()
    reference_rows = db.execute(
        select(
            QuestionKnowledgePoint.knowledge_point_id,
            Question.id,
            Question.stem,
            Question.question_type,
            Question.origin_year,
        )
        .join(Question, QuestionKnowledgePoint.question_id == Question.id)
        .where(*included)
        .order_by(Question.origin_year.desc(), Question.created_at)
    ).all()
    references: dict[str, list[dict]] = {}
    for point_id, question_id, stem, question_type, origin_year in reference_rows:
        references.setdefault(point_id, []).append({
            "id": question_id,
            "stem": stem,
            "question_type": question_type,
            "origin_year": origin_year,
        })

    grouped: dict[str, dict] = {}
    for point_id, name, year, count in knowledge_rows:
        item = grouped.setdefault(point_id, {
            "id": point_id,
            "name": name,
            "question_count": 0,
            "unknown_year_count": 0,
            "weighted_frequency": 0.0,
            "yearly_contributions": [],
            "questions": references.get(point_id, []),
        })
        item["question_count"] += count
        if year is None:
            item["unknown_year_count"] += count
            continue
        factor = 2 ** (-max(0, as_of_year - year) / half_life_years)
        weighted = count * factor
        item["weighted_frequency"] += weighted
        item["yearly_contributions"].append({
            "year": year,
            "question_count": count,
            "decay_factor": round(factor, 6),
            "weighted_count": round(weighted, 6),
        })
    knowledge_stats = list(grouped.values())
    for item in knowledge_stats:
        item["weighted_frequency"] = round(item["weighted_frequency"], 6)
        item["yearly_contributions"].sort(key=lambda contribution: contribution["year"], reverse=True)
    knowledge_stats.sort(key=lambda item: (-item["weighted_frequency"], -item["question_count"], item["name"]))

    type_rows = db.execute(
        select(Question.question_type, Question.origin_year, func.count(Question.id))
        .where(*included)
        .group_by(Question.question_type, Question.origin_year)
    ).all()
    type_grouped: dict[str, dict] = {}
    for question_type, year, count in type_rows:
        item = type_grouped.setdefault(question_type, {
            "question_type": question_type,
            "question_count": 0,
            "share": 0.0,
            "yearly_counts": [],
        })
        item["question_count"] += count
        item["yearly_counts"].append({"year": year, "question_count": count})
    type_stats = list(type_grouped.values())
    for item in type_stats:
        item["share"] = round(item["question_count"] / included_count, 6) if included_count else 0
        item["yearly_counts"].sort(key=lambda contribution: (contribution["year"] is None, contribution["year"] or 0), reverse=True)
    type_stats.sort(key=lambda item: (-item["question_count"], item["question_type"]))
    return {
        "course_id": course_id,
        "as_of_year": as_of_year,
        "half_life_years": half_life_years,
        "decay_formula": "weight = 2 ^ (-max(0, as_of_year - origin_year) / half_life_years)",
        "verified_question_count": verified_count,
        "included_original_question_count": included_count,
        "draft_question_count": draft_count,
        "adapted_question_count": adapted_count,
        "unknown_year_question_count": unknown_year_count,
        "knowledge_points": knowledge_stats,
        "question_types": type_stats,
    }
