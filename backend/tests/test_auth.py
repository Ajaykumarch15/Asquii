"""Cryptographic token and HTTP authentication behavior tests."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from app.auth.dependencies import get_current_user
from app.auth.jwt import (
    CurrentUser,
    JWKSUnavailableError,
    SupabaseJWTVerifier,
    TokenVerificationError,
)
from app.core.config import Settings
from app.main import create_app
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def signing_setup():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key()))
    public_jwk.update({"kid": "key-1", "alg": "RS256", "use": "sig"})
    settings = Settings(_env_file=None, supabase_url="https://project.supabase.co")
    verifier = SupabaseJWTVerifier(settings)
    verifier._fetch_jwks = lambda: {"keys": [public_jwk]}
    return verifier, private_pem, settings


def _token(private_key, settings, **claim_overrides):
    now = datetime.now(UTC)
    claims = {
        "sub": str(uuid4()),
        "iss": "https://project.supabase.co/auth/v1",
        "aud": "authenticated",
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "email": "person@example.com",
        "role": "authenticated",
        "user_metadata": {"role": "Owner"},
    }
    claims.update(claim_overrides)
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "key-1"})


def test_valid_token_yields_only_verified_identity(signing_setup):
    verifier, private_key, settings = signing_setup

    user = verifier.verify(_token(private_key, settings))

    assert isinstance(user, CurrentUser)
    assert user.email == "person@example.com"
    assert isinstance(user.user_id, type(uuid4()))
    assert not hasattr(user, "role")


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": datetime.now(UTC) - timedelta(minutes=1)},
        {"nbf": datetime.now(UTC) + timedelta(minutes=5)},
        {"iss": "https://attacker.example"},
        {"aud": "other"},
        {"sub": "not-a-uuid"},
        {"email": {"unsafe": "value"}},
    ],
)
def test_invalid_required_or_typed_claims_are_rejected(signing_setup, claims):
    verifier, private_key, settings = signing_setup

    with pytest.raises(TokenVerificationError):
        verifier.verify(_token(private_key, settings, **claims))


def test_wrong_signature_and_unknown_kid_are_rejected(signing_setup):
    verifier, _, settings = signing_setup
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = other_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    token = _token(pem, settings)
    with pytest.raises(TokenVerificationError):
        verifier.verify(token)

    unknown = jwt.encode(
        {
            "sub": str(uuid4()),
            "iss": "https://project.supabase.co/auth/v1",
            "aud": "authenticated",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        pem,
        algorithm="RS256",
        headers={"kid": "unknown"},
    )
    with pytest.raises(TokenVerificationError):
        verifier.verify(unknown)


def test_jwks_outage_fails_closed(signing_setup):
    verifier, private_key, settings = signing_setup

    def unavailable():
        raise JWKSUnavailableError("private endpoint detail")

    verifier._fetch_jwks = unavailable
    with pytest.raises(JWKSUnavailableError):
        verifier.verify(_token(private_key, settings))


def test_legacy_hs256_requires_explicit_configuration():
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_jwt_signing_method="hs256",
        supabase_jwt_secret="a-long-test-only-secret-value",
    )
    verifier = SupabaseJWTVerifier(settings)
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(uuid4()),
            "iss": "https://project.supabase.co/auth/v1",
            "aud": "authenticated",
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        "a-long-test-only-secret-value",
        algorithm="HS256",
    )
    assert verifier.verify(token).user_id


def test_missing_or_malformed_bearer_is_401():
    for header in (None, "Basic abc", "Bearer "):
        with pytest.raises(HTTPException) as error:
            get_current_user(header)
        assert error.value.status_code == 401


def test_auth_me_requires_identity_and_returns_safe_profile(monkeypatch):
    app = create_app()
    user = CurrentUser(user_id=uuid4(), email="safe@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    profile = SimpleNamespace(user_id=uuid4(), display_name="Safe", job_title=None)
    profile.user_id = user.user_id
    fake_db = SimpleNamespace(get=lambda *_: profile)

    def fake_get_db():
        yield fake_db

    from app.database.session import get_db

    app.dependency_overrides[get_db] = fake_get_db
    with TestClient(app) as client:
        response = client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(profile.user_id),
        "email": "safe@example.com",
        "display_name": "Safe",
        "job_title": None,
    }
    assert "role" not in response.json()


def test_auth_me_rejects_anonymous_request(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Authentication required"


def test_invalid_token_error_is_sanitized(monkeypatch):
    from app.auth import dependencies

    class InvalidVerifier:
        def verify(self, token):
            raise TokenVerificationError("private key parse detail")

    monkeypatch.setattr(dependencies, "get_jwt_verifier", lambda: InvalidVerifier())
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid"})

    assert response.status_code == 401
    assert "private key parse detail" not in response.text
    assert "invalid or expired access token" in response.text.lower()
