"""Unit checks for transaction-local verified Supabase claim propagation."""

from app.database.session import _set_transaction_local_supabase_identity


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []

    def execute(self, statement, params):
        self.calls.append((str(statement), params))


class FakeSession:
    def __init__(self, claims=None) -> None:
        self.info = {} if claims is None else {"supabase_jwt_claims": claims}


def test_verified_subject_is_set_transaction_locally() -> None:
    session = FakeSession({"sub": "a5e9fac1-12a7-4a67-a254-e6eac25b6e59", "role": "authenticated"})
    connection = FakeConnection()

    _set_transaction_local_supabase_identity(session, None, connection)

    assert len(connection.calls) == 2
    assert "set_config('request.jwt.claims'" in connection.calls[0][0]
    assert connection.calls[0][1]["claims"] == (
        '{"sub":"a5e9fac1-12a7-4a67-a254-e6eac25b6e59","role":"authenticated"}'
    )
    assert "set_config('request.jwt.claim.sub'" in connection.calls[1][0]
    assert connection.calls[1][1]["subject"] == "a5e9fac1-12a7-4a67-a254-e6eac25b6e59"


def test_session_without_verified_identity_sets_no_database_claims() -> None:
    connection = FakeConnection()

    _set_transaction_local_supabase_identity(FakeSession(), None, connection)

    assert connection.calls == []
