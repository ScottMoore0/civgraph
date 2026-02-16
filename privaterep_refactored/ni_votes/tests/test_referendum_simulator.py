import math
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")

from ni_votes.simulate.referendum import (
    ReferendumSimulationConfig,
    run_referendum_simulation,
)
from ni_votes.project.referendum import project_referendum
from ni_votes.models import load_referendum_model_and_meta
from ni_votes.data_loading import load_election_results, load_endorsements

WORKBOOK_PATH = Path("ni_votes/Full election tables.xlsx")


class DummyReferendumModel:
    def __init__(self, options):
        self.options = options

    def predict_proba_rows(self, Xnew: np.ndarray) -> np.ndarray:
        n_opts = len(self.options)
        if n_opts == 3:
            return np.array([[0.55, 0.35, 0.10]], dtype=float)
        if n_opts == 4:
            return np.array([[0.50, 0.30, 0.10, 0.10]], dtype=float)
        raise AssertionError("Dummy model expects either three or four options.")


class FeatureAwareDummyReferendumModel:
    """Return probabilities that mirror endorsement share features."""

    def __init__(self, options, feat_cols):
        self.options = options
        self.feat_cols = list(feat_cols)

    def predict_proba_rows(self, Xnew: np.ndarray) -> np.ndarray:
        yes_idx = self.feat_cols.index("share_endorsing::Yes")
        no_idx = self.feat_cols.index("share_endorsing::No")
        yes = Xnew[:, yes_idx].astype(float)
        no = Xnew[:, no_idx].astype(float)
        remaining = np.clip(1.0 - yes - no, 0.0, None)
        probs = np.stack([yes, no, remaining], axis=1)
        row_sums = probs.sum(axis=1, keepdims=True)
        # Guard against zero rows to avoid division warnings in the simulator.
        row_sums[row_sums == 0.0] = 1.0
        return probs / row_sums


def _make_election_results():
    stv_rows = [
        {
            "Event": "DevolvedElection",
            "DateStr": "2019-05-02",
            "Constituency": "Alpha",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 600,
        },
        {
            "Event": "DevolvedElection",
            "DateStr": "2019-05-02",
            "Constituency": "Alpha",
            "ResultType": "Candidate",
            "Party Name": "UUP",
            "Votes1": 400,
        },
        {
            "Event": "DevolvedElection",
            "DateStr": "2019-05-02",
            "Constituency": "Beta",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 500,
        },
        {
            "Event": "DevolvedElection",
            "DateStr": "2019-05-02",
            "Constituency": "Beta",
            "ResultType": "Candidate",
            "Party Name": "UUP",
            "Votes1": 500,
        },
    ]

    ref_rows = [
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "Yes",
            "Votes1": 900,
            "Electorate": 2000,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "No",
            "Votes1": 800,
            "Electorate": 2000,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Votes",
            "Name usually known by": "Did not vote",
            "Votes1": 250,
            "Electorate": 2000,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Alpha",
            "ResultType": "Spoiled ballots",
            "Name usually known by": "Spoiled",
            "Votes1": 50,
            "Electorate": 2000,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "Yes",
            "Votes1": 720,
            "Electorate": 1800,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "No",
            "Votes1": 880,
            "Electorate": 1800,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Votes",
            "Name usually known by": "Did not vote",
            "Votes1": 160,
            "Electorate": 1800,
        },
        {
            "Event": "TestRef",
            "EventType": "Referendum",
            "ElectedBody": "TestRef",
            "DateStr": "2020-01-01",
            "Constituency": "Beta",
            "ResultType": "Spoiled ballots",
            "Name usually known by": "Spoiled",
            "Votes1": 40,
            "Electorate": 1800,
        },
    ]

    return pd.DataFrame(stv_rows + ref_rows)


def _make_endorsements():
    return pd.DataFrame(
        [
            {
                "Date": pd.Timestamp("2020-01-01"),
                "ElectedBody": "TestRef",
                "Party": "Alliance",
                "EndorsedClean": "Yes",
            },
            {
                "Date": pd.Timestamp("2020-01-01"),
                "ElectedBody": "TestRef",
                "Party": "UUP",
                "EndorsedClean": "No",
            },
        ]
    )


