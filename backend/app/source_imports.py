from pathlib import PurePosixPath

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .ingestion import ParseStatus
from .models import ParseTask, Source
from .storage import StoredUpload
from .source_lifecycle import restore_source


def normalized_relative_path(value: str, fallback: str) -> str:
    path = PurePosixPath(value.replace("\\", "/"))
    parts = [part for part in path.parts if part not in {"", "/", ".", ".."}]
    return "/".join(parts)[:1000] or fallback


def save_new_source(
    db: Session,
    course_id: str,
    stored: StoredUpload,
    batch_id: str | None = None,
    relative_path: str = "",
) -> tuple[Source, bool]:
    duplicate = db.scalar(select(Source).where(Source.course_id == course_id, Source.sha256 == stored.sha256))
    if duplicate is not None:
        stored.path.unlink(missing_ok=True)
        restore_source(db, duplicate)
        _resume_failed_parse(db, duplicate)
        db.commit()
        return duplicate, True

    source = Source(
        course_id=course_id,
        import_batch_id=batch_id,
        original_name=stored.original_name,
        relative_path=normalized_relative_path(relative_path, stored.original_name),
        storage_key=stored.storage_key,
        extension=stored.extension,
        media_type=stored.media_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        status=ParseStatus.UPLOADED.value,
    )
    db.add(source)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        duplicate = db.scalar(select(Source).where(Source.course_id == course_id, Source.sha256 == stored.sha256))
        if duplicate is None:
            stored.path.unlink(missing_ok=True)
            raise
        stored.path.unlink(missing_ok=True)
        restore_source(db, duplicate)
        _resume_failed_parse(db, duplicate)
        db.commit()
        return duplicate, True

    source.status = ParseStatus.QUEUED.value
    source.processing_stage = ParseStatus.QUEUED.value
    db.add(ParseTask(source_id=source.id, attempt=1, status=ParseStatus.QUEUED.value))
    db.commit()
    db.refresh(source)
    return source, False


def _resume_failed_parse(db: Session, source: Source) -> None:
    if source.status not in {ParseStatus.UPLOADED.value, ParseStatus.FAILED.value}:
        return
    attempt = (db.scalar(select(ParseTask.attempt).where(ParseTask.source_id == source.id).order_by(ParseTask.attempt.desc()).limit(1)) or 0) + 1
    source.status = ParseStatus.QUEUED.value
    source.processing_stage = ParseStatus.QUEUED.value
    db.add(ParseTask(source_id=source.id, attempt=attempt, status=ParseStatus.QUEUED.value))
    db.commit()
