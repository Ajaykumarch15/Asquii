"""FastAPI dependencies for verified Supabase identities."""

from functools import lru_cache

from fastapi import Header, HTTPException

from app.auth.jwt import (
    CurrentUser,
    JWKSUnavailableError,
    SupabaseJWTVerifier,
    TokenVerificationError,
)
from app.core.config import get_settings


@lru_cache
def get_jwt_verifier() -> SupabaseJWTVerifier:
    """Share a bounded JWKS cache for the lifetime of the process."""

    return SupabaseJWTVerifier(get_settings())


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    """Require and cryptographically verify an Authorization Bearer access token."""

    unauthorized = HTTPException(
        status_code=401,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization:
        raise unauthorized
    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        raise unauthorized
    try:
        return get_jwt_verifier().verify(token.strip())
    except TokenVerificationError as exc:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except JWKSUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        ) from exc