def _default_meta():
    options = ["Yes", "No", "Did not vote"]
    feat_cols = [f"share_endorsing::{opt}" for opt in options] + ["share_no_endorsement", "turnout_prior"]
    return {"options": options, "feat_cols": feat_cols, "bundle_version": 2}


def _option_map(area):
    return {opt.option: opt for opt in area.options}


def _table_map(area):
    table = area.table or {}
    rows = table.get("rows") or []
    mapping = {}
    for row in rows:
        option = row.get("option")
        if option:
            mapping[str(option)] = row
    return mapping


def _get_area(result, constituency):
    for area in result.areas:
        if area.constituency == constituency:
            return area
    raise AssertionError(f"Area for {constituency!r} not found")


def test_predefined_referendum_simulation_returns_national_view():
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])

    config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        breakdown_event_type="DevolvedElection",
        breakdown_elected_body="Northern Ireland Assembly",
    )
    result = run_referendum_simulation(er, endorsements, model, meta, config)

    model_meta = result.metadata.get("model", {})
    assert model_meta.get("options") == tuple(meta["options"])

    constituencies = {area.constituency for area in result.areas}
    assert constituencies == {"Alpha", "Beta", "Northern Ireland"}

    ni_area = next(area for area in result.areas if area.constituency == "Northern Ireland")
    assert math.isclose(ni_area.electorate, 3800.0)
    assert math.isclose(ni_area.spoiled, 90.0)
    assert ni_area.party_breakdown
    assert ni_area.party_breakdown.get("parties")
    meta = ni_area.party_breakdown.get("metadata", {})
    assert meta.get("event_type") == "DevolvedElection"
    assert meta.get("elected_body") == "Northern Ireland Assembly"
    assert meta.get("families")
    assert meta.get("non_participant_label") == "Non-voters (baseline)"
    assert meta.get("non_participant_share") is not None
    assert meta.get("baseline_turnout_share") is not None
    elections_meta = meta.get("elections")
    assert isinstance(elections_meta, (list, tuple)) and elections_meta
    party_names = {party.get("party") for party in ni_area.party_breakdown.get("parties", [])}
    assert any(name and "Non-voters" in name for name in party_names)
    table_rows = _table_map(ni_area)
    assert set(table_rows.keys()) == {"Yes", "No", "Did not vote", "Spoiled"}
    assert ni_area.table.get("summary", {}).get("electorate") == ni_area.electorate
    assert ni_area.chart.get("labels") == ["Yes", "No", "Did not vote", "Spoiled"]
    assert len(ni_area.chart.get("values", [])) == 4


