import pytest

import math
import json

import math

pd = pytest.importorskip("pandas")
np = pytest.importorskip("numpy")

from ni_votes.models import (
    load_referendum_model_and_meta,
    resolve_referendum_model_and_meta,
    materialise_referendum_joblib,
)
from ni_votes.models_referendum import (
    compute_constituency_totals,
    build_referendum_training_real,
    prepare_referendum_training_matrices,
    cross_validate_referendums,
    fit_referendum_model,
    REFERENDUM_MODEL_BUNDLE_VERSION,
)
from ni_votes.project.referendum import filter_referendum_rows as project_filter
from ni_votes.project.referendum import _add_northern_ireland_view
from ni_votes.project.referendum import build_referendum_features_for_group
from ni_votes.project.referendum import build_custom_two_option_features
from ni_votes.project.referendum import predict_group_rows
from ni_votes.project.referendum import _resolve_breakdown_families
from ni_votes.project.referendum import _combine_weighted_shares
from ni_votes.features.endorsements import (
    build_endorsement_history,
    resolve_endorsements_for_date,
)


def _make_df(rows):
    return pd.DataFrame(rows)


class _ConstantProbModel:
    def __init__(self, options, probs):
        self._options = options
        self._probs = np.asarray(probs, dtype=float)

    def predict_proba_rows(self, X):
        return np.tile(self._probs, (X.shape[0], 1))


def test_filter_excludes_recall_rows():
    df = _make_df([
        {
            "EventType": "Recall",
            "Event": "NARecallPetition",
            "ElectedBody": "NA Recall",
            "Constituency": "Belfast East",
            "Name usually known by": "Yes",
            "DateStr": "2018-08-29",
        },
        {
            "EventType": "Referendum",
            "Event": "GFAReferendum",
            "ElectedBody": "GFA",
            "Constituency": "Belfast East",
            "Name usually known by": "Yes",
            "DateStr": "1998-05-22",
        },
    ])

    project_filtered = project_filter(df)
    assert not project_filtered[project_filtered["Event"].str.contains("Recall", case=False)].any().any()


def test_filter_drops_national_when_specific_present():
    df = _make_df([
        {
            "EventType": "Referendum",
            "Event": "GFAReferendum",
            "ElectedBody": "GFA",
            "Constituency": "Belfast East",
            "Name usually known by": "Yes",
            "DateStr": "1998-05-22",
        },
        {
            "EventType": "Referendum",
            "Event": "GFAReferendum",
            "ElectedBody": "GFA",
            "Constituency": "Northern Ireland",
            "Name usually known by": "Yes",
            "DateStr": "1998-05-22",
        },
    ])

    filtered = project_filter(df)
    assert set(filtered["Constituency"]) == {"Belfast East"}


def test_filter_keeps_national_when_only_option():
    df = _make_df([
        {
            "EventType": "Referendum",
            "Event": "BorderReferendum",
            "ElectedBody": "Border",
            "Constituency": "Northern Ireland",
            "Name usually known by": "Yes",
            "DateStr": "1973-03-08",
        }
    ])

    filtered = project_filter(df)
    assert set(filtered["Constituency"]) == {"Northern Ireland"}


def test_resolve_breakdown_families_prefers_body_mapping():
    families = _resolve_breakdown_families("GeneralElection", "Northern Ireland Assembly")
    assert families == ["DevolvedElection"]

    european = _resolve_breakdown_families("EuropeanElection", "European Parliament")
    assert european == ["EuropeanElection", "DevolvedElection"]


