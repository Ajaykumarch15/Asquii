"""Database session lifecycle tests with isolated fake sessions."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from app.auth.jwt import CurrentUser
from app.database import session
from fastapi import HTTPException


def _verified_user() -> CurrentUser:
    return CurrentUser(uuid4(), "person@example.com")


def test_missing_database_fails_safely(monkeypatch):
    monkeypatch.setattr(session, "SessionLocal", None)
    with pytest.raises(HTTPException) as error:
        next(session.get_db(_verified_user()))
    assert error.value.status_code == 503
    assert "DATABASE_URL" not in str(error.value.detail)


def test_session_commits_and_closes(monkeypatch):
    fake = MagicMock()
    fake.info = {}
    fake.in_transaction.return_value = True
    monkeypatch.setattr(session, "SessionLocal", lambda: fake)
    user = _verified_user()
    generator = session.get_db(user)
    assert next(generator) is fake
    assert fake.info["supabase_jwt_claims"] == {
        "sub": str(user.user_id),
        "email": user.email,
        "role": "authenticated",
        "aud": session.settings.supabase_jwt_audience,
    }
    with pytest.raises(StopIteration):
        next(generator)
    fake.commit.assert_called_once()
    fake.close.assert_called_once()


def test_session_rolls_back_on_error(monkeypatch):
    fake = MagicMock()
    fake.info = {}
    monkeypatch.setattr(session, "SessionLocal", lambda: fake)
    generator = session.get_db(_verified_user())
    next(generator)
    with pytest.raises(RuntimeError):
        generator.throw(RuntimeError("private database detail"))
    fake.rollback.assert_called_once()
    fake.close.assert_called_once()
