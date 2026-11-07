"""Synchronous SQLAlchemy engine and request-scoped sessions."""

import json
from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth.dependencies import get_current_user
from app.auth.jwt import CurrentUser
from app.core.config import get_settings

settings = get_settings()
engine: Engine | None = None
SessionLocal: sessionmaker[Session] | None = None
if settings.database_url:
    engine = create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_timeout=settings.database_pool_timeout,
        connect_args={
            "connect_timeout": settings.database_connect_timeout,
            "prepare_threshold": None,
            "options": "-c statement_timeout=5000",
        },
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Session, "after_begin")
def _set_transaction_local_supabase_identity(session, transaction, connection) -> None:
    """Set only verified subject context locally for every request transaction."""

    claims = session.info.get("supabase_jwt_claims")
    if claims is None:
        return
    connection.execute(
        text("SELECT set_config('request.jwt.claims', :claims, true)"),
        {"claims": json.dumps(claims, separators=(",", ":"))},
    )
    connection.execute(
        text("SELECT set_config('request.jwt.claim.sub', :subject, true)"),
        {"subject": claims["sub"]},
    )


def get_db(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> Generator[Session, None, None]:
    """Yield a session and reliably rollback failures and close the session."""

    if SessionLocal is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    session = SessionLocal()
    session.info["supabase_jwt_claims"] = {
        "sub": str(current_user.user_id),
        # Included so RLS helpers can match invitee email on invitation and
        # profile rows; omitted entirely when the token has no email claim.
        **({"email": current_user.email} if current_user.email else {}),
        "role": "authenticated",
        "aud": settings.supabase_jwt_audience,
    }
    try:
        yield session
        if session.in_transaction():
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