def test_add_northern_ireland_view_aggregates_counts():
    base_rows = [
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "A",
            "ElectedBody": "Test",
            "Option": "Yes",
            "ProjectedPctElectorate": 60.0,
            "ProjectedPctValid": 60.0,
            "ProjectedCount": 60.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 2.0,
        },
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "A",
            "ElectedBody": "Test",
            "Option": "No",
            "ProjectedPctElectorate": 40.0,
            "ProjectedPctValid": 40.0,
            "ProjectedCount": 40.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 2.0,
        },
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "A",
            "ElectedBody": "Test",
            "Option": "Did not vote",
            "ProjectedPctElectorate": 0.0,
            "ProjectedPctValid": np.nan,
            "ProjectedCount": 0.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 2.0,
        },
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "B",
            "ElectedBody": "Test",
            "Option": "Yes",
            "ProjectedPctElectorate": 30.0,
            "ProjectedPctValid": 30.0,
            "ProjectedCount": 30.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 3.0,
        },
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "B",
            "ElectedBody": "Test",
            "Option": "No",
            "ProjectedPctElectorate": 70.0,
            "ProjectedPctValid": 70.0,
            "ProjectedCount": 70.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 3.0,
        },
        {
            "ProjectedDate": "2020-01-01",
            "OriginalDate": "2020-01-01",
            "Constituency": "B",
            "ElectedBody": "Test",
            "Option": "Did not vote",
            "ProjectedPctElectorate": 0.0,
            "ProjectedPctValid": np.nan,
            "ProjectedCount": 0.0,
            "Electorate": 100.0,
            "ProjectedSpoiled": 3.0,
        },
    ]

    df = pd.DataFrame(base_rows)
    out = _add_northern_ireland_view(df)

    ni_rows = out[out["Constituency"] == "Northern Ireland"]
    assert set(ni_rows["Option"]) == {"Yes", "No", "Did not vote"}


def test_endorsement_history_tracks_latest_per_party():
    endorsements = pd.DataFrame([
        {
            "Date": pd.Timestamp("2020-01-01"),
            "ElectedBody": "TestRef",
            "Party": "Alliance",
            "EndorsedClean": "Yes",
        },
        {
            "Date": pd.Timestamp("2020-02-01"),
            "ElectedBody": "TestRef",
            "Party": "UUP",
            "EndorsedClean": "No",
        },
        {
            "Date": pd.Timestamp("2020-03-01"),
            "ElectedBody": "TestRef",
            "Party": "UUP",
            "EndorsedClean": "Yes",
        },
    ])

    history = build_endorsement_history(endorsements)

    feb = resolve_endorsements_for_date(history, "TestRef", "2020-02-15")
    assert feb == {"Alliance": "Yes", "UUP": "No"}

    april = resolve_endorsements_for_date(history, "TestRef", "2020-04-01")
    assert april == {"Alliance": "Yes", "UUP": "Yes"}

    before = resolve_endorsements_for_date(history, "TestRef", "2019-12-01")
    assert before == {}

    latest = resolve_endorsements_for_date(history, "TestRef", None)
    assert latest == {"Alliance": "Yes", "UUP": "Yes"}


def test_combine_weighted_shares_skips_missing_parties_without_penalty():
    weighted = [
        ({"Alliance": 0.7, "DUP": 0.3}, 1.0),
        ({"Alliance": 0.6}, 2.0),
    ]

    combined = _combine_weighted_shares(weighted)

    expected_alliance = (0.7 * 1.0 + 0.6 * 2.0) / (1.0 + 2.0)
    expected_dup = 0.3
    total = expected_alliance + expected_dup
    expected_alliance /= total
    expected_dup /= total

    assert math.isclose(combined["Alliance"], expected_alliance, rel_tol=1e-9)
    assert math.isclose(combined["DUP"], expected_dup, rel_tol=1e-9)


def test_feature_builder_uses_persistent_endorsements():
    er = pd.DataFrame([
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Test",
            "DateStr": "2019-05-01",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 600,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Test",
            "DateStr": "2019-05-01",
            "ResultType": "Candidate",
            "Party Name": "UUP",
            "Votes1": 400,
        },
    ])

    endorsements = pd.DataFrame([
        {
            "Date": pd.Timestamp("2020-01-01"),
            "ElectedBody": "TestRef",
            "Party": "Alliance",
            "EndorsedClean": "Yes",
        },
        {
            "Date": pd.Timestamp("2020-02-01"),
            "ElectedBody": "TestRef",
            "Party": "UUP",
            "EndorsedClean": "No",
        },
        {
            "Date": pd.Timestamp("2020-03-01"),
            "ElectedBody": "TestRef",
            "Party": "UUP",
            "EndorsedClean": "Yes",
        },
    ])

    history = build_endorsement_history(endorsements)

    feat_feb, _, _ = build_referendum_features_for_group(
        er,
        endorsements,
        "2020-02-15",
        "Test",
        "TestRef",
        ["Yes", "No", "Did not vote"],
        endorsement_history=history,
    )

    assert feat_feb.loc[0, "share_endorsing::Yes"] == pytest.approx(0.6)
    assert feat_feb.loc[0, "share_endorsing::No"] == pytest.approx(0.4)

    feat_mar, _, _ = build_referendum_features_for_group(
        er,
        endorsements,
        "2020-03-15",
        "Test",
        "TestRef",
        ["Yes", "No", "Did not vote"],
        endorsement_history=history,
    )

    assert feat_mar.loc[0, "share_endorsing::Yes"] == pytest.approx(1.0)
    assert feat_mar.loc[0, "share_endorsing::No"] == pytest.approx(0.0)


