"""Configuration validation tests."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_development_defaults_are_safe():
    settings = Settings(_env_file=None)
    assert settings.app_env == "development"
    assert settings.database_url is None
    assert settings.cors_origins == []


def test_production_requires_deployment_configuration():
    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(_env_file=None, app_env="production")


def test_database_url_must_be_postgres():
    with pytest.raises(ValidationError, match="PostgreSQL URL"):
        Settings(_env_file=None, database_url="sqlite:///test.db")


def test_comma_separated_origins_are_supported():
    settings = Settings(_env_file=None, cors_origins="https://one.example, https://two.example")
    assert settings.cors_origins == ["https://one.example", "https://two.example"]
