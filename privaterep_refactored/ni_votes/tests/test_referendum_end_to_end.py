"""Integration tests covering the referendum training and web pipeline."""

from __future__ import annotations

import json
import math
from dataclasses import asdict
from typing import Tuple

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")
pytest.importorskip("sklearn")

from flask import Flask

from ni_votes.data.ingestion import (
    StructuredElectionData,
    aggregate_nationwide,
    build_area_register,
    build_party_register,
    build_referendum_party_results,
    normalize_election_results,
    normalize_endorsements,
)
from ni_votes.models_referendum import (
    build_referendum_training_real,
    cross_validate_referendums,
    fit_referendum_model,
    prepare_referendum_training_matrices,
)
from ni_votes.training import ReferendumTrainingConfig, train_referendum_pipeline
from ni_votes.simulate.referendum import (
    ReferendumSimulationConfig,
    run_referendum_simulation,
)
from ni_votes.web import routes as web_routes
from ni_votes.web.routes import init_routes
from ni_votes.web.data_access import (
    CFG_ER_DF,
    CFG_ENDORSEMENTS,
    CFG_REFERENDUM_BODIES,
)


pytestmark = pytest.mark.slow


def _build_structured_dataset() -> Tuple[StructuredElectionData, pd.DataFrame, pd.DataFrame]:
    """Return a synthetic election workbook and endorsements frame."""

    raw_rows = [
        {
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "DateStr": "2016-05-05",
            "Constituency": "Alpha",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 600,
            "Electorate": 1500,
        },
        {
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "DateStr": "2016-05-05",
            "Constituency": "Alpha",
            "ResultType": "Candidate",
            "Party Name": "Unionist Party",
            "Votes1": 400,
            "Electorate": 1500,
        },
        {
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "DateStr": "2016-05-05",
            "Constituency": "Beta",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 520,
            "Electorate": 1400,
        },
        {
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "DateStr": "2016-05-05",
            "Constituency": "Beta",
            "ResultType": "Candidate",
            "Party Name": "Unionist Party",
            "Votes1": 480,
            "Electorate": 1400,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "Yes",
            "Votes1": 720,
            "Electorate": 1600,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "No",
            "Votes1": 680,
            "Electorate": 1600,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "Did not vote",
            "Votes1": 160,
            "Electorate": 1600,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Spoiled ballots",
            "Name usually known by": "Spoiled",
            "Votes1": 40,
            "Electorate": 1600,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "Yes",
            "Votes1": 540,
            "Electorate": 1500,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "No",
            "Votes1": 760,
            "Electorate": 1500,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "Did not vote",
            "Votes1": 160,
            "Electorate": 1500,
        },
        {
            "Event": "UnityRef2020",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Spoiled ballots",
            "Name usually known by": "Spoiled",
            "Votes1": 40,
            "Electorate": 1500,
        },
    ]

    raw_er = pd.DataFrame(raw_rows)

    endorsements = pd.DataFrame(
        [
            {
                "Date": pd.Timestamp("2019-12-01"),
                "ElectedBody": "TestRef",
                "Party": "Alliance",
                "EndorsedClean": "Yes",
            },
            {
                "Date": pd.Timestamp("2019-12-01"),
                "ElectedBody": "TestRef",
                "Party": "Unionist Party",
                "EndorsedClean": "No",
            },
        ]
    )

    normalized_results = normalize_election_results(raw_er, source="unit-test")
    constituency_results = normalized_results[
        normalized_results["area_scope"].isin({"constituency", "constituency_group"})
    ].reset_index(drop=True)
    nation_results = aggregate_nationwide(constituency_results).reset_index(drop=True)
    party_register = build_party_register(normalized_results).reset_index(drop=True)
    area_register = build_area_register(normalized_results).reset_index(drop=True)
    normalized_endorsements = normalize_endorsements(endorsements).reset_index(drop=True)
    referendum_party = build_referendum_party_results(
        normalized_results, normalized_endorsements
    ).reset_index(drop=True)

    structured = StructuredElectionData(
        constituency_results=constituency_results,
        nation_results=nation_results,
        endorsements=normalized_endorsements,
        party_register=party_register,
        area_register=area_register,
        referendum_party_results=referendum_party,
        issues=[],
    )

    return structured, raw_er, endorsements


def test_referendum_training_pipeline_end_to_end():
    structured, raw_er, endorsements = _build_structured_dataset()

    training = build_referendum_training_real(structured, endorsements=endorsements)
    assert not training.empty
    assert training.features.shape[0] == 4
    assert set(training.options) == {"Yes", "No", "Did not vote", "Spoiled"}

    matrices = prepare_referendum_training_matrices(training)
    assert matrices["X"].shape == (
        training.features.shape[0],
        len(training.feature_columns),
    )
    assert matrices["Y"].shape == (
        training.targets.shape[0],
        len(training.target_columns),
    )
    assert matrices["weights"].shape == (training.features.shape[0],)

    metrics = cross_validate_referendums(training, folds=2)
    assert math.isfinite(metrics["mean_cross_entropy"])
    assert math.isfinite(metrics["mean_mae"])
    assert metrics["fold_count"] == len(metrics["folds"])

    model, meta = fit_referendum_model(training, random_state=1)
    assert meta["options"] == list(training.options)
    assert set(meta["feat_cols"]) >= {"share_endorsing::Yes", "share_endorsing::No"}
    assert "calibration" in meta

    config = ReferendumSimulationConfig(
        date="2020-06-01",
        body_key="TestRef",
        breakdown_event_type="DevolvedElection",
        breakdown_elected_body="Northern Ireland Assembly",
    )
    result = run_referendum_simulation(raw_er, endorsements, model, meta, config)
    assert len(result.areas) == 3

    ni_area = next(area for area in result.areas if area.constituency == "Northern Ireland")
    assert ni_area.party_breakdown
    metadata = ni_area.party_breakdown.get("metadata", {})
    assert metadata.get("event_type") == "DevolvedElection"
    assert metadata.get("elected_body") == "Northern Ireland Assembly"
    assert metadata.get("families")
    assert metadata.get("non_participant_label") == "Non-voters (baseline)"
    assert metadata.get("non_participant_share") is not None
    assert metadata.get("baseline_turnout_share") is not None
    summary = ni_area.table.get("summary", {})
    assert summary.get("electorate") == ni_area.electorate