def test_feature_builder_tracks_spoil_and_abstain_endorsements():
    er = pd.DataFrame(
        [
            {
                "Event": "DevolvedElection",
                "EventType": "DevolvedElection",
                "Constituency": "Gamma",
                "DateStr": "2019-05-02",
                "ResultType": "Candidate",
                "Party Name": "Alliance",
                "Votes1": 400,
            },
            {
                "Event": "DevolvedElection",
                "EventType": "DevolvedElection",
                "Constituency": "Gamma",
                "DateStr": "2019-05-02",
                "ResultType": "Candidate",
                "Party Name": "DUP",
                "Votes1": 300,
            },
            {
                "Event": "DevolvedElection",
                "EventType": "DevolvedElection",
                "Constituency": "Gamma",
                "DateStr": "2019-05-02",
                "ResultType": "Candidate",
                "Party Name": "People Before Profit",
                "Votes1": 100,
            },
            {
                "Event": "DevolvedElection",
                "EventType": "DevolvedElection",
                "Constituency": "Gamma",
                "DateStr": "2019-05-02",
                "ResultType": "Candidate",
                "Party Name": "UUP",
                "Votes1": 100,
            },
            {
                "Event": "DevolvedElection",
                "EventType": "DevolvedElection",
                "Constituency": "Gamma",
                "DateStr": "2019-05-02",
                "ResultType": "Candidate",
                "Party Name": "Green",
                "Votes1": 100,
            },
        ]
    )

    endorsements = pd.DataFrame(
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
            {
                "Date": pd.Timestamp("2020-01-01"),
                "ElectedBody": "TestRef",
                "Party": "DUP",
                "EndorsedClean": "Did not vote",
            },
            {
                "Date": pd.Timestamp("2020-01-01"),
                "ElectedBody": "TestRef",
                "Party": "People Before Profit",
                "EndorsedClean": "Spoiled",
            },
            {
                "Date": pd.Timestamp("2020-01-01"),
                "ElectedBody": "TestRef",
                "Party": "Green",
                "EndorsedClean": "",
            },
        ]
    )

    feat_df, _, context = build_referendum_features_for_group(
        er,
        endorsements,
        "2020-01-01",
        "Gamma",
        "TestRef",
        ["Yes", "No", "Spoiled", "Did not vote"],
    )

    assert feat_df.loc[0, "share_endorsing::Yes"] == pytest.approx(0.4)
    assert feat_df.loc[0, "share_endorsing::No"] == pytest.approx(0.1)
    assert feat_df.loc[0, "share_endorsing::Did not vote"] == pytest.approx(0.3)
    assert feat_df.loc[0, "share_endorsing::Spoiled"] == pytest.approx(0.1)
    assert feat_df.loc[0, "share_no_endorsement"] == pytest.approx(0.1)

    canonical = context.get("canonical_endorsements", {})
    assert canonical.get("dup") == "Did not vote"
    assert canonical.get("people before profit") == "Spoiled"


