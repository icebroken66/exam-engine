"""Small single-worker queue for development and the first deployment."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import time

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .config import get_data_dir
from .database import Base, SessionLocal, engine, migrate_schema
from .exam_extraction import extract_exam_questions
from .ingestion import ParseStatus, assert_transition
from .material_types import classify_source
from .model_gateway import ModelGateway
from .models import DocumentNode, EvidenceBlock, ParseTask, Source, UsageRecord
from .parsing import parse_file
from .visual_parsing import transcribe_visual_source


def recover_interrupted_tasks(db: Session) -> int:
    tasks = list(db.scalars(select(ParseTask).where(ParseTask.status == ParseStatus.RUNNING.value)).all())
    for task in tasks:
        task.status = ParseStatus.QUEUED.value
        task.error = "服务重启，已恢复中断的解析任务"
        source = db.get(Source, task.source_id)
        if source is not None:
            source.status = ParseStatus.QUEUED.value
            source.processing_stage = ParseStatus.QUEUED.value
            source.processing_completed = 0
            source.processing_total = 0
    interrupted_usage = list(db.scalars(select(UsageRecord).where(UsageRecord.status == "running")).all())
    for record in interrupted_usage:
        record.status = "failed"
        record.reserved_tokens = 0
        record.error = "服务重启，上次模型调用已中断；后续任务可重新执行"
    db.commit()
    return len(tasks)


def run_next_task(db: Session, upload_dir: Path, gateway: ModelGateway | None = None) -> bool:
    task = db.scalar(
        select(ParseTask).where(ParseTask.status == ParseStatus.QUEUED.value).order_by(ParseTask.created_at).limit(1)
    )
    if task is None:
        return False

    source = db.get(Source, task.source_id)
    if source is None or source.removed_at is not None:
        task.status = ParseStatus.FAILED.value
        task.error = "任务关联的资料已不存在"
        db.commit()
        return True

    claimed = db.execute(update(ParseTask).where(
        ParseTask.id == task.id, ParseTask.status == ParseStatus.QUEUED.value,
        ParseTask.source_id.in_(select(Source.id).where(Source.removed_at.is_(None))),
    ).values(status=ParseStatus.RUNNING.value), execution_options={"synchronize_session": False})
    if claimed.rowcount != 1:
        db.rollback()
        return True
    db.refresh(source)
    assert_transition(ParseStatus(task.status), ParseStatus.RUNNING)
    started = time.monotonic()
    started_at = datetime.now(timezone.utc)
    task.status = ParseStatus.RUNNING.value
    source.status = ParseStatus.RUNNING.value
    source.processing_stage = "extracting"
    source.processing_completed = 0
    source.processing_total = 0
    source.processing_started_at = started_at
    source.processing_finished_at = None
    source.processing_duration_seconds = 0
    db.commit()
    print(f"[worker] 开始解析 {source.id}（{source.extension}）", flush=True)

    try:
        path = upload_dir / source.storage_key
        if not path.is_file():
            raise FileNotFoundError("原件缺失，无法解析")
        outcome = parse_file(source.id, path, source.extension)
        source.processing_stage = "transcribing"
        db.commit()
        outcome = transcribe_visual_source(db, source, path, outcome, gateway)
        print(f"[worker] 内容提取完成，耗时 {time.monotonic() - started:.2f} 秒", flush=True)

        db.execute(delete(EvidenceBlock).where(EvidenceBlock.source_id == source.id))
        db.execute(delete(DocumentNode).where(DocumentNode.source_id == source.id))
        for parsed_node in outcome.nodes:
            db.add(DocumentNode(
                id=parsed_node.id,
                source_id=source.id,
                title=parsed_node.title,
                ordinal=parsed_node.ordinal,
                page_start=parsed_node.page_start,
                page_end=parsed_node.page_end,
            ))
        for parsed_block in outcome.blocks:
            db.add(EvidenceBlock(
                id=parsed_block.id,
                source_id=source.id,
                node_id=parsed_block.node_id,
                ordinal=parsed_block.ordinal,
                text=parsed_block.text,
                page_number=parsed_block.page_number,
                content_hash=parsed_block.content_hash,
            ))

        source.processing_stage = "classifying"
        db.commit()
        classification = classify_source(
            db, source, [block.text[:2000] for block in outcome.blocks], gateway,
        )
        source.material_type = classification.material_type
        source.material_confidence = classification.confidence
        source.material_rationale = classification.rationale

        extraction_errors: list[str] = []
        has_unconfirmed_transcription = bool(outcome.stats.get("vision_pages"))
        if (
            source.material_type == "past_exam" and gateway is not None
            and outcome.blocks and not has_unconfirmed_transcription
        ):
            extraction = extract_exam_questions(db, source, gateway)
            extraction_errors = extraction["errors"]
            print(
                f"[worker] 试卷结构化完成：{extraction['total']} 题，"
                f"已验收 {extraction['verified']}，待确认 {extraction['draft']}",
                flush=True,
            )

        final_status = ParseStatus.NEEDS_REVIEW.value if extraction_errors else outcome.status
        assert_transition(ParseStatus(task.status), ParseStatus(final_status))
        task.status = final_status
        task.error = "；".join(filter(None, [outcome.error, *extraction_errors])) or None
        source.status = final_status
        source.processing_stage = final_status
        source.processing_note = task.error or ""
        source.processing_finished_at = datetime.now(timezone.utc)
        source.processing_duration_seconds = max(0, time.monotonic() - started)
        db.commit()
    except Exception as error:
        db.rollback()
        failed_task = db.get(ParseTask, task.id)
        failed_source = db.get(Source, source.id)
        if failed_task is not None:
            failed_task.status = ParseStatus.FAILED.value
            failed_task.error = str(error)[:2000]
        if failed_source is not None:
            failed_source.status = ParseStatus.FAILED.value
            failed_source.processing_stage = ParseStatus.FAILED.value
            failed_source.processing_note = str(error)[:2000]
            failed_source.processing_finished_at = datetime.now(timezone.utc)
            failed_source.processing_duration_seconds = max(0, time.monotonic() - started)
        db.commit()
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="最多处理一个任务后退出")
    args = parser.parse_args()
    upload_dir = get_data_dir() / "uploads"
    Base.metadata.create_all(bind=engine)
    migrate_schema()
    upload_dir.mkdir(parents=True, exist_ok=True)
    gateway = ModelGateway.from_env()
    with SessionLocal() as db:
        recovered = recover_interrupted_tasks(db)
    if recovered:
        print(f"[worker] 已恢复 {recovered} 个中断任务", flush=True)
    print(f"[worker] 已启动，数据目录：{get_data_dir()}", flush=True)

    while True:
        with SessionLocal() as db:
            did_work = run_next_task(db, upload_dir, gateway)
        if did_work:
            print("[worker] 已处理一个解析任务", flush=True)
        if args.once or not did_work:
            if args.once:
                return
            time.sleep(0.75)


if __name__ == "__main__":
    main()
