"""Fail-closed verification of Supabase-issued access tokens."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import UUID

import jwt
from jwt import PyJWK

from app.core.config import Settings

ASYMMETRIC_ALGORITHMS = ("ES256", "RS256")
JWKS_PATH = "/auth/v1/.well-known/jwks.json"
UNKNOWN_TOKEN_MESSAGE = "Invalid or expired access token"


class TokenVerificationError(Exception):
    """A token failed validation without exposing sensitive parsing details."""


class JWKSUnavailableError(Exception):
    """The configured Supabase key endpoint could not be reached safely."""


@dataclass(frozen=True)
class CurrentUser:
    """Identity derived only from successfully verified JWT claims."""

    user_id: UUID
    email: str | None = None


class SupabaseJWTVerifier:
    """Verify a fixed Supabase issuer using bounded-cached JWKS or explicit HS256."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._keys: dict[str, dict[str, Any]] = {}
        self._cached_at = 0.0
        self._last_refresh_at = 0.0
        self._lock = threading.Lock()

    @property
    def issuer(self) -> str:
        if self.settings.supabase_jwt_issuer:
            return self.settings.supabase_jwt_issuer.rstrip("/")
        if self.settings.supabase_url:
            return f"{self.settings.supabase_url.rstrip('/')}/auth/v1"
        raise JWKSUnavailableError("Supabase issuer is not configured")

    @property
    def jwks_url(self) -> str:
        if self.settings.supabase_jwks_url:
            return self.settings.supabase_jwks_url
        if self.settings.supabase_url:
            return f"{self.settings.supabase_url.rstrip('/')}{JWKS_PATH}"
        raise JWKSUnavailableError("Supabase JWKS endpoint is not configured")

    def _fetch_jwks(self) -> dict[str, Any]:
        request = Request(self.jwks_url, headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=3) as response:  # noqa: S310 - URL is server config
                if response.status != 200:
                    raise JWKSUnavailableError("Supabase signing keys are unavailable")
                payload = json.loads(response.read(262_145))
        except (OSError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise JWKSUnavailableError("Supabase signing keys are unavailable") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("keys"), list):
            raise JWKSUnavailableError("Supabase signing keys are unavailable")
        return payload

    def _key_for(self, kid: str, algorithm: str) -> Any:
        now = time.monotonic()
        ttl = self.settings.supabase_jwt_jwks_cache_seconds
        with self._lock:
            has_keys = bool(self._keys)
            cache_fresh = has_keys and now - self._cached_at < ttl
            expired = has_keys and not cache_fresh
            unknown = kid not in self._keys
            refresh_allowed = self._last_refresh_at == 0 or now - self._last_refresh_at >= 30
            should_refresh = refresh_allowed and (
                not has_keys or expired or (unknown and cache_fresh)
            )
            if should_refresh:
                # Throttle failed refreshes too, so an outage or unknown-kid flood
                # cannot make every request perform another network fetch.
                self._last_refresh_at = now
                try:
                    jwks = self._fetch_jwks()
                except JWKSUnavailableError:
                    if not cache_fresh:
                        raise
                    # A still-fresh cache remains usable during a transient refresh failure.
                else:
                    keys = {
                        item["kid"]: item
                        for item in jwks["keys"]
                        if isinstance(item, dict)
                        and isinstance(item.get("kid"), str)
                        and item.get("use", "sig") == "sig"
                        and item.get("alg", algorithm) in ASYMMETRIC_ALGORITHMS
                    }
                    if not keys:
                        raise JWKSUnavailableError("Supabase signing keys are unavailable")
                    self._keys = keys
                    self._cached_at = now
                    cache_fresh = True
                    expired = False
                    unknown = kid not in self._keys
            if not cache_fresh:
                raise JWKSUnavailableError("Supabase signing keys are unavailable")
            jwk = self._keys.get(kid)
            if jwk is None or jwk.get("alg", algorithm) != algorithm:
                raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE)
            try:
                return PyJWK.from_dict(jwk, algorithm=algorithm).key
            except (jwt.PyJWTError, ValueError, TypeError) as exc:
                raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE) from exc

    def verify(self, token: str) -> CurrentUser:
        """Validate signature and required claims, returning a minimal user context."""

        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE) from exc

        algorithm = header.get("alg")
        kid = header.get("kid")
        if self.settings.supabase_jwt_signing_method == "hs256":
            if algorithm != "HS256" or not self.settings.supabase_jwt_secret:
                raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE)
            key = self.settings.supabase_jwt_secret.get_secret_value()
            allowed_algorithms = ["HS256"]
        else:
            if algorithm not in ASYMMETRIC_ALGORITHMS or not isinstance(kid, str) or not kid:
                raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE)
            key = self._key_for(kid, algorithm)
            allowed_algorithms = [algorithm]

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=allowed_algorithms,
                audience=self.settings.supabase_jwt_audience,
                issuer=self.issuer,
                options={"require": ["exp", "sub", "iss", "aud"]},
            )
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE) from exc

        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or (email is not None and not isinstance(email, str)):
            raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE)
        try:
            user_id = UUID(subject)
        except ValueError as exc:
            raise TokenVerificationError(UNKNOWN_TOKEN_MESSAGE) from exc
        return CurrentUser(user_id=user_id, email=email)
