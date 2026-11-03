"""Health and request-correlation endpoint tests."""

from app.database import health


def test_liveness_does_not_depend_on_database(client, monkeypatch):
    monkeypatch.setattr(health, "database_is_ready", lambda: False)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_when_database_is_available(client, monkeypatch):
    monkeypatch.setattr(health, "database_is_ready", lambda: True)
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_when_database_is_unavailable(client, monkeypatch):
    monkeypatch.setattr(health, "database_is_ready", lambda: False)
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_api_metadata_and_request_id(client):
    response = client.get("/api/v1/", headers={"X-Request-ID": "test-123"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "test-123"
    assert response.json()["name"] == "Asquii API"


def test_request_id_generated_for_unsafe_input(client):
    response = client.get("/health", headers={"X-Request-ID": "bad value"})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] != "bad\nvalue"
