"""Run the real development command, verify upload/queue flows, then stop and clean up."""

from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
from urllib.request import Request, urlopen
from uuid import uuid4

from docx import Document
from pptx import Presentation
from pptx.util import Inches


ROOT = Path(__file__).resolve().parents[1]
COURSE_ID = None
SOURCE_ID = None


def request(url: str, payload: dict | None = None, method: str | None = None, timeout: float = 10) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
    with urlopen(req, timeout=timeout) as response:
        return json.load(response)


def upload(url: str, content: bytes, filename: str = "smoke.md", media_type: str = "text/markdown") -> dict:
    boundary = f"----ExamEngine{uuid4().hex}"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"rights_confirmed\"\r\n\r\ntrue\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {media_type}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def office_samples() -> tuple[bytes, bytes]:
    document = Document()
    document.add_heading("冒烟验收章节", level=1)
    document.add_paragraph("DOCX 原文证据。")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "考点"
    table.cell(0, 1).text = "页码"
    docx_buffer = BytesIO()
    document.save(docx_buffer)

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text = "PPTX 原文证据。"
    presentation.slides.add_slide(presentation.slide_layouts[6])
    pptx_buffer = BytesIO()
    presentation.save(pptx_buffer)
    return docx_buffer.getvalue(), pptx_buffer.getvalue()


def parse_and_wait(source_id: str, expected_status: str) -> list[dict]:
    task = request(f"http://127.0.0.1:8000/api/sources/{source_id}/parse", method="POST")
    assert task["status"] == "queued"
    deadline = time.monotonic() + 20
    source = None
    while time.monotonic() < deadline:
        try:
            sources = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/sources")
            source = next(item for item in sources if item["id"] == source_id)
            if source["status"] in {"ready", "needs_review", "failed"}:
                break
        except (TimeoutError, StopIteration):
            pass
        time.sleep(0.25)
    else:
        raise TimeoutError(f"资料 {source_id} 解析超时，最后状态：{source}")
    assert source["status"] == expected_status, source
    return request(f"http://127.0.0.1:8000/api/sources/{source_id}/evidence")