def test_simulation_uses_baseline_totals_when_referendum_missing_electorate():
    er = _make_election_results()
    # Remove explicit electorate figures from the referendum rows to force the fallback path.
    er.loc[er["Event"] == "TestRef", "Electorate"] = np.nan

    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])

    config = ReferendumSimulationConfig(date="2020-01-15", body_key="TestRef")
    result = run_referendum_simulation(er, endorsements, model, meta, config)

    alpha_area = next(area for area in result.areas if area.constituency == "Alpha")
    assert math.isfinite(alpha_area.electorate)
    assert alpha_area.electorate > 0
    assert alpha_area.valid_votes is not None and math.isfinite(alpha_area.valid_votes)
    assert alpha_area.party_breakdown

    for opt in alpha_area.options:
        if opt.option.lower().startswith("did not vote"):
            assert opt.count is not None and math.isfinite(opt.count)
            continue
        assert opt.count is not None and math.isfinite(opt.count)

    ni_area = next(area for area in result.areas if area.constituency == "Northern Ireland")
    opts = _option_map(ni_area)
    assert ni_area.party_breakdown
    yes_share = 0.55 / (0.55 + 0.35)
    no_share = 0.35 / (0.55 + 0.35)
    valid_alpha = 1700.0
    valid_beta = 1600.0
    valid_total = valid_alpha + valid_beta
    yes_count = yes_share * valid_total
    no_count = no_share * valid_total
    spoiled_total = 90.0
    turnout_total = valid_total + spoiled_total
    dnv_count = 250.0 + 160.0

    assert math.isclose(opts["Yes"].count, yes_count)
    assert math.isclose(opts["No"].count, no_count)
    assert math.isclose(opts["Did not vote"].count, dnv_count)

    table_rows = _table_map(ni_area)
    assert math.isclose(table_rows["Yes"]["votes"], yes_count)
    assert math.isclose(table_rows["No"]["votes"], no_count)
    assert math.isclose(table_rows["Did not vote"]["votes"], dnv_count)
    summary = ni_area.table.get("summary", {})
    assert math.isclose(summary.get("turnout", 0.0), turnout_total)
    assert math.isclose(summary.get("valid", 0.0), valid_total)
    assert math.isclose(summary.get("spoiled", 0.0), spoiled_total)
    chart_vals = ni_area.chart.get("values", [])
    assert len(chart_vals) == 4
    assert [pytest.approx(val, rel=1e-9) for val in chart_vals[:2]] == [yes_count, no_count]

    assert math.isclose(ni_area.valid_votes, valid_total)
    assert math.isclose(ni_area.spoiled, spoiled_total)
    assert math.isclose(ni_area.turnout, turnout_total)
    assert math.isclose(ni_area.did_not_vote, dnv_count)
    assert math.isclose(ni_area.turnout_pct, turnout_total / 3800.0 * 100.0)
    parties = {party.get("party") for party in ni_area.party_breakdown.get("parties", [])}
    assert any(name and "Non-voters" in name for name in parties)


def test_blank_override_clears_endorsement_to_neutral():
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = FeatureAwareDummyReferendumModel(meta["options"], meta["feat_cols"])

    base_config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        constituencies=["Alpha"],
        include_northern_ireland_view=False,
    )

    base_result = run_referendum_simulation(er, endorsements, model, meta, base_config)
    base_alpha = _option_map(_get_area(base_result, "Alpha"))

    endorsements_without_alliance = endorsements[endorsements["Party"] != "Alliance"].copy()
    neutral_result = run_referendum_simulation(
        er,
        endorsements_without_alliance,
        model,
        meta,
        base_config,
    )
    neutral_alpha = _option_map(_get_area(neutral_result, "Alpha"))

    override_config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        constituencies=["Alpha"],
        include_northern_ireland_view=False,
        override_endorsements={"Alliance": ""},
    )
    override_result = run_referendum_simulation(er, endorsements, model, meta, override_config)
    override_alpha = _option_map(_get_area(override_result, "Alpha"))

    for option in ("Yes", "No", "Did not vote"):
        base_opt = base_alpha[option]
        neutral_opt = neutral_alpha[option]
        override_opt = override_alpha[option]
        assert base_opt.count is not None
        assert neutral_opt.count is not None
        assert override_opt.count is not None

    assert override_alpha["Yes"].count < base_alpha["Yes"].count
    assert math.isclose(override_alpha["Yes"].count, neutral_alpha["Yes"].count)
    assert math.isclose(override_alpha["No"].count, neutral_alpha["No"].count)
    assert math.isclose(override_alpha["Did not vote"].count, neutral_alpha["Did not vote"].count)


