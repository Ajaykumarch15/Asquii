"""Focused activity response-safety tests."""

from app.activities.service import _safe_metadata


def test_activity_metadata_removes_private_values_recursively() -> None:
    metadata = {
        "role": "Admin",
        "token_hash": "should-not-appear",
        "fields": ["title", "description"],
        "summary": {
            "email": "person@example.com",
            "comment_body": "private comment",
            "changed": True,
        },
    }

    assert _safe_metadata(metadata) == {
        "role": "Admin",
        "fields": ["title", "description"],
        "summary": {"changed": True},
    }


def test_activity_metadata_preserves_structured_safe_values() -> None:
    metadata = {"from_role": "Member", "to_role": "Admin", "count": 2}

    assert _safe_metadata(metadata) == metadata
