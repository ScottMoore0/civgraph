from flask import Flask

from ni_votes.web.data_access import init_data
from ni_votes.web.routes import init_routes


def _assert_no_invalid_tokens(value):
    if isinstance(value, dict):
        for inner in value.values():
            _assert_no_invalid_tokens(inner)
        return
    if isinstance(value, list):
        for inner in value:
            _assert_no_invalid_tokens(inner)
        return
    if isinstance(value, str):
        token = value.strip().casefold()
        assert token not in {"nan", "infinity", "-infinity", "inf", "-inf"}


def test_forum_regional_listing_returns_clean_json():
    app = Flask(__name__)
    init_data(app)
    init_routes(app)

    client = app.test_client()
    response = client.get(
        "/api/search_elections",
        query_string={
            "body": "Northern Ireland Forum for Political Dialogue",
            "constituency": "Northern Ireland",
            "limit": 10,
            "order": "desc",
        },
    )

    assert response.status_code == 200
    assert response.is_json

    data = response.get_json()
    assert data["ok"] is True
    assert data["count"] >= 1

    _assert_no_invalid_tokens(data)