def test_feature_builder_counts_question_mark_as_no_endorsement():
    er = pd.DataFrame([
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Alpha",
            "DateStr": "2019-05-02",
            "ResultType": "Candidate",
            "Party Name": "Alliance Party of Northern Ireland",
            "Votes1": 600,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Alpha",
            "DateStr": "2019-05-02",
            "ResultType": "Candidate",
            "Party Name": "Democratic Unionist Party - D.U.P.",
            "Votes1": 400,
        },
    ])

    endorsements = pd.DataFrame([
        {
            "Date": pd.Timestamp("2019-05-01"),
            "ElectedBody": "TestRef",
            "Party": "Alliance Party of Northern Ireland",
            "EndorsedClean": "Yes",
        },
        {
            "Date": pd.Timestamp("2019-05-01"),
            "ElectedBody": "TestRef",
            "Party": "Democratic Unionist Party",
            "EndorsedClean": "?",
        },
    ])

    feature_df, _, _ = build_referendum_features_for_group(
        er,
        endorsements,
        "2019-06-01",
        "Alpha",
        "TestRef",
        ["Yes", "No", "Did not vote"],
    )

    row = feature_df.iloc[0]
    assert math.isclose(row["share_endorsing::Yes"], 0.6)
    assert math.isclose(row["share_no_endorsement"], 0.4)


def test_custom_two_option_features_assign_slots_automatically():
    er = pd.DataFrame([
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Test",
            "DateStr": "2019-05-01",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 600,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Test",
            "DateStr": "2019-05-01",
            "ResultType": "Candidate",
            "Party Name": "UUP",
            "Votes1": 400,
        },
    ])

    feat_df, totals, mapping, context = build_custom_two_option_features(
        er,
        date_str="2020-02-01",
        constituency="Test",
        body_key="Custom",
        model_options=["Yes", "No", "Did not vote"],
        custom_options=["Stay", "Go"],
        custom_endorsements={"Alliance": "Stay", "UUP": "Go"},
    )

    assert feat_df.loc[0, "share_endorsing::Yes"] == pytest.approx(0.6)
    assert feat_df.loc[0, "share_endorsing::No"] == pytest.approx(0.4)
    assert mapping == {"Yes": "Stay", "No": "Go", "Did not vote": "Did not vote"}
    assert "electorate" in totals


def test_custom_two_option_maps_extra_model_labels_with_heuristics():
    er = pd.DataFrame([
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "Constituency": "Test",
            "DateStr": "2019-05-01",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 600,
        }
    ])

    _, _, mapping, _ = build_custom_two_option_features(
        er,
        date_str="2020-02-01",
        constituency="Test",
        body_key="Custom",
        model_options=["Remain", "Leave", "Support candidates", "Did not vote"],
        custom_options=["OptA", "OptB"],
    )

    assert mapping["Remain"] == "OptA"
    assert mapping["Leave"] == "OptB"
    # Keyword heuristic should allocate "Support candidates" to the first option
    assert mapping["Support candidates"] == "OptA"


def test_constituency_totals_use_resulttype_electorate():
    df = _make_df([
        {
            "ResultType": "Answer",
            "Name usually known by": "Yes",
            "Votes1": 600,
        },
        {
            "ResultType": "Answer",
            "Name usually known by": "No",
            "Votes1": 400,
        },
        {
            "ResultType": "Spoiled",
            "Votes1": 12,
        },
        {
            "ResultType": "Electorate",
            "Votes1": 1200,
        },
        {
            "ResultType": "Did not vote",
            "Votes1": 188,
        },
    ])

    totals = compute_constituency_totals(df, event="TestRef", elected_body="TestRef")

    assert totals["electorate"] == 1200
    assert totals["valid_total"] == 1000
    assert totals["spoiled"] == 12
    assert totals["did_not_vote"] == 188


