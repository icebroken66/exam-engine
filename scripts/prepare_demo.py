"""Prepare an isolated, repeatable presentation course through the real API."""

import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
API_BASE = os.getenv("EXAM_ENGINE_API_URL", "http://127.0.0.1:8000").rstrip("/")
COURSE_NAME = os.getenv("EXAM_ENGINE_DEMO_COURSE", "操作系统原理 · 展示版")
SOURCE_PATH = ROOT / "demo" / "周会演示_操作系统.md"
QUESTIONS_PATH = ROOT / "demo" / "周会演示_题目.json"


def request(path: str, payload: dict | None = None, method: str | None = None) -> dict | list:
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = Request(
        f"{API_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urlopen(req, timeout=15) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"{method or 'GET'} {path} 失败：{error.code} {detail}") from error


def upload(course_id: str) -> dict:
    content = SOURCE_PATH.read_bytes()
    boundary = f"----ExamEngineDemo{uuid4().hex}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"rights_confirmed\"\r\n\r\ntrue\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{SOURCE_PATH.name}\"\r\n"
        "Content-Type: text/markdown\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = Request(
        f"{API_BASE}/api/courses/{course_id}/sources",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urlopen(req, timeout=15) as response:
        return json.load(response)


def parse_and_wait(course_id: str, source_id: str) -> list[dict]:
    deadline = time.monotonic() + 30
    queued = False
    while time.monotonic() < deadline:
        sources = request(f"/api/courses/{course_id}/sources")
        source = next(item for item in sources if item["id"] == source_id)
        if source["status"] == "ready":
            return request(f"/api/sources/{source_id}/evidence")
        if source["status"] == "needs_review":
            raise RuntimeError("展示资料需要人工检查，请先处理解析状态")
        if source["status"] not in {"queued", "running"}:
            if queued:
                raise RuntimeError(f"展示资料解析未完成：{source['status']}")
            request(f"/api/sources/{source_id}/parse", method="POST")
            queued = True
        time.sleep(0.25)
    raise TimeoutError("展示资料解析超时，请确认 worker 已随 npm run dev 启动")


def find_evidence(evidence: list[dict], keyword: str) -> str:
    matches = [block for block in evidence if keyword in block["text"]]
    if len(matches) != 1:
        raise RuntimeError(f"证据定位失败：{keyword!r}，匹配数为 {len(matches)}")
    return matches[0]["id"]


def main() -> None:
    request("/api/health")
    questions = json.loads(QUESTIONS_PATH.read_text(encoding="utf-8"))
    existing = next((course for course in request("/api/courses") if course["name"] == COURSE_NAME), None)
    if existing:
        course_id = existing["id"]
        prepared = request(f"/api/courses/{course_id}/questions")
        verified_stems = {item["stem"] for item in prepared if item["status"] == "verified"}
        if all(item["stem"] in verified_stems for item in questions):
            print(json.dumps({"status": "already_prepared", "course_id": course_id, "questions": len(prepared)}, ensure_ascii=False))
            return
        if prepared:
            raise SystemExit(f"课程《{COURSE_NAME}》已有部分题目，请设置 EXAM_ENGINE_DEMO_COURSE 使用新名称。")
    else:
        course = request("/api/courses", {
            "school": "华中科技大学",
            "name": COURSE_NAME,
            "exam_date": "2027-01-12",
        })
        course_id = course["id"]

    sources = request(f"/api/courses/{course_id}/sources")
    source = next((item for item in sources if item["original_name"] == SOURCE_PATH.name), None)
    if source is None:
        source = upload(course_id)["source"]
    evidence = parse_and_wait(course_id, source["id"])

    for item in questions:
        created = request(f"/api/courses/{course_id}/questions", {
            "stem": item["stem"],
            "question_type": item["question_type"],
            "answer": item["answer"],
            "analysis": item["analysis"],
            "knowledge_points": item["knowledge_points"],
            "provenance": "original",
            "origin_year": item["origin_year"],
            "evidence_ids": [find_evidence(evidence, item["evidence_keyword"])],
        })
        request(f"/api/questions/{created['id']}/review", {
            "expected_version": created["version"],
            "change_note": "展示数据已对照课程资料人工核验",
        })

    analytics = request(f"/api/courses/{course_id}/analytics?half_life_years=3")
    completeness = request(f"/api/courses/{course_id}/completeness")
    if analytics["included_original_question_count"] != len(questions):
        raise RuntimeError("展示题库统计与准备题目数量不一致")
    if not completeness["complete"]:
        raise RuntimeError("展示资料仍有完整性缺口")
    print(json.dumps({
        "status": "prepared",
        "course_id": course_id,
        "course_name": COURSE_NAME,
        "sources": completeness["total_sources"],
        "evidence_blocks": completeness["evidence_blocks"],
        "verified_original_questions": analytics["included_original_question_count"],
        "knowledge_points": len(analytics["knowledge_points"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
