from pathlib import Path

from fastapi.testclient import TestClient

from app import storage


def create_course(client: TestClient, name: str = "操作系统原理") -> str:
    response = client.post("/api/courses", json={
        "school": "华中科技大学",
        "name": name,
    })
    assert response.status_code == 201
    return response.json()["id"]


def upload(client: TestClient, course_id: str, content: bytes = b"chapter one", name: str = "notes.md"):
    return client.post(
        f"/api/courses/{course_id}/sources",
        data={"rights_confirmed": "true"},
        files={"file": (name, content, "text/markdown")},
    )


def test_upload_list_and_download_source(client: TestClient, tmp_path: Path) -> None:
    course_id = create_course(client)
    response = upload(client, course_id)
    assert response.status_code == 201
    body = response.json()
    assert not body["deduplicated"]
    source = body["source"]
    assert source["status"] == "queued"
    assert source["original_name"] == "notes.md"
    assert len(source["sha256"]) == 64
    assert len(list((tmp_path / "uploads").iterdir())) == 1

    listed = client.get(f"/api/courses/{course_id}/sources")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [source["id"]]

    downloaded = client.get(f"/api/sources/{source['id']}/file")
    assert downloaded.status_code == 200
    assert downloaded.content == b"chapter one"


def test_duplicate_content_reuses_source_and_removes_extra_file(client: TestClient, tmp_path: Path) -> None:
    course_id = create_course(client)
    first = upload(client, course_id).json()["source"]
    second = upload(client, course_id, name="renamed.md")
    assert second.status_code == 200
    assert second.json()["deduplicated"]
    assert second.json()["source"]["id"] == first["id"]
    assert len(list((tmp_path / "uploads").iterdir())) == 1

    other_course = create_course(client, "另一门课")
    copied = upload(client, other_course)
    assert copied.status_code == 201
    assert copied.json()["source"]["id"] != first["id"]


def test_upload_requires_rights_confirmation(client: TestClient) -> None:
    course_id = create_course(client)
    response = client.post(
        f"/api/courses/{course_id}/sources",
        data={"rights_confirmed": "false"},
        files={"file": ("notes.md", b"text", "text/markdown")},
    )
    assert response.status_code == 422


def test_reject_unsupported_and_empty_files(client: TestClient) -> None:
    course_id = create_course(client)
    unsupported = upload(client, course_id, name="program.exe")
    assert unsupported.status_code == 415
    empty = upload(client, course_id, content=b"")
    assert empty.status_code == 422


def test_upload_size_limit_is_enforced_while_streaming(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(storage, "MAX_UPLOAD_BYTES", 3)
    course_id = create_course(client)
    response = upload(client, course_id, content=b"too large")
    assert response.status_code == 413


def test_original_filename_cannot_control_storage_path(client: TestClient, tmp_path: Path) -> None:
    course_id = create_course(client)
    response = upload(client, course_id, name="../../outside.md")
    assert response.status_code == 201
    assert response.json()["source"]["original_name"] == "outside.md"
    assert not (tmp_path / "outside.md").exists()
    assert len(list((tmp_path / "uploads").iterdir())) == 1


def test_upload_automatically_queues_parse_and_rejects_duplicate_active_task(client: TestClient) -> None:
    course_id = create_course(client)
    source = upload(client, course_id).json()["source"]
    assert source["status"] == "queued"

    duplicate = client.post(f"/api/sources/{source['id']}/parse")
    assert duplicate.status_code == 409
    tasks = client.get(f"/api/sources/{source['id']}/tasks")
    assert len(tasks.json()) == 1

    sources = client.get(f"/api/courses/{course_id}/sources").json()
    assert sources[0]["status"] == "queued"


def test_upload_to_missing_course_is_404(client: TestClient) -> None:
    assert upload(client, "missing").status_code == 404


def test_batch_upload_preserves_paths_isolates_failures_and_deduplicates(client: TestClient) -> None:
    course_id = create_course(client)
    response = client.post(
        f"/api/courses/{course_id}/sources/batch",
        data={
            "rights_confirmed": "true",
            "relative_paths": ["课件/第一章.md", "课件/第二章.md", "坏文件.exe"],
        },
        files=[
            ("files", ("第一章.md", b"# first\n\ncontent", "text/markdown")),
            ("files", ("第二章.md", b"# second\n\ncontent", "text/markdown")),
            ("files", ("坏文件.exe", b"invalid", "application/octet-stream")),
        ],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["imported_count"] == 2
    assert body["deduplicated_count"] == 0
    assert len(body["failures"]) == 1
    assert body["batch_id"]
    assert {item["source"]["relative_path"] for item in body["results"]} == {"课件/第一章.md", "课件/第二章.md"}
    assert all(item["source"]["import_batch_id"] == body["batch_id"] for item in body["results"])

    repeated = client.post(
        f"/api/courses/{course_id}/sources/batch",
        data={"rights_confirmed": "true"},
        files=[("files", ("renamed.md", b"# first\n\ncontent", "text/markdown"))],
    )
    assert repeated.status_code == 201
    assert repeated.json()["deduplicated_count"] == 1
    assert repeated.json()["results"][0]["source"]["id"] == body["results"][0]["source"]["id"]


def test_batch_requires_at_least_one_file_and_rights(client: TestClient) -> None:
    course_id = create_course(client)
    response = client.post(
        f"/api/courses/{course_id}/sources/batch",
        data={"rights_confirmed": "false"},
        files=[("files", ("notes.md", b"text", "text/markdown"))],
    )
    assert response.status_code == 422
