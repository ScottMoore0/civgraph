from __future__ import annotations

from dataclasses import asdict

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")

from flask import Flask

from ni_votes.simulate.referendum import (
    ReferendumSimulationConfig,
    run_referendum_simulation,
)
from ni_votes.web import routes as web_routes
from ni_votes.web.routes import init_routes
from ni_votes.web.data_access import (
    CFG_CONSTS,
    CFG_ENDORSEMENTS,
    CFG_ER_DF,
    CFG_ELECTED_BODIES,
    CFG_ELECTION_TYPES,
    CFG_IMPORT_KEYS,
    CFG_PARTY_METADATA,
    CFG_REFERENDUM_BODIES,
)

from ni_votes.tests.test_referendum_simulator import (
    DummyReferendumModel,
    _default_meta,
    _make_election_results,
    _make_endorsements,
)


def _build_test_app(monkeypatch):
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])

    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL_ERROR", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META_ERROR", None)
    monkeypatch.setattr(web_routes, "_load_referendum_model", lambda: (model, meta))

    app = Flask(__name__)
    app.config[CFG_ER_DF] = er
    app.config[CFG_ENDORSEMENTS] = endorsements
    app.config[CFG_CONSTS] = ["Alpha", "Beta"]
    app.config[CFG_IMPORT_KEYS] = []
    app.config[CFG_REFERENDUM_BODIES] = [{"key": "TestRef", "name": "TestRef"}]
    app.config[CFG_ELECTION_TYPES] = ["DevolvedElection"]
    app.config[CFG_ELECTED_BODIES] = ["Northern Ireland Assembly"]
    app.config[CFG_PARTY_METADATA] = []

    init_routes(app)
    return app, er, endorsements, model, meta


def test_referendum_api_matches_simulation(monkeypatch):
    app, er, endorsements, model, meta = _build_test_app(monkeypatch)

    direct_config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        breakdown_event_type="DevolvedElection",
        breakdown_elected_body="Northern Ireland Assembly",
    )
    expected = run_referendum_simulation(er, endorsements, model, meta, direct_config)

    payload = {
        "date": "2020-01-15",
        "body": "TestRef",
        "include_northern_ireland_view": True,
        "breakdown_event_type": "DevolvedElection",
        "breakdown_elected_body": "Northern Ireland Assembly",
    }

    with app.test_client() as client:
        resp = client.post("/api/referendum_simulate", json=payload)

    assert resp.status_code == 200
    data = resp.get_json(force=True)
    assert data.get("ok") is True

    api_result = data.get("result")
    assert api_result, "API did not return referendum result payload"

    expected_dict = asdict(expected)
    assert api_result == expected_dict
