"""Course-bound PDF reader snapshots; no tutoring or model side effects."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pypdf import PdfReader
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .dependencies import get_db
from .models import Course, ReaderSnapshot, Source

PREVIEW_VERSION = "pdfjs-6.5.438-normalized-v1"


class SnapshotWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    snapshot: dict


def finite(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def validate_snapshot(s, source, pages):
    def require(condition):
        if not condition:
            raise ValueError("笔记格式、页码或坐标无效")

    def region(r):
        require(isinstance(r, dict))
        require(all(finite(r.get(k), 0, 1) for k in ("x", "y")))
        require(all(finite(r.get(k), .00000001, 1) for k in ("width", "height")))
        require(r["x"] + r["width"] <= 1.000001 and r["y"] + r["height"] <= 1.000001)

    def anchor(a):
        require(isinstance(a, dict) and a.get("documentId") == source.sha256 and a.get("previewVersion") == PREVIEW_VERSION)
        require(type(a.get("page")) is int and 1 <= a["page"] <= len(pages))
        require(a.get("space") == "normalized-top-left" and a.get("precision") in ("text", "region", "page"))
        require(isinstance(a.get("regions"), list) and len(a["regions"]) <= 1000)
        require(a["precision"] == "page" or len(a["regions"]) > 0)
        require(isinstance(a.get("text", ""), str) and len(a.get("text", "")) <= 100000)
        for r in a["regions"]:
            region(r)

    try:
        require(len(json.dumps(s, ensure_ascii=False, allow_nan=False).encode()) <= 5 * 1024 * 1024)
        require(type(s.get("schema")) is int and s["schema"] == 1)
        d = s["document"]
        require(d["id"] == source.sha256 and d["previewVersion"] == PREVIEW_VERSION)
        require(d["originalFormat"] == "pdf" and d["previewFormat"] == "pdf")
        require(isinstance(d["name"], str) and len(d["name"]) <= 500)
        require(len(d["pages"]) == len(pages))
        for actual, expected in zip(d["pages"], pages):
            require(all(finite(actual.get(k), .01, 100000) and abs(actual[k] - expected[k]) < .1 for k in ("width", "height")))
        r = s["reader"]
        require(isinstance(s.get("savedAt"), str) and len(s["savedAt"]) <= 100)
        require(type(r["page"]) is int and 1 <= r["page"] <= len(pages))
        require(r["zoom"] in ("fit", "page") or finite(r["zoom"], .1, 4))
        require(all(finite(r["scroll"][k], 0, 10000000) for k in ("x", "y")))
        require(type(r["panelOpen"]) is bool and isinstance(r["draft"], str) and len(r["draft"]) <= 100000)
        for key in ("selection", "context"):
            if r[key] is not None:
                anchor(r[key])
        require(isinstance(s["annotations"], list) and len(s["annotations"]) <= 5000)
        ids = set()
        for a in s["annotations"]:
            require(isinstance(a.get("id"), str) and 0 < len(a["id"]) <= 100 and a["id"] not in ids and a.get("schema") == 1)
            ids.add(a["id"]); anchor(a["anchor"])
            require(isinstance(a.get("updatedAt"), str) and len(a["updatedAt"]) <= 100)
            require(a.get("kind") in ("ink", "highlight", "note"))
            if a["kind"] != "note" or "color" in a:
                require(isinstance(a.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", a["color"]) is not None)
            if a["kind"] == "note":
                require(isinstance(a.get("text"), str) and len(a["text"]) <= 100000)
                require("collapsed" not in a or type(a["collapsed"]) is bool)
            elif a["kind"] == "ink":
                require(type(a.get("width")) in (int, float) and a["width"] in (1, 2, 4, 8))
                require(isinstance(a.get("points"), list) and 0 < len(a["points"]) <= 100000)
                for p in a["points"]:
                    require(all(finite(p.get(k), 0, 1) for k in ("x", "y")))
        return s
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError) as e:
        raise HTTPException(422, detail="笔记数据无效或与原件版本不匹配；服务器旧记录未改动") from e


def create_reader_router(upload_dir: Path):
    router = APIRouter(prefix="/api/courses/{course_id}", tags=["reader"])

    @router.get("/reading-summaries")
    def summaries(course_id: str, db: Session = Depends(get_db)):
        course = db.get(Course, course_id)
        if not course:
            raise HTTPException(404, detail="课程不存在")
        # Project metadata only: no annotation bodies, original reads, or writes.
        snap = ReaderSnapshot.snapshot
        rows = db.execute(select(
            Source.id, Source.original_name, Source.sha256, ReaderSnapshot.preview_version,
            ReaderSnapshot.revision, ReaderSnapshot.updated_at,
            snap["schema"].as_integer(), snap["document"]["id"].as_string(),
            snap["document"]["previewVersion"].as_string(), snap["reader"]["page"].as_integer(),
            func.json_array_length(snap["document"]["pages"]),
        ).join(ReaderSnapshot, ReaderSnapshot.source_id == Source.id).where(
            Source.course_id == course_id, Source.removed_at.is_(None),
            func.lower(Source.extension).in_([".pdf", "pdf"]),
            ReaderSnapshot.source_sha256 == Source.sha256,
            ReaderSnapshot.preview_version == PREVIEW_VERSION,
            ReaderSnapshot.revision > 0,
        ).order_by(ReaderSnapshot.updated_at.desc(), Source.id).limit(100)).all()
        items = []
        for sid, name, digest, preview, revision, updated, schema, docid, version, page, pages in rows:
            if schema != 1 or docid != digest or version != PREVIEW_VERSION or type(page) is not int or not pages or not 1 <= page <= pages:
                continue
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            items.append({"sourceId": sid, "name": name, "sha256": digest, "previewVersion": preview,
                          "page": page, "revision": revision, "updatedAt": updated, "readOnly": course.archived_at is not None})
            if len(items) == 20:
                break
        return {"courseId": course_id, "items": items}

    def document(course_id, source_id, db):
        course, source = db.get(Course, course_id), db.get(Source, source_id)
        if not course or not source or source.course_id != course_id or source.removed_at is not None:
            raise HTTPException(404, detail="课程资料不存在或已移除，旧笔记仍保留")
        if source.extension.lower().lstrip(".") != "pdf":
            raise HTTPException(415, detail="课程阅读目前仅支持PDF；PPTX请人工导出PDF后作为新资料导入")
        file = (upload_dir / source.storage_key).resolve()
        if not file.is_relative_to(upload_dir.resolve()) or not file.is_file():
            raise HTTPException(410, detail="原件缺失，请恢复原件后重试")
        if sha256(file.read_bytes()).hexdigest() != source.sha256:
            raise HTTPException(409, detail="原件内容与登记版本不符，已停止读取和保存")
        try:
            pdf = PdfReader(file)
            pages = []
            for page in pdf.pages:
                # PDF.js uses the intersection of CropBox and MediaBox.
                a, b = page.cropbox, page.mediabox
                w = float(min(a.right, b.right) - max(a.left, b.left))
                h = float(min(a.top, b.top) - max(a.bottom, b.bottom))
                if w <= 0 or h <= 0:
                    w, h = float(b.width), float(b.height)
                unit = float(page.get("/UserUnit", 1))
                w, h = w * unit, h * unit
                if page.rotation % 180:
                    w, h = h, w
                pages.append({"width": w, "height": h})
            if not pages:
                raise ValueError()
        except Exception as e:
            raise HTTPException(422, detail="PDF无法读取；未覆盖已有笔记") from e
        return course, source, pages

    def row_for(db, source_id):
        return db.scalar(select(ReaderSnapshot).where(ReaderSnapshot.source_id == source_id, ReaderSnapshot.preview_version == PREVIEW_VERSION))

    def output(row):
        return {"revision": row.revision if row else 0, "snapshot": row.snapshot if row else None}

    @router.get("/sources/{source_id}/reader")
    def read(course_id: str, source_id: str, db: Session = Depends(get_db)):
        course, source, pages = document(course_id, source_id, db)
        return {"courseId": course.id, "courseName": course.name, "sourceId": source.id, "sha256": source.sha256,
                "name": source.original_name, "previewVersion": PREVIEW_VERSION, "pages": pages,
                "readOnly": course.archived_at is not None, **output(row_for(db, source_id))}

    @router.put("/sources/{source_id}/reader")
    def save(course_id: str, source_id: str, payload: SnapshotWrite, db: Session = Depends(get_db)):
        course, source, pages = document(course_id, source_id, db)
        if course.archived_at is not None:
            raise HTTPException(409, detail="课程已归档；请恢复课程后保存，当前内容可导出")
        snapshot = validate_snapshot(payload.snapshot, source, pages)
        row = row_for(db, source_id)
        if row and row.source_sha256 != source.sha256:
            raise HTTPException(409, detail="笔记所属原件已变化，禁止自动迁移")
        if row and row.revision == payload.revision and row.snapshot == snapshot:
            return output(row)
        # A lost response may be retried with the old revision; identical content is idempotent.
        if row and row.revision == payload.revision + 1 and row.snapshot == snapshot:
            return output(row)
        if row:
            changed = db.execute(update(ReaderSnapshot).where(ReaderSnapshot.id == row.id, ReaderSnapshot.revision == payload.revision).values(
                revision=payload.revision + 1, snapshot=snapshot, updated_at=datetime.now(timezone.utc)))
            if changed.rowcount != 1:
                db.rollback()
                raise HTTPException(409, detail="其他窗口已更新笔记；当前内容保留，请先导出，再重新载入服务器版本")
        elif payload.revision != 0:
            raise HTTPException(409, detail="服务器版本已变化，请导出当前内容后重新载入")
        else:
            db.add(ReaderSnapshot(source_id=source_id, source_sha256=source.sha256, preview_version=PREVIEW_VERSION, revision=1, snapshot=snapshot))
        try:
            db.commit()
        except IntegrityError as e:
            db.rollback()
            raise HTTPException(409, detail="其他窗口已建立笔记；请先导出再重新载入") from e
        db.expire_all()
        return output(row_for(db, source_id))

    return router