def test_feature_totals_pick_latest_election_snapshot():
    er = pd.DataFrame([
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "ElectedBody": "Assembly",
            "Constituency": "Test",
            "DateStr": "2022-05-05",
            "ResultType": "Candidate",
            "Party Name": "Unionist",
            "Votes1": 1200,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "ElectedBody": "Assembly",
            "Constituency": "Test",
            "DateStr": "2022-05-05",
            "ResultType": "Candidate",
            "Party Name": "Nationalist",
            "Votes1": 800,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "ElectedBody": "Assembly",
            "Constituency": "Test",
            "DateStr": "2022-05-05",
            "ResultType": "Electorate",
            "Votes1": 5000,
        },
        {
            "Event": "DevolvedElection",
            "EventType": "DevolvedElection",
            "ElectedBody": "Assembly",
            "Constituency": "Test",
            "DateStr": "2022-05-05",
            "ResultType": "Did not vote",
            "Votes1": 1500,
        },
        {
            "Event": "WestminsterElection",
            "EventType": "GeneralElection",
            "ElectedBody": "House of Commons",
            "Constituency": "Test",
            "DateStr": "2024-07-04",
            "ResultType": "Candidate",
            "Party Name": "Unionist",
            "Votes1": 1400,
        },
        {
            "Event": "WestminsterElection",
            "EventType": "GeneralElection",
            "ElectedBody": "House of Commons",
            "Constituency": "Test",
            "DateStr": "2024-07-04",
            "ResultType": "Candidate",
            "Party Name": "Nationalist",
            "Votes1": 1100,
        },
        {
            "Event": "WestminsterElection",
            "EventType": "GeneralElection",
            "ElectedBody": "House of Commons",
            "Constituency": "Test",
            "DateStr": "2024-07-04",
            "ResultType": "Electorate",
            "Votes1": 6200,
        },
        {
            "Event": "WestminsterElection",
            "EventType": "GeneralElection",
            "ElectedBody": "House of Commons",
            "Constituency": "Test",
            "DateStr": "2024-07-04",
            "ResultType": "Spoiled",
            "Votes1": 60,
        },
        {
            "Event": "WestminsterElection",
            "EventType": "GeneralElection",
            "ElectedBody": "House of Commons",
            "Constituency": "Test",
            "DateStr": "2024-07-04",
            "ResultType": "Did not vote",
            "Votes1": 3640,
        },
    ])

    endorsements = pd.DataFrame([
        {
            "Date": pd.Timestamp("2024-06-01"),
            "ElectedBody": "BorderReferendum",
            "Party": "Unionist",
            "EndorsedClean": "No",
        },
        {
            "Date": pd.Timestamp("2024-06-01"),
            "ElectedBody": "BorderReferendum",
            "Party": "Nationalist",
            "EndorsedClean": "Yes",
        },
    ])

    feat_df, totals, context = build_referendum_features_for_group(
        er,
        endorsements,
        date_str="2024-07-04",
        constituency="Test",
        body_key="BorderReferendum",
        options=["Yes", "No", "Did not vote"],
    )

    assert not feat_df.empty
    assert math.isclose(totals["electorate"], 6200.0)
    assert math.isclose(totals["valid_total"], 2500.0)
    assert math.isclose(totals["spoiled"], 60.0)
    assert math.isclose(totals["did_not_vote"], 3640.0)


def test_predict_group_rows_respects_totals_scaling():
    model_options = ["Yes", "No", "Did not vote", "Spoiled"]
    model = _ConstantProbModel(model_options, [0.3, 0.2, 0.5, 0.0])
    feat_cols = [f"share_endorsing::{opt}" for opt in model_options] + ["share_no_endorsement", "turnout_prior"]
    feat_df = pd.DataFrame([{col: 0.0 for col in feat_cols}])

    totals = {
        "electorate": 1000.0,
        "valid_total": 600.0,
        "spoiled": 50.0,
        "did_not_vote": 350.0,
    }

    context = {
        "baseline_shares": {"Alliance": 0.6, "UUP": 0.4},
        "endorsements": {"Alliance": "Yes", "UUP": "No"},
        "canonical_endorsements": {"alliance": "Yes", "uup": "No"},
    }

    rows, breakdown = predict_group_rows(
        model,
        feat_cols,
        model_options,
        feat_df,
        totals,
        model_options,
        {opt: opt for opt in model_options},
        date_str="2020-01-01",
        constituency="Test",
        body_key="TestRef",
        context=context,
    )

    out = {row["Option"]: row for row in rows}

    assert pytest.approx(out["Yes"]["ProjectedCount"]) == 360.0
    assert pytest.approx(out["No"]["ProjectedCount"]) == 240.0
    assert pytest.approx(out["Did not vote"]["ProjectedCount"]) == 350.0
    assert pytest.approx(out.get("Spoiled", {}).get("ProjectedCount")) == 50.0

    assert breakdown
    parties = breakdown.get("parties", [])
    assert parties
    yes_total = sum(party.get("counts", {}).get("Yes", 0.0) for party in parties)
    assert pytest.approx(yes_total) == out["Yes"]["ProjectedCount"]
    meta = breakdown.get("metadata", {})
    assert "option_labels" in meta


