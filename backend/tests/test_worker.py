from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.models import DocumentNode, EvidenceBlock, ParseTask
from app.worker import run_next_task
from test_sources import create_course, upload


def test_worker_persists_nodes_and_evidence(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> None:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=b"# Chapter\n\nEvidence paragraph.").json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")

    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads")
        task = db.scalar(select(ParseTask).where(ParseTask.source_id == source_id))
        assert task is not None and task.status == "ready"
        nodes = list(db.scalars(select(DocumentNode).where(DocumentNode.source_id == source_id)))
        blocks = list(db.scalars(select(EvidenceBlock).where(EvidenceBlock.source_id == source_id)))
        assert len(nodes) == 1
        assert len(blocks) == 2
        assert blocks[0].node_id == nodes[0].id

    source = client.get(f"/api/courses/{course_id}/sources").json()[0]
    assert source["status"] == "ready"
    evidence = client.get(f"/api/sources/{source_id}/evidence")
    assert evidence.status_code == 200
    assert evidence.json()[0]["node_title"] == "Chapter"
    single = client.get(f"/api/evidence/{evidence.json()[0]['id']}")
    assert single.status_code == 200
    assert single.json()["text"].startswith("# Chapter")
    nodes_response = client.get(f"/api/sources/{source_id}/nodes")
    assert nodes_response.json()[0]["title"] == "Chapter"


def test_unsupported_parser_fails_explicitly(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> None:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=b"image", name="image.png").json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")

    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")
        task = db.scalar(select(ParseTask).where(ParseTask.source_id == source_id))
        assert task is not None and task.status == "failed"
        assert "后续阶段支持" in (task.error or "")

    source = client.get(f"/api/courses/{course_id}/sources").json()[0]
    assert source["status"] == "failed"