process = subprocess.Popen(
    ["npm.cmd", "run", "dev", "--", "--host", "127.0.0.1", "--port", "7100"],
    cwd=ROOT,
    stdout=None,
    stderr=None,
)
try:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            health = request("http://127.0.0.1:7100/api/health")
            break
        except Exception:
            if process.poll() is not None:
                raise RuntimeError(f"开发服务提前退出，代码 {process.returncode}")
            time.sleep(0.5)
    else:
        raise TimeoutError("开发服务未在 45 秒内就绪")

    with urlopen("http://127.0.0.1:7100/", timeout=3) as response:
        assert response.status == 200
        assert "期末急救引擎" in response.read().decode()

    course = request("http://127.0.0.1:8000/api/courses", {
        "school": "冒烟测试学校",
        "name": "临时验收课程",
        "exam_date": "2027-01-12",
    })
    COURSE_ID = course["id"]
    assert any(item["id"] == COURSE_ID for item in request("http://127.0.0.1:8000/api/courses"))

    uploaded = upload(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/sources", b"# Smoke evidence\n")
    SOURCE_ID = uploaded["source"]["id"]
    assert uploaded["source"]["status"] == "uploaded"
    duplicate = upload(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/sources", b"# Smoke evidence\n")
    assert duplicate["deduplicated"] and duplicate["source"]["id"] == SOURCE_ID
    evidence = parse_and_wait(SOURCE_ID, "ready")
    assert len(evidence) == 1 and "Smoke evidence" in evidence[0]["text"]
    single = request(f"http://127.0.0.1:8000/api/evidence/{evidence[0]['id']}")
    assert single["id"] == evidence[0]["id"]
    explanation = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/agent/explain", {
        "evidence_id": evidence[0]["id"],
        "focus": "冒烟验收",
    })
    assert explanation["mocked"] is True and explanation["evidence_id"] == evidence[0]["id"]
    assert explanation["summary"].startswith("Mock 讲解")
    solution = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/agent/solve", {
        "question": "Smoke evidence 的核心内容是什么？",
    })
    assert solution["mocked"] is True and "Smoke evidence" in solution["answer"]
    assert len(solution["steps"]) == 3 and solution["knowledge_points"]
    assert solution["citations"][0]["evidence_id"] == evidence[0]["id"]
    assert solution["citations"][0]["source_id"] == SOURCE_ID
    question_input = {
        "stem": solution["question"],
        "question_type": "short_answer",
        "answer": solution["answer"],
        "analysis": solution["analysis"],
        "knowledge_points": solution["knowledge_points"],
        "provenance": "original",
        "origin_year": 2026,
        "evidence_ids": [evidence[0]["id"]],
    }
    question = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/questions", question_input)
    assert question["status"] == "draft" and question["version"] == 1
    assert question["citations"][0]["evidence_id"] == evidence[0]["id"]
    edited_question = request(f"http://127.0.0.1:8000/api/questions/{question['id']}", {
        **question_input,
        "answer": f"{question['answer']}（人工校题补充）",
        "expected_version": 1,
        "change_note": "真实启动校题验收",
    }, method="PUT")
    assert edited_question["version"] == 2 and edited_question["status"] == "draft"
    reviewed_question = request(f"http://127.0.0.1:8000/api/questions/{question['id']}/review", {
        "expected_version": 2,
        "change_note": "已核对课程证据",
    })
    assert reviewed_question["status"] == "verified" and reviewed_question["version"] == 3
    revisions = request(f"http://127.0.0.1:8000/api/questions/{question['id']}/revisions")
    assert [item["version"] for item in revisions] == [3, 2, 1]
    assert len(request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/questions")) == 1
    knowledge_points = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/knowledge-points")
    assert len(knowledge_points) == len(solution["knowledge_points"])
    assert {item["name"] for item in knowledge_points} == set(solution["knowledge_points"])
    analytics = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/analytics?half_life_years=3")
    assert analytics["included_original_question_count"] == 1
    assert analytics["verified_question_count"] == 1 and analytics["draft_question_count"] == 0
    assert analytics["adapted_question_count"] == 0 and analytics["unknown_year_question_count"] == 0
    assert sum(item["question_count"] for item in analytics["question_types"]) == 1
    short_answer = next(item for item in analytics["question_types"] if item["question_type"] == "short_answer")
    assert short_answer["question_count"] == 1 and short_answer["share"] == 1.0
    expected_frequency = round(sum(
        item["question_count"] * 2 ** (-max(0, analytics["as_of_year"] - item["year"]) / 3)
        for point in analytics["knowledge_points"] for item in point["yearly_contributions"]
    ), 6)
    actual_frequency = round(sum(point["weighted_frequency"] for point in analytics["knowledge_points"]), 6)
    assert actual_frequency == expected_frequency
    assert all(point["questions"] and point["questions"][0]["id"] == question["id"] for point in analytics["knowledge_points"])
    usage = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/usage")
    assert usage["course_used_tokens"] > 0 and len(usage["records"]) == 2
    assert {record["purpose"] for record in usage["records"]} == {"evidence_explanation", "question_solving"}
    assert {record["id"] for record in usage["records"]} == {explanation["usage_id"], solution["usage_id"]}

    docx_content, pptx_content = office_samples()
    docx = upload(
        f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/sources",
        docx_content,
        "smoke.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )["source"]
    docx_evidence = parse_and_wait(docx["id"], "ready")
    docx_text = "\n".join(block["text"] for block in docx_evidence)
    assert "DOCX 原文证据。" in docx_text and "考点\t页码" in docx_text
    assert docx_evidence[0]["node_title"] == "冒烟验收章节"

    pptx = upload(
        f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/sources",
        pptx_content,
        "smoke.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )["source"]
    pptx_evidence = parse_and_wait(pptx["id"], "needs_review")
    assert len(pptx_evidence) == 1 and pptx_evidence[0]["page_number"] == 1
    assert "PPTX 原文证据。" in pptx_evidence[0]["text"]

    report = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/completeness")
    assert report["total_sources"] == 3 and report["ready_sources"] == 2
    assert report["attention_sources"] == 1 and report["empty_nodes"] == 1
    assert report["complete"] is False
    assert any(issue["source_id"] == pptx["id"] and issue["code"] == "empty_node" for issue in report["issues"])

    github_status = "skipped"
    if os.getenv("EXAM_ENGINE_SMOKE_GITHUB") == "1":
        github_url = "https://github.com/github/gitignore"
        github_preview = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/github/preview", {
            "url": github_url,
            "ref": None,
            "path": "",
        })
        assert github_preview["files"] and len(github_preview["files"]) <= 20
        github_import = request(f"http://127.0.0.1:8000/api/courses/{COURSE_ID}/github/import", {
            "url": github_url,
            "ref": None,
            "path": "",
            "expected_commit_sha": github_preview["commit_sha"],
            "rights_confirmed": True,
        }, timeout=120)
        assert github_import["failures"] == []
        assert github_import["imported_count"] == len(github_preview["files"])
        github_source = github_import["results"][0]["source"]
        assert github_source["origins"][0]["repository"] == "github/gitignore"
        assert github_source["origins"][0]["commit_sha"] == github_preview["commit_sha"]
        parse_and_wait(github_source["id"], "ready")
        github_status = "ok"

    print(json.dumps({
        "web": "ok", "api": health["status"], "database": health["database"],
        "course_crud": "ok", "source_upload": "ok", "deduplication": "ok",
        "parse_queue": "ok", "worker": "ok", "evidence": "ok", "agent_mock": "ok", "agent_solve": "ok", "usage": "ok",
        "question_bank": "ok", "human_review": "ok", "revision_history": "ok",
        "fixed_knowledge_table": "ok", "course_analytics": "ok",
        "docx": "ok", "pptx": "ok", "course_completeness": "ok", "github": github_status,
    }, ensure_ascii=False))
finally:
    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    if COURSE_ID:
        with sqlite3.connect(ROOT / "data" / "exam_engine.db") as connection:
            keys = [row[0] for row in connection.execute("SELECT storage_key FROM sources WHERE course_id = ?", (COURSE_ID,))]
            connection.execute("DELETE FROM question_revisions WHERE question_id IN (SELECT id FROM questions WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM question_evidence WHERE question_id IN (SELECT id FROM questions WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM question_knowledge_points WHERE question_id IN (SELECT id FROM questions WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM questions WHERE course_id = ?", (COURSE_ID,))
            connection.execute("DELETE FROM knowledge_points WHERE course_id = ?", (COURSE_ID,))
            connection.execute("DELETE FROM evidence_blocks WHERE source_id IN (SELECT id FROM sources WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM document_nodes WHERE source_id IN (SELECT id FROM sources WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM parse_tasks WHERE source_id IN (SELECT id FROM sources WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM source_origins WHERE source_id IN (SELECT id FROM sources WHERE course_id = ?)", (COURSE_ID,))
            connection.execute("DELETE FROM sources WHERE course_id = ?", (COURSE_ID,))
            connection.execute("DELETE FROM usage_records WHERE course_id = ?", (COURSE_ID,))
            connection.execute("DELETE FROM courses WHERE id = ?", (COURSE_ID,))
        for key in keys:
            (ROOT / "data" / "uploads" / key).unlink(missing_ok=True)
