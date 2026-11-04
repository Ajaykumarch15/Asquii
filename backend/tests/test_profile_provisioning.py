"""Profile provisioning tests without external Auth or PostgreSQL services."""

from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from app.auth.jwt import CurrentUser
from app.auth.service import provision_profile
from sqlalchemy.dialects import postgresql


def test_first_request_provisions_profile_from_verified_identity():
    user_id = uuid4()
    profile = SimpleNamespace(user_id=user_id, display_name="person", job_title=None)
    db = Mock()
    db.get.return_value = None
    db.scalar.return_value = profile

    result = provision_profile(db, CurrentUser(user_id, "person@example.com"))

    assert result is profile
    db.execute.assert_called_once()
    statement = db.execute.call_args.args[0]
    params = statement.compile(dialect=postgresql.dialect()).params
    assert params["display_name"] == "person"
    assert params["user_id"] == user_id


def test_existing_profile_is_returned_without_overwriting_user_edits():
    profile = SimpleNamespace(user_id=uuid4(), display_name="Edited by user", job_title="Engineer")
    db = Mock()
    db.get.return_value = profile

    result = provision_profile(db, CurrentUser(profile.user_id, "new@example.com"))

    assert result.display_name == "Edited by user"
    assert result.job_title == "Engineer"
    db.execute.assert_not_called()
    db.scalar.assert_not_called()


def test_profile_without_email_uses_safe_default():
    user_id = uuid4()
    profile = SimpleNamespace(user_id=user_id, display_name="New user", job_title=None)
    db = Mock()
    db.get.return_value = None
    db.scalar.return_value = profile

    provision_profile(db, CurrentUser(user_id))

    statement = db.execute.call_args.args[0]
    params = statement.compile(dialect=postgresql.dialect()).params
    assert params["display_name"] == "New user"
    assert params["user_id"] == user_id
