"""Validated application settings."""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings loaded from environment variables and an optional .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        enable_decoding=False,
    )

    app_name: str = "Asquii API"
    app_env: Literal["development", "test", "staging", "production"] = "development"
    app_version: str = "0.1.0"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    database_url: SecretStr | None = None
    database_migrate_url: SecretStr | None = None
    database_pool_size: int = Field(default=3, ge=1, le=20)
    database_max_overflow: int = Field(default=2, ge=0, le=20)
    database_pool_timeout: int = Field(default=5, ge=1, le=60)
    database_connect_timeout: int = Field(default=5, ge=1, le=60)
    supabase_url: str | None = None
    supabase_anon_key: SecretStr | None = None
    supabase_jwt_issuer: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwks_url: str | None = None
    supabase_jwt_signing_method: Literal["jwks", "hs256"] = "jwks"
    supabase_jwt_secret: SecretStr | None = None
    supabase_jwt_jwks_cache_seconds: int = Field(default=300, ge=30, le=3600)
    cors_origins: list[str] = Field(default_factory=list)
    log_level: str = "INFO"

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr | None) -> SecretStr | None:
        return cls._normalize_postgres_url(value, "DATABASE_URL")

    @field_validator("database_migrate_url")
    @classmethod
    def validate_database_migrate_url(cls, value: SecretStr | None) -> SecretStr | None:
        return cls._normalize_postgres_url(value, "DATABASE_MIGRATE_URL")

    @staticmethod
    def _normalize_postgres_url(value: SecretStr | None, setting: str) -> SecretStr | None:
        if value is None:
            return value
        url = value.get_secret_value()
        parsed = urlsplit(url)
        if parsed.scheme not in {"postgresql", "postgresql+psycopg"} or not parsed.hostname:
            raise ValueError(f"{setting} must be a PostgreSQL URL using psycopg")
        if parsed.scheme == "postgresql":
            value = SecretStr(url.replace("postgresql://", "postgresql+psycopg://", 1))
        return value

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, value: str | None) -> str | None:
        if value is not None and urlsplit(value).scheme not in {"http", "https"}:
            raise ValueError("SUPABASE_URL must be an HTTP(S) URL")
        return value

    @field_validator("supabase_jwks_url")
    @classmethod
    def validate_jwks_url(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.hostname:
                raise ValueError("SUPABASE_JWKS_URL must be an HTTPS URL")
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError("LOG_LEVEL must be a standard logging level")
        return normalized

    @field_validator("api_v1_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        if not value.startswith("/") or value.endswith("/"):
            raise ValueError("API_V1_PREFIX must start with / and must not end with /")
        return value

    @model_validator(mode="after")
    def require_production_settings(self) -> "Settings":
        if self.app_env in {"staging", "production"}:
            missing = []
            if self.database_url is None:
                missing.append("DATABASE_URL")
            if not self.supabase_url:
                missing.append("SUPABASE_URL")
            if self.supabase_anon_key is None:
                missing.append("SUPABASE_ANON_KEY")
            if not self.cors_origins:
                missing.append("CORS_ORIGINS")
            if missing:
                raise ValueError("Missing required deployment settings: " + ", ".join(missing))
        if self.supabase_jwt_signing_method == "hs256" and self.supabase_jwt_secret is None:
            raise ValueError("SUPABASE_JWT_SECRET is required for HS256 signing")
        if self.supabase_jwks_url and self.supabase_url:
            if urlsplit(self.supabase_jwks_url).hostname != urlsplit(self.supabase_url).hostname:
                raise ValueError("SUPABASE_JWKS_URL must use the configured Supabase host")
        return self


@lru_cache
def get_settings() -> Settings:
    """Return cached process settings."""

    return Settings()