def _referendum_training_inputs():
    election_rows = [
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance Party of Northern Ireland",
            "Votes1": 600,
        },
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Democratic Unionist Party",
            "Votes1": 400,
        },
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Electorate",
            "Votes1": 1200,
        },
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example West",
            "ResultType": "Candidate",
            "Party Name": "Sinn Féin",
            "Votes1": 450,
        },
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example West",
            "ResultType": "Candidate",
            "Party Name": "Ulster Unionist Party",
            "Votes1": 350,
        },
        {
            "Date": "2016-05-05",
            "Event": "Assembly2016",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example West",
            "ResultType": "Electorate",
            "Votes1": 1000,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example",
            "ResultType": "Answer",
            "Name usually known by": "Yes",
            "Votes1": 550,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example",
            "ResultType": "Answer",
            "Name usually known by": "No",
            "Votes1": 450,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example",
            "ResultType": "Electorate",
            "Votes1": 1200,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example West",
            "ResultType": "Answer",
            "Name usually known by": "Yes",
            "Votes1": 320,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example West",
            "ResultType": "Answer",
            "Name usually known by": "No",
            "Votes1": 280,
        },
        {
            "Date": "2020-02-01",
            "Event": "UnityPoll",
            "EventType": "Referendum",
            "ElectedBody": "Unity Referendum",
            "Constituency": "Example West",
            "ResultType": "Electorate",
            "Votes1": 1000,
        },
    ]

    endorsements = pd.DataFrame(
        [
            {
                "Date": "2020-01-10",
                "ReferendumName": "Unity Referendum",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "Yes",
            },
            {
                "Date": "2020-01-12",
                "ReferendumName": "Unity Referendum",
                "Party": "Democratic Unionist Party",
                "Endorsed": "No",
            },
            {
                "Date": "2020-01-12",
                "ReferendumName": "Unity Referendum",
                "Party": "Sinn Féin",
                "Endorsed": "Yes",
            },
        ]
    )

    return pd.DataFrame(election_rows), endorsements


def test_build_training_set_infers_targets_and_metadata():
    er, endorsements = _referendum_training_inputs()
    training_set = build_referendum_training_real(er, endorsements)

    assert len(training_set.features) == 4
    assert {"Yes", "No", "Did not vote"}.issubset(set(training_set.options))
    assert np.allclose(training_set.targets.sum(axis=1), 1.0, atol=1e-6)
    metadata = training_set.metadata
    assert {"party_key", "party_total_votes", "total_votes"}.issubset(set(metadata.columns))
    parties = set(metadata["party_key"].tolist())
    assert parties == {"alliance", "dup", "sinnfein", "uup"}
    assert {
        "party_baseline_share",
        "party_endorsement::Yes",
        "party_endorsement::No",
    }.issubset(set(training_set.features.columns))
    assert training_set.weights.shape[0] == len(training_set.features)


def test_prepare_training_matrices_matches_training_set_shapes():
    er, endorsements = _referendum_training_inputs()
    training_set = build_referendum_training_real(er, endorsements)
    matrices = prepare_referendum_training_matrices(training_set)

    assert matrices["X"].shape[0] == len(training_set.features)
    assert matrices["Y"].shape[1] == len(training_set.options)
    assert matrices["feat_cols"] == training_set.feature_columns
    assert matrices["target_cols"] == training_set.target_columns
    assert matrices["weights"].shape[0] == len(training_set.features)


