"""Validated, commit-pinned imports from public GitHub repositories."""

from dataclasses import dataclass
from hashlib import sha1
import re
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote, unquote, urlsplit

import httpx

from .storage import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES


MAX_IMPORT_FILES = 20
MAX_IMPORT_BYTES = 100 * 1024 * 1024
API_ROOT = "https://api.github.com"
RAW_ROOT = "https://raw.githubusercontent.com"
NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+$")
INVALID_REF = re.compile(r"[\x00-\x20\x7f~^:?*\[\\]")


class GitHubError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class GitHubLocation:
    owner: str
    repo: str
    ref: str | None
    path: str

    @property
    def repository(self) -> str:
        return f"{self.owner}/{self.repo}"


@dataclass(frozen=True)
class GitHubFile:
    path: str
    size: int
    sha: str


@dataclass(frozen=True)
class GitHubPreview:
    repository: str
    ref: str
    commit_sha: str
    path: str
    files: tuple[GitHubFile, ...]
    skipped_unsupported: int
    skipped_oversize: int

    @property
    def total_bytes(self) -> int:
        return sum(file.size for file in self.files)

    def as_dict(self) -> dict[str, Any]:
        return {
            "repository": self.repository,
            "ref": self.ref,
            "commit_sha": self.commit_sha,
            "path": self.path,
            "files": [file.__dict__ for file in self.files],
            "total_bytes": self.total_bytes,
            "skipped_unsupported": self.skipped_unsupported,
            "skipped_oversize": self.skipped_oversize,
        }


def normalize_repo_path(value: str | None) -> str:
    path = (value or "").strip().strip("/")
    if "\\" in path or any(ord(char) < 32 for char in path):
        raise GitHubError(422, "仓库路径包含无效字符")
    parts = path.split("/") if path else []
    if any(part in {"", ".", ".."} for part in parts):
        raise GitHubError(422, "仓库路径不能包含相对路径跳转")
    return "/".join(parts)


def normalize_ref(value: str | None) -> str | None:
    ref = (value or "").strip() or None
    if ref is None:
        return None
    if (
        len(ref) > 200 or INVALID_REF.search(ref) or ".." in ref or "@{" in ref
        or ref.startswith(("/", ".")) or ref.endswith(("/", ".", ".lock")) or "//" in ref
    ):
        raise GitHubError(422, "分支或提交标识无效")
    return ref


def parse_github_url(url: str, ref: str | None = None, path: str | None = None) -> GitHubLocation:
    try:
        parsed = urlsplit(url.strip())
    except ValueError as error:
        raise GitHubError(422, "GitHub 地址无效") from error
    if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.username or parsed.password:
        raise GitHubError(422, "仅支持公开的 https://github.com 仓库地址")
    if parsed.query or parsed.fragment:
        raise GitHubError(422, "请使用不含查询参数或锚点的仓库地址")
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]
    if len(segments) < 2:
        raise GitHubError(422, "地址需要包含仓库所有者和名称")
    owner, repo = segments[:2]
    repo = repo.removesuffix(".git")
    if not NAME_PATTERN.fullmatch(owner) or not NAME_PATTERN.fullmatch(repo) or repo in {".", ".."}:
        raise GitHubError(422, "仓库所有者或名称无效")

    url_ref: str | None = None
    url_path = ""
    remaining = segments[2:]
    if remaining:
        if remaining[0] != "tree" or len(remaining) < 2:
            raise GitHubError(422, "请使用仓库首页或 /tree/ 目录地址")
        url_ref = normalize_ref(remaining[1])
        url_path = normalize_repo_path("/".join(remaining[2:]))
    explicit_ref = normalize_ref(ref)
    explicit_path = normalize_repo_path(path)
    if url_ref and explicit_ref and url_ref != explicit_ref:
        raise GitHubError(422, "地址中的分支与单独填写的分支不一致")
    if url_path and explicit_path and url_path != explicit_path:
        raise GitHubError(422, "地址中的路径与单独填写的路径不一致")
    return GitHubLocation(owner, repo, explicit_ref or url_ref, explicit_path or url_path)


