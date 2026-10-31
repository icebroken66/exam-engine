from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.worker import run_next_task
from test_sources import create_course, upload


def test_empty_course_is_explicitly_incomplete(client: TestClient) -> None:
    course_id = create_course(client)
    report = client.get(f"/api/courses/{course_id}/completeness")
    assert report.status_code == 200
    assert report.json()["complete"] is False
    assert report.json()["total_sources"] == 0


def test_report_tracks_upload_parse_and_ready_states(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> None:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=b"# Chapter\n\nEvidence").json()["source"]["id"]

    uploaded = client.get(f"/api/courses/{course_id}/completeness").json()
    assert uploaded["attention_sources"] == 1
    assert uploaded["issues"][0]["code"] == "not_parsed"

    client.post(f"/api/sources/{source_id}/parse")
    with session_factory() as db:
        run_next_task(db, tmp_path / "uploads")

    ready = client.get(f"/api/courses/{course_id}/completeness").json()
    assert ready["complete"] is True
    assert ready["ready_sources"] == 1
    assert ready["evidence_blocks"] == 2
    assert ready["issues"] == []


def test_missing_course_report_is_404(client: TestClient) -> None:
    assert client.get("/api/courses/missing/completeness").status_code == 404
