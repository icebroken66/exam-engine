from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_database_url


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if get_database_url().startswith("sqlite") else {}
engine = create_engine(get_database_url(), connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def migrate_schema() -> None:
    inspector = inspect(engine)
    additions = {
        "courses": [
            ("scope_text", "TEXT NOT NULL DEFAULT ''"),
            ("scope_source", "VARCHAR(24) NOT NULL DEFAULT ''"),
            ("scope_signature", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("scope_topics", "JSON NOT NULL DEFAULT '[]'"),
            ("archived_at", "DATETIME"),
        ],
        "sources": [
            ("import_batch_id", "VARCHAR(36)"),
            ("relative_path", "VARCHAR(1000) NOT NULL DEFAULT ''"),
            ("material_type", "VARCHAR(24) NOT NULL DEFAULT 'other'"),
            ("material_confidence", "FLOAT NOT NULL DEFAULT 0"),
            ("material_rationale", "TEXT NOT NULL DEFAULT '尚未识别资料类型'"),
            ("processing_note", "TEXT NOT NULL DEFAULT ''"),
        ],
        "questions": [
            ("source_id", "VARCHAR(36)"),
            ("extraction_key", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("options", "JSON NOT NULL DEFAULT '[]'"),
            ("answer_provenance", "VARCHAR(24) NOT NULL DEFAULT 'source'"),
            ("extraction_confidence", "FLOAT NOT NULL DEFAULT 1"),
            ("extraction_issues", "JSON NOT NULL DEFAULT '[]'"),
        ],
        "learning_sessions": [
            ("knowledge_mode", "VARCHAR(24) NOT NULL DEFAULT 'general'"),
            ("scope_text", "TEXT NOT NULL DEFAULT ''"),
            ("diagnostic_signature", "VARCHAR(64) NOT NULL DEFAULT ''"),
        ],
        "learning_tasks": [
            ("origin_question_id", "VARCHAR(36)"),
            ("answer_provenance", "VARCHAR(24) NOT NULL DEFAULT 'source'"),
            ("remediation_answer", "TEXT"),
            ("source_track", "VARCHAR(24) NOT NULL DEFAULT 'course'"),
            ("visible_limitation", "TEXT NOT NULL DEFAULT ''"),
            ("sub_skill", "VARCHAR(300) NOT NULL DEFAULT ''"),
            ("cognitive_level", "VARCHAR(24) NOT NULL DEFAULT 'understand'"),
            ("difficulty_prior", "VARCHAR(24) NOT NULL DEFAULT 'basic'"),
            ("rubric", "JSON NOT NULL DEFAULT '[]'"),
            ("prerequisites", "JSON NOT NULL DEFAULT '[]'"),
            ("validation_status", "VARCHAR(24) NOT NULL DEFAULT 'draft'"),
            ("validation_confidence", "FLOAT"),
            ("validation_notes", "JSON NOT NULL DEFAULT '[]'"),
            ("evidence_version", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("decision_reason", "TEXT NOT NULL DEFAULT ''"),
        ],
        "learning_point_states": [
            ("evidence_confidence", "VARCHAR(16) NOT NULL DEFAULT 'low'"),
            ("hint_dependent", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("no_progress_rounds", "INTEGER NOT NULL DEFAULT 0"),
        ],
    }
    with engine.begin() as connection:
        for table, columns in additions.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns:
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
        if inspector.has_table("courses"):
            connection.execute(text(
                "UPDATE courses SET scope_source = 'user' "
                "WHERE scope_source = '' AND TRIM(scope_text) <> ''"
            ))
        if inspector.has_table("learning_tasks"):
            connection.execute(text(
                "UPDATE learning_tasks SET remediation_answer = reference_answer WHERE remediation_answer IS NULL"
            ))


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