class GitHubService:
    def __init__(self, transport: httpx.BaseTransport | None = None):
        self.transport = transport

    def _client(self) -> httpx.Client:
        return httpx.Client(
            timeout=httpx.Timeout(15.0, connect=8.0),
            headers={"Accept": "application/vnd.github+json", "User-Agent": "ExamEngine/0.1"},
            transport=self.transport,
        )

    @staticmethod
    def _response(response: httpx.Response) -> httpx.Response:
        if response.status_code in {403, 429}:
            raise GitHubError(429, "GitHub 访问频率受限，请稍后再试")
        if response.status_code == 404:
            raise GitHubError(404, "仓库、分支或路径不存在；首版仅支持公开仓库")
        if response.status_code >= 400:
            raise GitHubError(502, f"GitHub 返回错误（{response.status_code}）")
        return response

    def preview(self, url: str, ref: str | None = None, path: str | None = None) -> GitHubPreview:
        location = parse_github_url(url, ref, path)
        try:
            with self._client() as client:
                repository_url = f"{API_ROOT}/repos/{location.owner}/{location.repo}"
                repository = self._response(client.get(repository_url)).json()
                resolved_ref = location.ref or repository.get("default_branch")
                if not isinstance(resolved_ref, str) or not resolved_ref:
                    raise GitHubError(502, "GitHub 未返回默认分支")
                commit_url = f"{repository_url}/commits/{quote(resolved_ref, safe='')}"
                commit = self._response(client.get(commit_url)).json()
                commit_sha = commit.get("sha")
                if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
                    raise GitHubError(502, "GitHub 未返回有效提交标识")
                tree_url = f"{repository_url}/git/trees/{commit_sha}"
                tree = self._response(client.get(tree_url, params={"recursive": "1"})).json()
        except httpx.TimeoutException as error:
            raise GitHubError(504, "连接 GitHub 超时，请稍后重试") from error
        except httpx.RequestError as error:
            raise GitHubError(502, "暂时无法连接 GitHub，请检查网络") from error
        if tree.get("truncated"):
            raise GitHubError(422, "仓库目录树过大，请缩小到具体子目录或文件")
        entries = tree.get("tree")
        if not isinstance(entries, list):
            raise GitHubError(502, "GitHub 未返回有效目录树")

        prefix = f"{location.path}/" if location.path else ""
        matched = 0
        files: list[GitHubFile] = []
        skipped_unsupported = 0
        skipped_oversize = 0
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("type") != "blob":
                continue
            entry_path = entry.get("path")
            if not isinstance(entry_path, str):
                continue
            if location.path and entry_path != location.path and not entry_path.startswith(prefix):
                continue
            matched += 1
            if PurePosixPath(entry_path).suffix.casefold() not in ALLOWED_EXTENSIONS:
                skipped_unsupported += 1
                continue
            size = entry.get("size")
            file_sha = entry.get("sha")
            if not isinstance(size, int) or size < 0 or not isinstance(file_sha, str):
                raise GitHubError(502, "GitHub 返回了无效文件元数据")
            if size == 0 or size > MAX_UPLOAD_BYTES:
                skipped_oversize += 1
                continue
            files.append(GitHubFile(entry_path, size, file_sha))
        if matched == 0:
            raise GitHubError(404, "指定路径不存在或不含文件")
        if len(files) > MAX_IMPORT_FILES:
            raise GitHubError(422, f"单次最多导入 {MAX_IMPORT_FILES} 个可解析文件，请缩小目录")
        if sum(file.size for file in files) > MAX_IMPORT_BYTES:
            raise GitHubError(413, "单次导入总大小不能超过 100 MB，请缩小目录")
        files.sort(key=lambda file: file.path)
        return GitHubPreview(
            repository=location.repository,
            ref=resolved_ref,
            commit_sha=commit_sha,
            path=location.path,
            files=tuple(files),
            skipped_unsupported=skipped_unsupported,
            skipped_oversize=skipped_oversize,
        )

    def download(self, preview: GitHubPreview, file: GitHubFile) -> bytes:
        owner, repo = preview.repository.split("/", 1)
        url = f"{RAW_ROOT}/{owner}/{repo}/{preview.commit_sha}/{quote(file.path, safe='/')}"
        try:
            with self._client() as client:
                response = self._response(client.get(url))
                content = response.content
        except httpx.TimeoutException as error:
            raise GitHubError(504, f"下载 {file.path} 超时") from error
        except httpx.RequestError as error:
            raise GitHubError(502, f"下载 {file.path} 时网络连接失败") from error
        if len(content) != file.size or len(content) > MAX_UPLOAD_BYTES:
            raise GitHubError(502, f"{file.path} 的下载大小与预览不一致")
        git_sha = sha1(f"blob {len(content)}\0".encode() + content, usedforsecurity=False).hexdigest()
        if git_sha != file.sha:
            raise GitHubError(502, f"{file.path} 的内容校验失败，请重新预览")
        return content
