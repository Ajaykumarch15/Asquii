"""Unexpected errors must not expose internals."""

def test_404_response_is_json_and_has_request_id(client):
    response = client.get("/does-not-exist")
    assert response.status_code == 404
    assert response.headers.get("X-Request-ID")
    assert "traceback" not in response.text.lower()
    assert "database_url" not in response.text.lower()


def test_unexpected_error_does_not_expose_exception_text(client):
    @client.app.get("/test-internal-error")
    def raise_internal_error():
        raise RuntimeError("private database password detail")

    response = client.get("/test-internal-error")
    assert response.status_code == 500
    assert "private database password detail" not in response.text
    assert "password" not in response.text.lower()