def test_predefined_simulation_includes_spoiled_option():
    er = _make_election_results()
    endorsements = _make_endorsements()
    options = ["Yes", "No", "Spoiled", "Did not vote"]
    feat_cols = [f"share_endorsing::{opt}" for opt in options] + ["share_no_endorsement", "turnout_prior"]
    meta = {"options": options, "feat_cols": feat_cols}
    model = DummyReferendumModel(options)

    config = ReferendumSimulationConfig(date="2020-01-15", body_key="TestRef", constituencies=["Alpha"], include_northern_ireland_view=False)
    result = run_referendum_simulation(er, endorsements, model, meta, config)

    assert len(result.areas) == 1
    area = result.areas[0]
    opts = _option_map(area)
    assert set(opts.keys()) == {"Yes", "No", "Spoiled", "Did not vote"}
    assert area.party_breakdown

    electorate = 2000.0
    valid_total = 1700.0
    yes_share = 0.50 / (0.50 + 0.30)
    no_share = 0.30 / (0.50 + 0.30)
    expected_yes = yes_share * valid_total
    expected_no = no_share * valid_total
    expected_spoiled = 50.0
    expected_valid = valid_total
    expected_turnout = expected_valid + expected_spoiled
    expected_dnv = electorate - expected_turnout

    assert math.isclose(opts["Yes"].count, expected_yes)
    assert math.isclose(opts["No"].count, expected_no)
    assert math.isclose(opts["Spoiled"].count, expected_spoiled)
    assert math.isclose(opts["Did not vote"].count, expected_dnv)

    table_rows = _table_map(area)
    assert math.isclose(table_rows["Yes"]["votes"], expected_yes)
    assert math.isclose(table_rows["No"]["votes"], expected_no)
    assert math.isclose(table_rows["Spoiled"]["votes"], expected_spoiled)
    assert math.isclose(table_rows["Did not vote"]["votes"], expected_dnv)
    summary = area.table.get("summary", {})
    assert math.isclose(summary.get("valid", 0.0), expected_valid)
    assert math.isclose(summary.get("spoiled", 0.0), expected_spoiled)
    assert math.isclose(summary.get("turnout", 0.0), expected_turnout)

    assert math.isclose(area.valid_votes, expected_valid)
    assert math.isclose(area.spoiled, expected_spoiled)
    assert math.isclose(area.turnout, expected_turnout)
    assert math.isclose(area.did_not_vote, expected_dnv)


def test_custom_referendum_auto_maps_options():
    er = _make_election_results()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])

    config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="CustomBody",
        constituencies=["Alpha"],
        custom_options=["Stay", "Leave"],
        custom_endorsements={"Alliance": "Stay", "UUP": "Leave"},
        include_northern_ireland_view=False,
    )

    result = run_referendum_simulation(er, None, model, meta, config)

    assert len(result.areas) == 1
    area = result.areas[0]
    assert area.constituency == "Alpha"
    assert area.party_breakdown

    opts = _option_map(area)
    assert set(opts.keys()) == {"Stay", "Leave", "Did not vote"}

    valid_total = 1700.0
    yes_share = 0.55 / (0.55 + 0.35)
    no_share = 0.35 / (0.55 + 0.35)
    expected_yes = yes_share * valid_total
    expected_no = no_share * valid_total
    expected_valid = valid_total
    expected_spoiled = 50.0
    expected_turnout = expected_valid + expected_spoiled
    expected_dnv = 2000.0 - expected_turnout

    assert math.isclose(opts["Stay"].count, expected_yes)
    assert math.isclose(opts["Leave"].count, expected_no)
    assert math.isclose(opts["Did not vote"].count, expected_dnv)

    table_rows = _table_map(area)
    assert math.isclose(table_rows["Stay"]["votes"], expected_yes)
    assert math.isclose(table_rows["Leave"]["votes"], expected_no)
    assert math.isclose(table_rows["Did not vote"]["votes"], expected_dnv)

    assert math.isclose(area.valid_votes, expected_valid)
    assert math.isclose(area.spoiled, expected_spoiled)
    assert math.isclose(area.turnout, expected_turnout)
    assert math.isclose(area.did_not_vote, expected_dnv)


def test_referendum_simulation_accepts_multiple_constituencies():
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])

    config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        constituencies=["Alpha", "Beta"],
        include_northern_ireland_view=False,
    )

    result = run_referendum_simulation(er, endorsements, model, meta, config)

    assert {area.constituency for area in result.areas} == {"Alpha", "Beta"}
    for area in result.areas:
        assert area.party_breakdown


def test_referendum_simulation_tolerates_non_mapping_metadata():
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])
    model.feature_columns = list(meta["feat_cols"])

    config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        breakdown_event_type="DevolvedElection",
        breakdown_elected_body="Northern Ireland Assembly",
    )

    result = run_referendum_simulation(
        er,
        endorsements,
        model,
        np.array(["unexpected", "metadata"]),
        config,
    )

    model_meta = result.metadata.get("model", {})
    assert model_meta.get("options") == tuple(model.options)


