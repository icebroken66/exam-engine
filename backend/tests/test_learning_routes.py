"""Learning route contracts, stable override keys, and isolated startup recovery."""
import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import database, dependencies, learning_routes, main
from app.model_gateway import ModelGateway, MockProvider
from app.models import TutoringTurn


def test_learning_route_matrix_is_preserved_and_registered_once():
    expected = json.loads(Path(__file__).with_name("learning_route_contract.json").read_text(encoding="utf-8"))
    app = main.create_app()
    actual = []
    for path, item in app.openapi()["paths"].items():
        for method, operation in item.items():
            if isinstance(operation, dict) and "learning" in operation.get("tags", []):
                actual.append([method.upper(), path, operation["operationId"]])
    assert sorted(actual) == sorted(expected)
    assert len(actual) == 15
    assert all(route.endpoint.__module__ == "app.learning_routes" for route in learning_routes.router.routes)
    # Calling the factory again must not accumulate routes on the shared router.
    assert main.create_app().openapi() == app.openapi()


def test_existing_database_and_gateway_override_keys_are_identical(client):
    assert main.get_db is dependencies.get_db is database.get_db
    assert main.get_model_gateway is dependencies.get_model_gateway is learning_routes.get_model_gateway
    gateway = ModelGateway(MockProvider())
    calls = []
    def override_gateway():
        calls.append(True)
        return gateway
    client.app.dependency_overrides[main.get_model_gateway] = override_gateway
    # Resolve both dependencies through the extracted router, using legacy keys.
    response = client.get("/api/courses/missing/learning-context")
    assert response.status_code == 404
    assert response.json() == {"detail": "课程不存在"}
    assert calls == [True]
    # A non-learning route uses the very same override key.
    response = client.get("/api/courses/missing/usage")
    assert response.status_code == 404
    assert calls == [True, True]


def test_lifespan_recovers_running_turn_in_isolated_database(session_factory, tmp_path, monkeypatch):
    engine = session_factory.kw["bind"]
    with session_factory() as db:
        turn = TutoringTurn(session_id="fixture-session", task_id="fixture-task", request_id="fixture-request",
                            sequence=1, student_message="fixture", progress_version="fixture", status="running")
        db.add(turn)
        db.commit()
        turn_id = turn.id
    migrations = []
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "SessionLocal", session_factory)
    monkeypatch.setattr(main, "migrate_schema", lambda: migrations.append(True))
    upload_dir = tmp_path / "isolated-uploads"
    app = main.create_app(storage_dir=upload_dir)
    def override_db():
        with session_factory() as db:
            yield db
    app.dependency_overrides[dependencies.get_db] = override_db
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        response = client.options("/api/courses", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert upload_dir.is_dir()
    assert migrations == [True]
    with session_factory() as db:
        turn = db.get(TutoringTurn, turn_id)
        assert turn.status == "failed"
        assert "服务重启中断" in turn.error
        assert turn.reply == {}
        assert len(list(db.scalars(select(TutoringTurn)))) == 1
