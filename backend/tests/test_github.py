from hashlib import sha1
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
import pytest

from app.github import GitHubError, GitHubPreview, GitHubService, parse_github_url
from app.main import get_github_service
from test_sources import create_course


COMMIT = "a" * 40
BLOB_CONTENT = b"# Chapter\n\nEvidence"


def blob_sha(content: bytes) -> str:
    return sha1(f"blob {len(content)}\0".encode() + content, usedforsecurity=False).hexdigest()


def test_parse_repository_tree_url_and_explicit_location() -> None:
    location = parse_github_url("https://github.com/owner/repo/tree/main/courses/os")
    assert location.repository == "owner/repo"
    assert location.ref == "main"
    assert location.path == "courses/os"
    explicit = parse_github_url("https://github.com/owner/repo.git", "feature/docs", "notes")
    assert explicit.ref == "feature/docs"
    assert explicit.path == "notes"


@pytest.mark.parametrize("url,path", [
    ("https://example.com/owner/repo", ""),
    ("https://github.com/owner/repo/blob/main/a.md", ""),
    ("https://github.com/owner/repo", "../outside"),
])
def test_reject_untrusted_or_ambiguous_locations(url: str, path: str) -> None:
    with pytest.raises(GitHubError):
        parse_github_url(url, path=path)


def github_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        routes = {
            "https://api.github.com/repos/owner/repo": {"default_branch": "main"},
            "https://api.github.com/repos/owner/repo/commits/main": {"sha": COMMIT},
            f"https://api.github.com/repos/owner/repo/git/trees/{COMMIT}?recursive=1": {
                "truncated": False,
                "tree": [
                    {"type": "blob", "path": "notes/chapter.md", "size": len(BLOB_CONTENT), "sha": blob_sha(BLOB_CONTENT)},
                    {"type": "blob", "path": "notes/program.exe", "size": 20, "sha": "b" * 40},
                    {"type": "blob", "path": "outside.md", "size": 20, "sha": "c" * 40},
                ],
            },
            f"https://raw.githubusercontent.com/owner/repo/{COMMIT}/notes/chapter.md": BLOB_CONTENT,
        }
        url = str(request.url)
        if url not in routes:
            return httpx.Response(404)
        result = routes[url]
        if isinstance(result, bytes):
            return httpx.Response(200, content=result)
        return httpx.Response(200, json=result)
    return httpx.MockTransport(handler)


def test_preview_filters_directory_and_download_verifies_blob() -> None:
    service = GitHubService(github_transport())
    preview = service.preview("https://github.com/owner/repo/tree/main/notes")
    assert preview.commit_sha == COMMIT
    assert preview.total_bytes == len(BLOB_CONTENT)
    assert preview.skipped_unsupported == 1
    assert [file.path for file in preview.files] == ["notes/chapter.md"]
    assert service.download(preview, preview.files[0]) == BLOB_CONTENT


def test_download_rejects_changed_content() -> None:
    service = GitHubService(github_transport())
    preview = service.preview("https://github.com/owner/repo/tree/main/notes")
    changed = GitHubPreview(
        preview.repository, preview.ref, preview.commit_sha, preview.path,
        (type(preview.files[0])(preview.files[0].path, preview.files[0].size, "d" * 40),),
        preview.skipped_unsupported, preview.skipped_oversize,
    )
    with pytest.raises(GitHubError, match="内容校验失败"):
        service.download(changed, changed.files[0])


def use_github(client: TestClient) -> None:
    client.app.dependency_overrides[get_github_service] = lambda: GitHubService(github_transport())


def import_payload(rights: bool = True) -> dict:
    return {
        "url": "https://github.com/owner/repo/tree/main/notes",
        "expected_commit_sha": COMMIT,
        "rights_confirmed": rights,
    }


def test_github_preview_endpoint(client: TestClient) -> None:
    use_github(client)
    course_id = create_course(client)
    response = client.post(
        f"/api/courses/{course_id}/github/preview",
        json={"url": "https://github.com/owner/repo/tree/main/notes"},
    )
    assert response.status_code == 200
    assert response.json()["commit_sha"] == COMMIT
    assert response.json()["files"][0]["path"] == "notes/chapter.md"
    assert response.json()["skipped_unsupported"] == 1


def test_github_import_persists_origin_and_deduplicates(client: TestClient, tmp_path: Path) -> None:
    use_github(client)
    course_id = create_course(client)
    first = client.post(f"/api/courses/{course_id}/github/import", json=import_payload())
    assert first.status_code == 200, first.text
    assert first.json()["imported_count"] == 1
    assert first.json()["failures"] == []
    source = first.json()["results"][0]["source"]
    assert source["origins"] == [{
        "id": source["origins"][0]["id"],
        "kind": "github",
        "repository": "owner/repo",
        "ref": "main",
        "commit_sha": COMMIT,
        "path": "notes/chapter.md",
    }]
    downloaded = client.get(f"/api/sources/{source['id']}/file")
    assert downloaded.content == BLOB_CONTENT

    second = client.post(f"/api/courses/{course_id}/github/import", json=import_payload())
    assert second.json()["deduplicated_count"] == 1
    assert second.json()["results"][0]["source"]["id"] == source["id"]
    listed = client.get(f"/api/courses/{course_id}/sources").json()
    assert len(listed) == 1 and len(listed[0]["origins"]) == 1
    assert len(list((tmp_path / "uploads").iterdir())) == 1


def test_github_import_requires_rights_and_current_commit(client: TestClient) -> None:
    use_github(client)
    course_id = create_course(client)
    denied = client.post(f"/api/courses/{course_id}/github/import", json=import_payload(rights=False))
    assert denied.status_code == 422
    stale_payload = {**import_payload(), "expected_commit_sha": "f" * 40}
    stale = client.post(f"/api/courses/{course_id}/github/import", json=stale_payload)
    assert stale.status_code == 409
    assert client.get(f"/api/courses/{course_id}/sources").json() == []