def test_project_referendum_tolerates_non_mapping_metadata(monkeypatch, tmp_path):
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    model = DummyReferendumModel(meta["options"])
    model.feature_columns = list(meta["feat_cols"])

    calls = {"to_excel": 0}

    def _fake_to_excel(self, writer, *args, **kwargs):
        calls["to_excel"] += 1

    monkeypatch.setattr(pd.DataFrame, "to_excel", _fake_to_excel, raising=False)

    project_referendum(
        er,
        endorsements,
        model,
        np.array(["unexpected", "metadata"]),
        constituency_filter=None,
        event_filter=None,
        output_xlsx=str(tmp_path / "out.xlsx"),
    )

    assert calls["to_excel"] == 1


def test_constituency_variation_reflects_endorsement_shares():
    er = _make_election_results()
    endorsements = _make_endorsements()
    meta = _default_meta()
    feat_cols = meta["feat_cols"]
    model = FeatureAwareDummyReferendumModel(meta["options"], feat_cols)

    config = ReferendumSimulationConfig(
        date="2020-01-15",
        body_key="TestRef",
        constituencies=["Alpha", "Beta"],
        include_northern_ireland_view=False,
    )

    result = run_referendum_simulation(er, endorsements, model, meta, config)

    alpha = next(area for area in result.areas if area.constituency == "Alpha")
    beta = next(area for area in result.areas if area.constituency == "Beta")
    assert alpha.party_breakdown and beta.party_breakdown

    alpha_yes = _option_map(alpha)["Yes"]
    beta_yes = _option_map(beta)["Yes"]

    assert alpha_yes.count is not None and beta_yes.count is not None
    # Alpha has a larger baseline share of Alliance voters than Beta (60% vs 50%),
    # so the feature-aware model should produce a higher Yes count in Alpha.
    assert alpha_yes.count > beta_yes.count

    assert alpha_yes.pct_valid is not None and beta_yes.pct_valid is not None
    assert alpha_yes.pct_valid > beta_yes.pct_valid


@pytest.mark.skipif(not WORKBOOK_PATH.exists(), reason="Full election workbook not available")
def test_packaged_model_respects_unionist_nationalist_split():
    xl = pd.ExcelFile(WORKBOOK_PATH)
    try:
        er = load_election_results(xl)
        endorsements = load_endorsements(xl)
    finally:
        xl.close()

    model, meta = load_referendum_model_and_meta(cache=False)

    overrides = {
        "Sinn Féin": "Yes",
        "SDLP": "Yes",
        "Aontú": "Yes",
        "People Before Profit Alliance": "Yes",
        "IRSP": "Yes",
        "DUP": "No",
        "UUP": "No",
        "TUV": "No",
        "PUP": "No",
        "UKIP": "No",
    }

    config = ReferendumSimulationConfig(
        date="2024-07-04",
        body_key="BorderReferendum",
        constituencies=["Belfast East", "Belfast West"],
        override_endorsements=overrides,
        include_northern_ireland_view=False,
    )

    result = run_referendum_simulation(er, endorsements, model, meta, config)

    areas = {area.constituency: area for area in result.areas}
    east = areas["Belfast East"]
    west = areas["Belfast West"]
    assert east.party_breakdown and west.party_breakdown

    east_opts = _option_map(east)
    west_opts = _option_map(west)

    yes_east = east_opts["Yes"]
    yes_west = west_opts["Yes"]
    no_east = east_opts["No"]
    no_west = west_opts["No"]

    for opt in (yes_east, yes_west, no_east, no_west):
        assert opt.count is not None
        assert opt.pct_valid is not None

    # Nationalist Belfast West should deliver a materially larger Yes share than unionist Belfast East.
    assert yes_west.count > yes_east.count + 100.0
    assert yes_west.pct_valid - yes_east.pct_valid > 5.0

    # Conversely, Belfast East should show a stronger No performance than Belfast West.
    assert no_east.count > no_west.count + 100.0
    assert no_east.pct_valid - no_west.pct_valid > 5.0
