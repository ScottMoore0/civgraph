import io

import pandas as pd

from ni_votes.data.ingestion import (
    aggregate_nationwide,
    ingest_election_data,
    normalize_election_results,
    normalize_endorsements,
)


def _base_election_rows():
    return pd.DataFrame(
        [
            {
                "Date": "2020-01-01",
                "Event": "AssemblyElection",
                "EventType": "DevolvedElection",
                "ElectedBody": "Northern Ireland Assembly",
                "Constituency": "Example",
                "ResultType": "Candidate",
                "Party Name": "Alliance Party of Northern Ireland",
                "Votes1": 1000,
                "Name usually known by": "Alice Example",
                "PersonID": 101,
                "DevolvedInstance": 1,
            },
            {
                "Date": "2020-01-01",
                "Event": "AssemblyElection",
                "EventType": "DevolvedElection",
                "ElectedBody": "Northern Ireland Assembly",
                "Constituency": "Example",
                "ResultType": "Candidate",
                "Party Name": "Alliance Party of Northern Ireland",
                "Votes1": 500,
                "Name usually known by": "Alan Example",
                "PersonID": 102,
                "DevolvedInstance": 1,
            },
            {
                "Date": "2020-01-01",
                "Event": "AssemblyElection",
                "EventType": "DevolvedElection",
                "ElectedBody": "Northern Ireland Assembly",
                "Constituency": "Example",
                "ResultType": "Electorate",
                "Votes1": 2000,
            },
            {
                "Date": "2020-02-01",
                "Event": "BorderPoll",
                "EventType": "Referendum",
                "ElectedBody": "BorderReferendum",
                "Constituency": "Northern Ireland",
                "ResultType": "Answer",
                "Name usually known by": "Yes",
                "Votes1": 600,
            },
            {
                "Date": "2020-02-01",
                "Event": "BorderPoll",
                "EventType": "Referendum",
                "ElectedBody": "BorderReferendum",
                "Constituency": "Northern Ireland",
                "ResultType": "Did not vote",
                "Votes1": 400,
            },
        ]
    )


def test_normalize_election_results_handles_party_and_referendum_rows():
    rows = _base_election_rows()
    result = normalize_election_results(rows, source="unit-test")

    # Party rows aggregated across candidates.
    party = result[result["party_key"] == "alliance"]
    assert len(party) == 1
    party_row = party.iloc[0]
    assert party_row["votes"] == 1500.0
    assert party_row["candidate_count"] == 2
    assert party_row["result_kind"] == "party"
    assert party_row["person_ids"] == (101, 102)

    # Electorate captured separately.
    electorate = result[result["result_kind"] == "electorate"]
    assert electorate.iloc[0]["votes"] == 2000.0
    assert not electorate.iloc[0]["is_valid_vote"]

    # Referendum option normalised.
    referendum = result[result["result_kind"] == "referendum_option"]
    assert referendum.iloc[0]["option_label"] == "Yes"
    assert referendum.iloc[0]["area_scope"] == "nation"

    # Non-voters captured distinctly.
    dnv = result[result["result_kind"] == "did_not_vote"]
    assert dnv.iloc[0]["option_label"] == "Did not vote"


def test_aggregate_nationwide_sums_votes():
    rows = _base_election_rows().copy()
    rows.loc[1, "Constituency"] = "Example West"
    rows.loc[1, "Votes1"] = 600
    rows.loc[1, "PersonID"] = 103
    rows = rows.head(2)  # keep party rows only for aggregation simplicity

    normalized = normalize_election_results(rows, source="unit-test")
    constituency = normalized[normalized["area_scope"] == "constituency"]
    nation = aggregate_nationwide(constituency)

    assert len(nation) == 1
    ni_row = nation.iloc[0]
    assert ni_row["votes"] == 1600.0
    assert ni_row["candidate_count"] == 2
    assert ni_row["area_scope"] == "nation"


