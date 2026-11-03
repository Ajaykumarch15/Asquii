"""Shared isolated test fixtures."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """Create a test client with no external database dependency."""

    monkeypatch.setenv("APP_ENV", "test")
    with TestClient(create_app()) as test_client:
        yield test_client
