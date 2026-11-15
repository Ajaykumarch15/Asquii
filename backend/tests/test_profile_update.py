"""Self-service profile update tests without external Auth or PostgreSQL."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from app.api.routes import auth as auth_routes
from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.auth.service import update_profile
from app.database.session import get_db
from app.main import create_app
from fastapi.testclient import TestClient


def test_update_profile_changes_display_name_and_job_title():
    profile = SimpleNamespace(user_id=uuid4(), display_name="Old Name", job_title=None)
    db = Mock()
    db.get.return_value = profile

    result = update_profile(
        db,
        CurrentUser(profile.user_id, "person@example.com"),
        {"display_name": "New Name", "job_title": "Engineer"},
    )

    assert result is profile
    assert profile.display_name == "New Name"
    assert profile.job_title == "Engineer"
    db.flush.assert_called_once()


def test_update_profile_clears_job_title_only_when_provided():
    profile = SimpleNamespace(user_id=uuid4(), display_name="Name", job_title="Engineer")
    db = Mock()
    db.get.return_value = profile

    update_profile(db, CurrentUser(profile.user_id), {"job_title": None})

    assert profile.job_title is None
    assert profile.display_name == "Name"


def test_update_profile_rejects_blank_display_name():
    profile = SimpleNamespace(user_id=uuid4(), display_name="Name", job_title=None)
    db = Mock()
    db.get.return_value = profile

    with pytest.raises(ValueError):
        update_profile(db, CurrentUser(profile.user_id), {"display_name": "  "})

    assert profile.display_name == "Name"


@pytest.fixture
def profile_app(monkeypatch: pytest.MonkeyPatch):
    app = create_app()
    user = CurrentUser(user_id=uuid4(), email="safe@example.com")
    app.dependency_overrides[get_current_user] = lambda: user

    def fake_get_db():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = fake_get_db

    def fake_update(db, current_user, changes):
        return SimpleNamespace(
            user_id=current_user.user_id,
            display_name=changes.get("display_name", "Safe"),
            job_title=changes.get("job_title"),
        )

    monkeypatch.setattr(auth_routes, "update_profile", fake_update)
    return app, user


def test_patch_auth_me_updates_only_self_service_fields(profile_app):
    app, user = profile_app
    with TestClient(app) as client:
        response = client.patch(
            "/api/v1/auth/me",
            json={"display_name": "Updated Name", "job_title": "Designer"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(user.user_id),
        "email": "safe@example.com",
        "display_name": "Updated Name",
        "job_title": "Designer",
    }
    assert "role" not in response.json()


def test_patch_auth_me_accepts_clearing_the_job_title(profile_app):
    app, _ = profile_app
    with TestClient(app) as client:
        response = client.patch("/api/v1/auth/me", json={"job_title": None})

    assert response.status_code == 200
    assert response.json()["job_title"] is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"display_name": "   "},
        {"display_name": None},
        {"display_name": "x" * 121},
        {"job_title": "x" * 121},
        {"email": "attacker@example.com"},
        {"role": "Owner"},
    ],
)
def test_patch_auth_me_rejects_invalid_or_privileged_fields(profile_app, body):
    app, _ = profile_app
    with TestClient(app) as client:
        response = client.patch("/api/v1/auth/me", json=body)

    assert response.status_code == 422


def test_patch_auth_me_rejects_anonymous_request(client):
    response = client.patch("/api/v1/auth/me", json={"display_name": "Someone"})
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Authentication required"
