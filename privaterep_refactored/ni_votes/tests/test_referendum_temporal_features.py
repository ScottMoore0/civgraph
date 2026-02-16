import math

import pytest

pd = pytest.importorskip("pandas")

from ni_votes.data.ingestion import (
    StructuredElectionData,
    aggregate_nationwide,
    build_area_register,
    build_party_register,
    build_referendum_party_results,
    normalize_election_results,
    normalize_endorsements,
)
from ni_votes.features.referendum_temporal import (
    FeatureAssemblyConfig,
    build_temporal_feature_row,
)


def _structured_dataset(result_rows, endorsement_rows):
    results_df = normalize_election_results(pd.DataFrame(result_rows), source="unit-test")
    constituency = results_df[results_df["area_scope"].isin({"constituency", "constituency_group"})]
    nation = aggregate_nationwide(constituency)
    endorsements_df = normalize_endorsements(pd.DataFrame(endorsement_rows))
    party_register = build_party_register(results_df)
    area_register = build_area_register(results_df)
    referendum_party = build_referendum_party_results(results_df, endorsements_df)
    return StructuredElectionData(
        constituency_results=constituency,
        nation_results=nation,
        endorsements=endorsements_df,
        party_register=party_register,
        area_register=area_register,
        referendum_party_results=referendum_party,
        issues=[],
    )


def test_temporal_features_blend_families_and_recency():
    rows = [
        {
            "Date": "2016-06-23",
            "DateStr": "2016-06-23",
            "Event": "EU2016",
            "EventType": "EuropeanElection",
            "ElectedBody": "European Parliament",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance Party of Northern Ireland",
            "Votes1": 600,
        },
        {
            "Date": "2016-06-23",
            "DateStr": "2016-06-23",
            "Event": "EU2016",
            "EventType": "EuropeanElection",
            "ElectedBody": "European Parliament",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Democratic Unionist Party",
            "Votes1": 400,
        },
        {
            "Date": "2017-03-02",
            "DateStr": "2017-03-02",
            "Event": "Assembly2017",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance Party of Northern Ireland",
            "Votes1": 700,
        },
        {
            "Date": "2017-03-02",
            "DateStr": "2017-03-02",
            "Event": "Assembly2017",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Democratic Unionist Party",
            "Votes1": 300,
        },
    ]

    structured = _structured_dataset(rows, [])

    config = FeatureAssemblyConfig(
        target_date="2018-01-01",
        constituency="Example",
        event_type="EuropeanElection",
        elected_body="European Parliament",
        options=["Yes", "No", "Did not vote"],
    )

    result = build_temporal_feature_row(structured, config)
    frame = result.frame
    row = frame.iloc[0]

    assert result.metadata["families_used"] == (
        "DevolvedElection",
        "EuropeanElection",
    )

    target_ts = pd.Timestamp("2018-01-01")
    devolved_ts = pd.Timestamp("2017-03-02")
    european_ts = pd.Timestamp("2016-06-23")

    devolved_recency = (target_ts - devolved_ts).days / 365.25
    european_recency = (target_ts - european_ts).days / 365.25

    assert math.isclose(
        row["constituency_recency_years::DevolvedElection"],
        devolved_recency,
        rel_tol=1e-9,
    )
    assert math.isclose(
        row["constituency_recency_years::EuropeanElection"],
        european_recency,
        rel_tol=1e-9,
    )

    assert math.isclose(row["constituency_share::DevolvedElection::alliance"], 0.7)
    assert math.isclose(row["constituency_share::EuropeanElection::dup"], 0.4)

    weight_devolved = 1.0 / (1.0 + devolved_recency)
    weight_european = 1.0 / (1.0 + european_recency)
    expected_alliance = (
        0.7 * weight_devolved + 0.6 * weight_european
    ) / (weight_devolved + weight_european)

    assert math.isclose(
        row["nation_share::combined::alliance"],
        expected_alliance,
        rel_tol=1e-9,
    )