def test_party_targets_reconstruct_referendum_totals():
    er, endorsements = _referendum_training_inputs()
    training_set = build_referendum_training_real(er, endorsements)

    metadata = training_set.metadata
    targets = training_set.targets.to_numpy()
    option_index = {opt: idx for idx, opt in enumerate(training_set.options)}

    grouped = metadata.groupby(["date_str", "area_key"], sort=False)
    for (date_str, area_key), group in grouped:
        total_votes_expected = float(group["total_votes"].iloc[0])
        reconstructed_total = float(group["party_total_votes"].sum())
        assert math.isclose(reconstructed_total, total_votes_expected, rel_tol=1e-6)

        for opt in training_set.options:
            idx = option_index[opt]
            reconstructed_option = float(
                sum(
                    group["party_total_votes"].iloc[i] * targets[group.index[i], idx]
                    for i in range(len(group))
                )
            )
            expected_option = float(group[f"option_votes::{opt}"].iloc[0])
            assert math.isclose(reconstructed_option, expected_option, rel_tol=1e-6)


def test_cross_validate_and_fit_report_metrics_and_meta():
    er, endorsements = _referendum_training_inputs()
    training_set = build_referendum_training_real(er, endorsements)

    metrics = cross_validate_referendums(training_set, folds=2)
    assert metrics["fold_count"] == len(metrics["folds"])
    assert {"mean_cross_entropy", "mean_mae"}.issubset(metrics.keys())

    model, meta = fit_referendum_model(training_set, random_state=0)
    assert meta["bundle_version"] == REFERENDUM_MODEL_BUNDLE_VERSION
    training = meta["training_rows"]
    assert training["count"] == len(training_set.features)
    assert training["weight_sum"] >= 0.0
    calibration = meta.get("calibration")
    if calibration is not None:
        assert "temperature" in calibration

    probs = model.predict_proba_rows(training_set.features.to_numpy())
    assert probs.shape[1] == len(training_set.options)
    assert np.allclose(probs.sum(axis=1), 1.0, atol=1e-6)


def test_packaged_referendum_model_and_meta_alignment():
    model, meta = load_referendum_model_and_meta(cache=False)

    assert isinstance(meta, dict)
    assert meta.get("bundle_version") == REFERENDUM_MODEL_BUNDLE_VERSION
    options = meta.get("options", [])
    assert options
    assert hasattr(model, "predict_proba_rows")
    assert getattr(model, "options", options) == options
    training_rows = meta.get("training_rows", {})
    assert training_rows.get("count") is not None
    assert training_rows.get("weight_sum") is not None


def test_resolve_prefers_packaged_when_meta_missing(tmp_path):
    packaged_model, packaged_meta = load_referendum_model_and_meta(cache=False)
    model_path = materialise_referendum_joblib(tmp_path / "local.joblib")
    meta_path = tmp_path / "local.meta.json"

    model, meta = resolve_referendum_model_and_meta(model_path, meta_path, cache=False)

    assert meta == packaged_meta
    assert model.__class__ == packaged_model.__class__


def test_resolve_uses_local_when_meta_compatible(tmp_path):
    _, packaged_meta = load_referendum_model_and_meta(cache=False)
    model_path = materialise_referendum_joblib(tmp_path / "local.joblib")
    meta_path = tmp_path / "local.meta.json"

    compatible_meta = json.loads(json.dumps(packaged_meta))
    training = compatible_meta.setdefault("training_rows", {})
    training["count"] = training.get("count", 0) + 1
    training["weight_sum"] = float(training.get("weight_sum", 0.0)) + 1.0
    meta_path.write_text(json.dumps(compatible_meta, indent=2))

    model, meta = resolve_referendum_model_and_meta(model_path, meta_path, cache=False)

    assert meta == compatible_meta


def test_resolve_rejects_incompatible_meta(tmp_path):
    packaged_model, packaged_meta = load_referendum_model_and_meta(cache=False)
    model_path = materialise_referendum_joblib(tmp_path / "local.joblib")
    meta_path = tmp_path / "local.meta.json"

    stale_meta = json.loads(json.dumps(packaged_meta))
    stale_meta.pop("bundle_version", None)
    meta_path.write_text(json.dumps(stale_meta, indent=2))

    model, meta = resolve_referendum_model_and_meta(model_path, meta_path, cache=False)

    assert meta == packaged_meta
    assert model.__class__ == packaged_model.__class__
