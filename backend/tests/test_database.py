"""Database session lifecycle tests with isolated fake sessions."""

from unittest.mock import Mock

import pytest
from app.database import session
from fastapi import HTTPException


def test_missing_database_fails_safely(monkeypatch):
    monkeypatch.setattr(session, "SessionLocal", None)
    with pytest.raises(HTTPException) as error:
        next(session.get_db())
    assert error.value.status_code == 503
    assert "DATABASE_URL" not in str(error.value.detail)


def test_session_commits_and_closes(monkeypatch):
    fake = Mock()
    fake.in_transaction.return_value = True
    monkeypatch.setattr(session, "SessionLocal", lambda: fake)
    generator = session.get_db()
    assert next(generator) is fake
    with pytest.raises(StopIteration):
        next(generator)
    fake.commit.assert_called_once()
    fake.close.assert_called_once()


def test_session_rolls_back_on_error(monkeypatch):
    fake = Mock()
    monkeypatch.setattr(session, "SessionLocal", lambda: fake)
    generator = session.get_db()
    next(generator)
    with pytest.raises(RuntimeError):
        generator.throw(RuntimeError("private database detail"))
    fake.rollback.assert_called_once()
    fake.close.assert_called_once()