def test_normalize_endorsements_standardises_labels():
    raw = pd.DataFrame(
        [
            {
                "Date": "2016-05-01",
                "ReferendumName": "BorderPoll",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "yes",
            },
            {
                "Date": "2016-05-01",
                "ReferendumName": "BorderPoll",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "yes",
            },
        ]
    )

    tidy = normalize_endorsements(raw)
    assert len(tidy) == 1
    row = tidy.iloc[0]
    assert row["option_label"] == "Yes"
    assert row["party_key"] == "alliance"


def test_normalize_endorsements_marks_neutral_tokens():
    raw = pd.DataFrame(
        [
            {
                "Date": "1998-05-01",
                "ReferendumName": "BorderPoll",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "?",
            },
            {
                "Date": "1998-05-01",
                "ReferendumName": "BorderPoll",
                "Party": "Northern Ireland Women's Coalition",
                "Endorsed": "",
            },
            {
                "Date": "1998-05-01",
                "ReferendumName": "BorderPoll",
                "Party": "Labour Coalition",
                "Endorsed": "No official stance",
            },
        ]
    )

    tidy = normalize_endorsements(raw)
    assert len(tidy) == 3
    assert set(tidy["option_label"]) == {"Neutral"}


def test_normalize_endorsements_uses_name_usually_known_by_column():
    raw = pd.DataFrame(
        [
            {
                "Date": "2016-06-01",
                "Event": "EuropeReferendum",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "",
                "Name usually known by": "Remain a member of the European Union",
            }
        ]
    )

    tidy = normalize_endorsements(raw)
    assert tidy.loc[0, "option_label"] == "Remain a member of the European Union"


def test_normalize_endorsements_falls_back_to_event_key():
    raw = pd.DataFrame(
        [
            {
                "Date": "1998-05-01",
                "Event": "BorderReferendum",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "Yes",
            }
        ]
    )

    tidy = normalize_endorsements(raw)
    assert tidy.loc[0, "body_key"] == "BorderReferendum"


def test_ingest_election_data_from_workbook_like_object():
    results = pd.DataFrame(
        [
            {
                "Date": "2020-01-01",
                "Event": "AssemblyElection",
                "EventType": "DevolvedElection",
                "ElectedBody": "Northern Ireland Assembly",
                "Constituency": "Example",
                "ResultType": "Candidate",
                "Party Name": "Alliance Party of Northern Ireland",
                "Votes1": 1000,
                "Name usually known by": "Alice Example",
            },
            {
                "Date": "2020-01-01",
                "Event": "AssemblyElection",
                "EventType": "DevolvedElection",
                "ElectedBody": "Northern Ireland Assembly",
                "Constituency": "Example",
                "ResultType": "Candidate",
                "Party Name": "",
                "Party": "",
                "Votes1": 200,
                "Name usually known by": "Una Known",
            },
            {
                "Date": "2020-02-01",
                "Event": "BorderPoll",
                "EventType": "Referendum",
                "ElectedBody": "BorderReferendum",
                "Constituency": "Northern Ireland",
                "ResultType": "Answer",
                "Name usually known by": "Remain a member of the European Union",
                "Votes1": 300,
            },
        ]
    )

    endorsements = pd.DataFrame(
        [
            {
                "Date": "2020-01-15",
                "ReferendumName": "BorderPoll",
                "Party": "Alliance Party of Northern Ireland",
                "Endorsed": "Remain",
            }
        ]
    )

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        results.to_excel(writer, sheet_name="ElectionResults", index=False)
        endorsements.to_excel(writer, sheet_name="Endorsements", index=False)
    buffer.seek(0)

    xl = pd.ExcelFile(buffer)
    structured = ingest_election_data(xl, source="unit-test")

    assert not structured.constituency_results.empty
    assert not structured.nation_results.empty
    assert not structured.endorsements.empty
    assert "alliance" in structured.party_register["party_key"].tolist()
    assert "constituency::example" in structured.area_register["area_key"].tolist()
    assert any("Party rows missing" in issue for issue in structured.issues)
