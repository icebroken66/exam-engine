"""Small single-worker queue for development and the first deployment."""

import argparse
from pathlib import Path
import time

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import get_data_dir
from .database import SessionLocal
from .ingestion import ParseStatus, assert_transition
from .models import DocumentNode, EvidenceBlock, ParseTask, Source
from .parsing import parse_file


def run_next_task(db: Session, upload_dir: Path) -> bool:
    task = db.scalar(
        select(ParseTask).where(ParseTask.status == ParseStatus.QUEUED.value).order_by(ParseTask.created_at).limit(1)
    )
    if task is None:
        return False

    source = db.get(Source, task.source_id)
    if source is None:
        task.status = ParseStatus.FAILED.value
        task.error = "任务关联的资料已不存在"
        db.commit()
        return True

    assert_transition(ParseStatus(task.status), ParseStatus.RUNNING)
    task.status = ParseStatus.RUNNING.value
    source.status = ParseStatus.RUNNING.value
    db.commit()
    started = time.monotonic()
    print(f"[worker] 开始解析 {source.id}（{source.extension}）", flush=True)

    try:
        path = upload_dir / source.storage_key
        if not path.is_file():
            raise FileNotFoundError("原件缺失，无法解析")
        outcome = parse_file(source.id, path, source.extension)
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

        assert_transition(ParseStatus(task.status), ParseStatus(outcome.status))
        task.status = outcome.status
        task.error = outcome.error
        source.status = outcome.status
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
        db.commit()
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="最多处理一个任务后退出")
    args = parser.parse_args()
    upload_dir = get_data_dir() / "uploads"
    print(f"[worker] 已启动，数据目录：{get_data_dir()}", flush=True)

    while True:
        with SessionLocal() as db:
            did_work = run_next_task(db, upload_dir)
        if did_work:
            print("[worker] 已处理一个解析任务", flush=True)
        if args.once or not did_work:
            if args.once:
                return
            time.sleep(0.75)


if __name__ == "__main__":
    main()