def test_training_pipeline_serialises_outputs(tmp_path):
    structured, _, endorsements = _build_structured_dataset()
    config = ReferendumTrainingConfig(
        cv_folds=2,
        calibration_holdout=0.25,
        random_state=4,
        feature_version="test-blueprint",
    )
    model_path = tmp_path / "ref_model.joblib"
    meta_path = tmp_path / "ref_model.meta.json"

    summary = train_referendum_pipeline(
        structured,
        endorsements=endorsements,
        config=config,
        output_model=model_path,
        output_meta=meta_path,
        source_workbook="dummy.xlsx",
    )

    assert summary["rows"] == len(build_referendum_training_real(structured, endorsements).features)
    assert model_path.exists()
    assert meta_path.exists()

    meta = json.loads(meta_path.read_text())
    assert meta["feature_version"] == "test-blueprint"
    assert meta["cv_metrics"]["fold_count"] == 2
    assert meta["training_config"]["cv_folds"] == 2
    assert meta["source_workbook"] == "dummy.xlsx"


def test_api_referendum_simulate_flow(monkeypatch):
    structured, raw_er, endorsements = _build_structured_dataset()
    training = build_referendum_training_real(structured, endorsements=endorsements)
    model, meta = fit_referendum_model(training)

    app = Flask(__name__)
    app.config[CFG_ER_DF] = raw_er
    app.config[CFG_ENDORSEMENTS] = endorsements
    app.config[CFG_REFERENDUM_BODIES] = ["TestRef"]

    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL_ERROR", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META_ERROR", None, raising=False)
    monkeypatch.setattr(web_routes, "_load_referendum_model", lambda: (model, meta))

    init_routes(app)

    payload = {
        "date": "2020-06-01",
        "body": "TestRef",
        "constituencies": ["Alpha", "Beta"],
        "include_northern_ireland_view": True,
        "breakdown_event_type": "DevolvedElection",
        "breakdown_elected_body": "Northern Ireland Assembly",
    }

    with app.test_client() as client:
        response = client.post("/api/referendum_simulate", json=payload)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    result = payload["result"]
    assert result["model_options"] == meta["options"]
    assert len(result["areas"]) == 3

    ni_area = next(area for area in result["areas"] if area["constituency"] == "Northern Ireland")
    breakdown = ni_area["party_breakdown"]
    assert breakdown["parties"]
    meta_block = breakdown.get("metadata", {})
    assert meta_block.get("event_type") == "DevolvedElection"
    assert meta_block.get("elected_body") == "Northern Ireland Assembly"
    assert meta_block.get("families")
    assert meta_block.get("non_participant_label") == "Non-voters (baseline)"
    assert meta_block.get("non_participant_share") is not None
    assert meta_block.get("baseline_turnout_share") is not None
    assert meta_block.get("elections")
    assert ni_area["table"]["summary"]["electorate"] == ni_area["electorate"]

    direct = run_referendum_simulation(
        raw_er,
        endorsements,
        model,
        meta,
        ReferendumSimulationConfig(
            date="2020-06-01",
            body_key="TestRef",
            constituencies=["Alpha", "Beta"],
            include_northern_ireland_view=True,
            breakdown_event_type="DevolvedElection",
            breakdown_elected_body="Northern Ireland Assembly",
        ),
    )
    assert result == asdict(direct)


def test_api_referendum_simulate_handles_array_meta(monkeypatch):
    structured, raw_er, endorsements = _build_structured_dataset()
    training = build_referendum_training_real(structured, endorsements=endorsements)
    model, meta = fit_referendum_model(training)

    app = Flask(__name__)
    app.config[CFG_ER_DF] = raw_er
    app.config[CFG_ENDORSEMENTS] = endorsements
    app.config[CFG_REFERENDUM_BODIES] = ["TestRef"]

    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_MODEL_ERROR", None)
    monkeypatch.setattr(web_routes, "_REFERENDUM_META_ERROR", None, raising=False)
    monkeypatch.setattr(web_routes, "_load_referendum_model", lambda: (model, np.array(["unexpected", "payload"])))

    init_routes(app)

    payload = {
        "date": "2020-06-01",
        "body": "TestRef",
        "constituencies": ["Alpha", "Beta"],
        "include_northern_ireland_view": True,
    }

    with app.test_client() as client:
        response = client.post("/api/referendum_simulate", json=payload)

    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    result = data["result"]
    assert result["model_options"] == list(model.options)

