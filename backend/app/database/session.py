"""Synchronous SQLAlchemy engine and request-scoped sessions."""

from collections.abc import Generator

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()
engine: Engine | None = None
SessionLocal: sessionmaker[Session] | None = None
if settings.database_url:
    engine = create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        pool_timeout=5,
        connect_args={
            "connect_timeout": 5,
            "prepare_threshold": None,
            "options": "-c statement_timeout=5000",
        },
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a session and reliably rollback failures and close the session."""

    if SessionLocal is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    session = SessionLocal()
    try:
        yield session
        if session.in_transaction():
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
