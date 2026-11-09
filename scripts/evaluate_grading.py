"""Opt-in real grading of fixed, developer-checked tasks in a new isolated DB.

Retains actual prompts and outputs before orchestration can fail. This evaluates
fixed answers, not generated questions, partial credit, or human learning.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    directory = args.data_dir.resolve()
    if not args.live or not (directory / "ISOLATED_ACCEPTANCE").is_file():
        parser.error("--live and an ISOLATED_ACCEPTANCE marker are required")
    if directory == (ROOT / "data").resolve() or (directory / "exam_engine.db").exists():
        parser.error("Use a new isolated directory, never an existing database")
    output = directory / "grading.json"
    if output.exists():
        parser.error("Report exists; do not overwrite paid results")
    fixture = json.loads(args.fixture.read_text(encoding="utf-8-sig"))
    cases = json.loads(args.cases.read_text(encoding="utf-8-sig"))
    if not cases or len({case["id"] for case in cases}) != len(cases):
        parser.error("Cases must be nonempty and unique")
    if sha256(args.source.read_bytes()).hexdigest() != fixture["source_sha256"]:
        parser.error("Original source hash differs")
    if not fixture.get("answer_basis") or not fixture.get("anchor_pages"):
        parser.error("Fixture must have developer-checked answer basis and anchor pages")
    os.environ["EXAM_ENGINE_DATA_DIR"] = str(directory)
    os.environ["DATABASE_URL"] = f"sqlite:///{(directory / 'exam_engine.db').as_posix()}"
    sys.path.insert(0, str(ROOT / "backend"))
    from sqlalchemy import select
    from app.database import Base, SessionLocal, engine
    from app.learning_sessions import read_learning_session, submit_attempt, review_current_attempt
    from app.model_gateway import ModelGateway
    from app.models import Course, Source, DocumentNode, EvidenceBlock, LearningSession, LearningTask, UsageRecord
    from app.parsing import parse_file
    from app.schemas import LearningSessionRead

    gateway = ModelGateway.from_env()
    if gateway.provider.mocked:
        parser.error("A real provider is required")
    report = dict(code_revision=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                  provider=gateway.provider.name, model=gateway.provider.model, fixture=fixture,
                  cases_sha256=sha256(args.cases.read_bytes()).hexdigest(),
                  file_hashes={name: sha256((ROOT / name).read_bytes()).hexdigest() for name in
                               ["scripts/evaluate_grading.py", "backend/app/learning_sessions.py", "backend/app/learning.py", "backend/app/schemas.py"]},
                  limits="Developer-checked task promoted only in isolated fixture; fixed scripted answers, not human mastery or full product ingestion.", cases=[], calls=[])

    def save():
        temporary = output.with_suffix(".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        temporary.replace(output)

    original_generate = gateway.generate_json

    def recorded_generate(db, course_id, purpose, system_prompt, user_prompt, output_type, **kwargs):
        call = dict(purpose=purpose, system=system_prompt, user=user_prompt, schema=output_type.model_json_schema(), options=kwargs)
        report["calls"].append(call); save()
        try:
            result, usage = original_generate(db, course_id, purpose, system_prompt, user_prompt,
                                              output_type, **kwargs, single_attempt=True)
            call.update(reply=result.model_dump(), usage_id=usage.id, tokens=usage.total_tokens)
            save()
            return result, usage
        except Exception as error:
            call["error"] = str(error); save(); raise

    gateway.generate_json = recorded_generate
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        course = Course(name="正式评分固定题隔离验收", school="开发验收")
        db.add(course); db.flush()
        source = Source(course_id=course.id, original_name=args.source.name, storage_key="fixture.pdf", extension=".pdf",
                        media_type="application/pdf", size_bytes=args.source.stat().st_size,
                        sha256=fixture["source_sha256"], status="ready", material_type="assignment")
        db.add(source); db.flush()
        (directory / "uploads").mkdir(exist_ok=True)
        shutil.copy2(args.source, directory / "uploads" / source.storage_key)
        parsed = parse_file(source.id, args.source, ".pdf")
        if parsed.status != "ready":
            parser.error("Deterministic source extraction must be ready")
        for node in parsed.nodes:
            db.add(DocumentNode(id=node.id, source_id=source.id, title=node.title, ordinal=node.ordinal,
                                page_start=node.page_start, page_end=node.page_end))
        db.flush()
        for block in parsed.blocks:
            db.add(EvidenceBlock(id=block.id, source_id=source.id, node_id=block.node_id, ordinal=block.ordinal,
                                 text=block.text, page_number=block.page_number, content_hash=block.content_hash))
        anchors = [b.id for b in parsed.blocks if b.page_number in fixture["anchor_pages"]]
        if set(fixture["anchor_pages"]) - {b.page_number for b in parsed.blocks}:
            parser.error("Anchor pages are missing")
        report["evidence"] = [dict(id=b.id, page=b.page_number, text=b.text) for b in parsed.blocks if b.id in anchors]
        db.commit(); save()
        for case in cases:
            session = LearningSession(course_id=course.id, stage="diagnosing", knowledge_mode="course_specific")
            db.add(session); db.flush()
            fields = dict(fixture["task"])
            fields.update(validation_status="validated", validation_notes=["Isolated developer-checked grading fixture only; not course-holder confirmation."])
            task = LearningTask(session_id=session.id, kind="diagnostic", ordinal=1, status="current", evidence_ids=anchors, **fields)
            db.add(task); db.flush(); session.current_task_id = task.id; db.commit()
            entry = dict(case, session_id=session.id, task_id=task.id)
            report["cases"].append(entry); save()
            try:
                current = read_learning_session(db, session.id)
                result = submit_attempt(db, session.id, case["answer"], 0, gateway, task.id, current["progress_version"])
                entry["graded"] = LearningSessionRead.model_validate(result).model_dump(mode="json")
                entry["matches_expected"] = result["current_task"]["latest_attempt"]["verdict"] == case["expected"]
                save()
                if case.get("review_reason"):
                    attempt = result["current_task"]["latest_attempt"]
                    entry["reviewed"] = review_current_attempt(db, session.id, attempt["id"], case["review_reason"], gateway)
            except Exception as error:
                entry["error"] = str(error)
            finally:
                entry["restored"] = read_learning_session(db, session.id)
                report["usage"] = [dict(id=u.id, purpose=u.purpose, status=u.status, tokens=u.total_tokens, error=u.error)
                                   for u in db.scalars(select(UsageRecord))]
                save()
    print(json.dumps(dict(output=str(output), cases=len(report["cases"]), mismatches=[c["id"] for c in report["cases"] if not c.get("matches_expected")]), ensure_ascii=False))


if __name__ == "__main__":
    main()
