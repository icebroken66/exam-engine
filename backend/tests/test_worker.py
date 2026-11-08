from io import BytesIO
import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.learning_sessions import prepare_course_context
from app.model_gateway import ModelGateway, MockProvider, ProviderReply, TokenUsage, VisionImage
from app.models import DocumentNode, EvidenceBlock, ParseTask, Question, Source, UsageRecord
from app.worker import recover_interrupted_tasks, run_next_task
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
    assert source["processing_stage"] == "ready"
    assert source["processing_started_at"] is not None
    assert source["processing_finished_at"] is not None
    assert source["processing_duration_seconds"] >= 0
    evidence = client.get(f"/api/sources/{source_id}/evidence")
    assert evidence.status_code == 200
    assert evidence.json()[0]["node_title"] == "Chapter"
    single = client.get(f"/api/evidence/{evidence.json()[0]['id']}")
    assert single.status_code == 200
    assert single.json()["text"].startswith("# Chapter")
    nodes_response = client.get(f"/api/sources/{source_id}/nodes")
    assert nodes_response.json()[0]["title"] == "Chapter"


def png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (640, 480), "white").save(output, format="PNG")
    return output.getvalue()


class VisionProvider(MockProvider):
    def complete_with_images(
        self, system_prompt: str, user_prompt: str, images: list[VisionImage], max_tokens: int,
    ) -> ProviderReply:
        assert images and images[0].media_type == "image/jpeg"
        return ProviderReply(json.dumps({
            "text": "第一章 并发控制\n两段锁协议要求事务在释放锁后不能再获得新锁。",
            "confidence": 0.72,
            "issues": ["示例公式有遮挡"],
        }, ensure_ascii=False), TokenUsage(100, 40))


def test_image_transcription_requires_confirmation_before_learning(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=png_bytes(), name="scanned.png").json()["source"]["id"]
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(VisionProvider()))
        task = db.scalar(select(ParseTask).where(ParseTask.source_id == source_id))
        assert task is not None and task.status == "needs_transcription_review"
        assert not db.scalars(select(Question).where(Question.source_id == source_id)).all()
        assert prepare_course_context(db, course_id, None)["can_start"] is False

    source = client.get(f"/api/courses/{course_id}/sources").json()[0]
    assert source["status"] == "needs_transcription_review"
    assert "0.72" in source["processing_note"] and "遮挡" in source["processing_note"]
    evidence = client.get(f"/api/sources/{source_id}/evidence").json()
    assert "两段锁协议" in evidence[0]["text"] and evidence[0]["page_number"] == 1
    original = client.get(f"/api/sources/{source_id}/file?inline=true")
    assert original.status_code == 200 and original.headers["content-disposition"].startswith("inline")
    confirmed = client.post(f"/api/sources/{source_id}/transcription-review")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "ready"
    assert client.get(f"/api/courses/{course_id}/learning-context").json()["can_start"] is True


def test_scanned_pdf_page_is_transcribed_without_becoming_an_original_question(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    pdf = tmp_path / "scanned.pdf"
    canvas = Canvas(str(pdf))
    canvas.drawImage(ImageReader(BytesIO(png_bytes())), 0, 0, width=640, height=480)
    canvas.save()
    course_id = create_course(client)
    source_id = upload(client, course_id, content=pdf.read_bytes(), name="scanned.pdf").json()["source"]["id"]
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(VisionProvider()))
        source = db.get(Source, source_id)
        assert source is not None and source.status == "needs_transcription_review"
        blocks = list(db.scalars(select(EvidenceBlock).where(EvidenceBlock.source_id == source_id)).all())
        assert len(blocks) == 1 and blocks[0].page_number == 1
        assert not db.scalars(select(Question).where(Question.source_id == source_id)).all()
    assert "source_vision_transcription" in {
        item["purpose"] for item in client.get(f"/api/courses/{course_id}/usage").json()["records"]
    }


def test_worker_recovers_interrupted_task(client: TestClient, session_factory: sessionmaker, tmp_path: Path) -> None:
    course_id = create_course(client)
    source_id = upload(client, course_id, content=b"# Recovery\n\nEvidence.").json()["source"]["id"]
    client.post(f"/api/sources/{source_id}/parse")
    with session_factory() as db:
        task = db.scalar(select(ParseTask).where(ParseTask.source_id == source_id))
        source = db.get(Source, source_id)
        task.status = "running"
        source.status = "running"
        usage = UsageRecord(
            course_id=course_id, purpose="exam_question_extraction", provider="test",
            model="test-model", status="running", reserved_tokens=100,
        )
        db.add(usage)
        db.commit()
        assert recover_interrupted_tasks(db) == 1
        assert task.status == "queued"
        assert source.status == "queued"
        assert source.processing_stage == "queued"
        assert usage.status == "failed"
        assert usage.reserved_tokens == 0
        assert "服务重启" in usage.error
        assert run_next_task(db, tmp_path / "uploads")
        assert task.status == "ready"


def test_worker_classifies_material_and_user_can_correct_it(
    client: TestClient, session_factory: sessionmaker, tmp_path: Path,
) -> None:
    course_id = create_course(client, "数据库基础")
    source_id = upload(
        client, course_id,
        content="# 2024 年期末试卷\n\n一、简述数据模型的三要素。\n二、根据关系模式写出查询。".encode(),
        name="2024数据库往年真题.md",
    ).json()["source"]["id"]
    with session_factory() as db:
        assert run_next_task(db, tmp_path / "uploads", ModelGateway(MockProvider()))
    source = client.get(f"/api/courses/{course_id}/sources").json()[0]
    assert source["material_type"] == "past_exam"
    assert source["material_confidence"] == 0.9
    assert "source_material_classification" in {
        item["purpose"] for item in client.get(f"/api/courses/{course_id}/usage").json()["records"]
    }

    corrected = client.patch(f"/api/sources/{source_id}/material", json={"material_type": "assignment"})
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["material_type"] == "assignment"
    assert corrected.json()["material_confidence"] == 1
    assert corrected.json()["material_rationale"] == "用户已确认资料类型"
