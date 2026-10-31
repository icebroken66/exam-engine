from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "sqlite"


def test_create_and_retrieve_course(client: TestClient) -> None:
    created = client.post(
        "/api/courses",
        json={"school": "  华中科技大学  ", "name": " 操作系统原理 ", "exam_date": "2027-01-12"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["school"] == "华中科技大学"
    assert body["name"] == "操作系统原理"

    listed = client.get("/api/courses")
    assert listed.status_code == 200
    assert [course["id"] for course in listed.json()] == [body["id"]]

    retrieved = client.get(f"/api/courses/{body['id']}")
    assert retrieved.status_code == 200
    assert retrieved.json()["exam_date"] == "2027-01-12"


def test_reject_short_course_name(client: TestClient) -> None:
    response = client.post("/api/courses", json={"school": "华中科技大学", "name": " "})
    assert response.status_code == 422


def test_missing_course_is_404(client: TestClient) -> None:
    assert client.get("/api/courses/not-found").status_code == 404
