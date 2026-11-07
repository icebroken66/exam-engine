from sqlalchemy import create_engine, inspect, text

import app.config as config
import app.database as database


def test_relative_data_dir_is_anchored_to_project_root(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(config, "PROJECT_ROOT", tmp_path)
    monkeypatch.setenv("EXAM_ENGINE_DATA_DIR", "data/isolated")
    config.get_data_dir.cache_clear()
    try:
        assert config.get_data_dir() == (tmp_path / "data/isolated").resolve()
    finally:
        config.get_data_dir.cache_clear()


def test_migrate_schema_adds_learning_fields_and_is_idempotent(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    monkeypatch.setattr(database, "engine", engine)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE courses (id VARCHAR(36) PRIMARY KEY, name VARCHAR(160), scope_text TEXT NOT NULL DEFAULT '')"
        ))
        connection.execute(text(
            "CREATE TABLE learning_sessions (id VARCHAR(36) PRIMARY KEY, course_id VARCHAR(36), stage VARCHAR(24))"
        ))
        connection.execute(text(
            "CREATE TABLE sources (id VARCHAR(36) PRIMARY KEY, original_name VARCHAR(180))"
        ))
        connection.execute(text(
            "CREATE TABLE learning_tasks ("
            "id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36), reference_answer TEXT)"
        ))
        connection.execute(text(
            "CREATE TABLE learning_point_states ("
            "id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36), knowledge_point VARCHAR(120), "
            "status VARCHAR(24), score FLOAT, evidence_count INTEGER)"
        ))
        connection.execute(text(
            "INSERT INTO learning_tasks (id, session_id, reference_answer) VALUES ('task-1', 'session-1', '原答案')"
        ))
        connection.execute(text(
            "INSERT INTO courses (id, name, scope_text) VALUES ('course-1', '旧课程', '旧范围')"
        ))

    database.migrate_schema()
    database.migrate_schema()

    inspector = inspect(engine)
    assert {"scope_text", "scope_source", "scope_signature", "scope_topics", "archived_at"} <= {
        column["name"] for column in inspector.get_columns("courses")
    }
    assert {"knowledge_mode", "scope_text", "diagnostic_signature"} <= {
        column["name"] for column in inspector.get_columns("learning_sessions")
    }
    assert {"material_type", "material_confidence", "material_rationale"} <= {
        column["name"] for column in inspector.get_columns("sources")
    }
    assert {"sub_skill", "cognitive_level", "difficulty_prior", "source_track", "visible_limitation"} <= {
        column["name"] for column in inspector.get_columns("learning_tasks")
    }
    assert {"evidence_confidence", "hint_dependent", "no_progress_rounds"} <= {
        column["name"] for column in inspector.get_columns("learning_point_states")
    }
    with engine.connect() as connection:
        remediation_answer = connection.scalar(
            text("SELECT remediation_answer FROM learning_tasks WHERE id = 'task-1'")
        )
        scope_source = connection.scalar(text("SELECT scope_source FROM courses WHERE id = 'course-1'"))
    assert remediation_answer == "原答案"
    assert scope_source == "user"