def test_temporal_features_respect_body_family_constraints():
    rows = [
        {
            "Date": "2024-07-04",
            "DateStr": "2024-07-04",
            "Event": "Westminster2024",
            "EventType": "WestminsterElection",
            "ElectedBody": "House of Commons of the United Kingdom",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 500,
        },
        {
            "Date": "2024-07-04",
            "DateStr": "2024-07-04",
            "Event": "Westminster2024",
            "EventType": "WestminsterElection",
            "ElectedBody": "House of Commons of the United Kingdom",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "DUP",
            "Votes1": 500,
        },
        {
            "Date": "2022-05-05",
            "DateStr": "2022-05-05",
            "Event": "Assembly2022",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance",
            "Votes1": 400,
        },
        {
            "Date": "2022-05-05",
            "DateStr": "2022-05-05",
            "Event": "Assembly2022",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Sinn Fein",
            "Votes1": 600,
        },
    ]

    structured = _structured_dataset(rows, [])

    config = FeatureAssemblyConfig(
        target_date="2024-07-05",
        constituency="Example",
        event_type="WestminsterElection",
        elected_body="Northern Ireland Assembly",
        options=["Yes", "No"],
    )

    result = build_temporal_feature_row(structured, config)
    assert result.metadata["families_used"] == ("DevolvedElection",)

    row = result.frame.iloc[0]
    assert math.isclose(row["constituency_share::combined::alliance"], 0.4, rel_tol=1e-9)
    assert math.isclose(row["constituency_share::combined::sinn fein"], 0.6, rel_tol=1e-9)


def test_endorsement_features_weighted_by_nation_share():
    rows = [
        {
            "Date": "2017-03-02",
            "DateStr": "2017-03-02",
            "Event": "Assembly2017",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Alliance Party of Northern Ireland",
            "Votes1": 700,
        },
        {
            "Date": "2017-03-02",
            "DateStr": "2017-03-02",
            "Event": "Assembly2017",
            "EventType": "DevolvedElection",
            "ElectedBody": "Northern Ireland Assembly",
            "Constituency": "Example",
            "ResultType": "Candidate",
            "Party Name": "Democratic Unionist Party",
            "Votes1": 300,
        },
    ]

    endorsements = [
        {
            "Date": "2017-12-10",
            "ReferendumName": "BorderPoll",
            "Party": "Alliance Party of Northern Ireland",
            "Endorsed": "Yes",
        },
        {
            "Date": "2017-11-01",
            "ReferendumName": "BorderPoll",
            "Party": "Democratic Unionist Party",
            "Endorsed": "No",
        },
    ]

    structured = _structured_dataset(rows, endorsements)

    config = FeatureAssemblyConfig(
        target_date="2018-01-01",
        constituency="Example",
        event_type="DevolvedElection",
        elected_body="BorderPoll",
        options=["Yes", "No", "Did not vote"],
    )

    result = build_temporal_feature_row(structured, config)
    row = result.frame.iloc[0]

    yes_weight = row["endorsement_weighted_share::yes"]
    no_weight = row["endorsement_weighted_share::no"]
    combined = row["nation_share::combined::alliance"] + row["nation_share::combined::dup"]

    assert math.isclose(
        yes_weight,
        row["nation_share::combined::alliance"],
        rel_tol=1e-9,
    )
    assert math.isclose(
        no_weight,
        row["nation_share::combined::dup"],
        rel_tol=1e-9,
    )
    assert math.isclose(combined, 1.0, rel_tol=1e-9)

    assert row["endorsement_party_count::yes"] == 1.0
    assert row["endorsement_party_count::no"] == 1.0
    assert row["endorsement_party_count::did_not_vote"] == 0.0
    assert row["endorsement_unique_parties"] == 2.0

    latest = pd.Timestamp("2017-12-10")
    recency_years = (pd.Timestamp("2018-01-01") - latest).days / 365.25
    assert math.isclose(row["endorsement_recency_years"], recency_years, rel_tol=1e-9)
