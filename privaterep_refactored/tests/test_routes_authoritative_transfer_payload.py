from __future__ import annotations

import pytest

pd = pytest.importorskip("pandas")

from ni_votes.web.routes import _prepare_election_payload


def _sample_election_df() -> "pd.DataFrame":
    rows = [
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Candidate",
            "PersonID": 1,
            "Name": "Alice Example",
            "Party": "Alpha",
            "Votes1": 5000,
            "Votes2": 5600,
            "Outcome": "Elected",
            "Seats": 2,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Candidate",
            "PersonID": 2,
            "Name": "Bob Example",
            "Party": "Beta",
            "Votes1": 4800,
            "Votes2": 5000,
            "Outcome": "Not elected",
            "Seats": 2,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "NonTransferable",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 0,
            "Votes2": 100,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Electorate",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 20000,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Turnout",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 15000,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Valid",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 14900,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Spoiled",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 100,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Quota",
            "PersonID": None,
            "Name": "",
            "Party": "",
            "Votes1": 3000,
        },
    ]
    return pd.DataFrame(rows)


def _authoritative_lookup_payload():
    return {
        1: [
            {
                "count": 1,
                "subject_signature": "subject:1",
                "total_transferred": 100.0,
                "source": {
                    "label": "Alice Example",
                    "party": "Alpha",
                    "classification": "candidate",
                    "total_transferred": 100.0,
                    "components": [],
                    "subject_ids": [1],
                    "subject_signature": "subject:1",
                    "person_ids": [1],
                    "is_surplus": True,
                    "is_exclusion": False,
                    "raw_subject": "1",
                },
                "destinations": [
                    {
                        "name": "Bob Example",
                        "party": "Beta",
                        "amount": 80.0,
                        "type": "candidate",
                        "person_id": 2,
                        "breakdown": [],
                    },
                    {
                        "name": "Non-transferable votes",
                        "party": None,
                        "amount": 20.0,
                        "type": "non_transferable",
                        "person_id": None,
                        "breakdown": [],
                    },
                ],
            }
        ]
    }


@pytest.mark.filterwarnings("ignore::FutureWarning")
def test_prepare_payload_includes_authoritative_lookup_fields():
    df = _sample_election_df()
    lookup_key = ("2022-01-01", "DevolvedElection", "Example", "Assembly")
    authoritative_map = _authoritative_lookup_payload()
    transfer_lookup = {lookup_key: authoritative_map}

    payload = _prepare_election_payload(
        df,
        {
            "date": "2022-01-01",
            "event": "DevolvedElection",
            "constituency": "Example",
            "elected_body": "Assembly",
        },
        occurrence_map={},
        full_df=df,
        transfers_df=pd.DataFrame(),
        transfer_events_df=pd.DataFrame(),
        transfer_sources_df=pd.DataFrame(),
        transfer_destinations_df=pd.DataFrame(),
        transfer_lookup=transfer_lookup,
    )

    assert payload["authoritative_transfer_lookup"] == authoritative_map
    assert payload["authoritative_transfer_events"] == [
        {"count": 1, "events": authoritative_map[1]}
    ]

    # Ensure the lookup is detached from the cache so later mutations do not leak back.
    payload["authoritative_transfer_lookup"][1][0]["source"]["label"] = "Altered"
    assert authoritative_map[1][0]["source"]["label"] == "Alice Example"


@pytest.mark.filterwarnings("ignore::FutureWarning")
def test_prepare_payload_deduces_non_transferable_when_missing_rows():
    rows = [
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Candidate",
            "PersonID": 1,
            "Name": "Alice Example",
            "Party": "Alpha",
            "Votes1": 5000,
            "Votes2": 5090,
            "Votes3": 5200,
            "Outcome": "Elected",
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Candidate",
            "PersonID": 2,
            "Name": "Bob Example",
            "Party": "Beta",
            "Votes1": 4800,
            "Votes2": 4910,
            "Votes3": 4950,
            "Outcome": "Not elected",
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "ResultType": "Valid",
            "Votes1": 9800,
        },
    ]
    df = pd.DataFrame(rows)

    lookup_key = ("2022-01-01", "DevolvedElection", "Example", "Assembly")
    transfer_lookup = {
        lookup_key: {
            2: [
                {
                    "count": 2,
                    "subject_signature": "subject:1",
                    "total_transferred": 100.0,
                    "source": {
                        "label": "Alice Example",
                        "party": "Alpha",
                        "classification": "candidate",
                        "total_transferred": 100.0,
                        "components": [],
                        "subject_ids": [1],
                        "subject_signature": "subject:1",
                        "person_ids": [1],
                        "is_surplus": False,
                        "is_exclusion": True,
                        "raw_subject": "1",
                    },
                    "destinations": [
                        {
                            "name": "Bob Example",
                            "party": "Beta",
                            "amount": 90.0,
                            "type": "candidate",
                            "person_id": 2,
                            "breakdown": [],
                        },
                    ],
                }
            ],
            3: [
                {
                    "count": 3,
                    "subject_signature": "subject:2",
                    "total_transferred": 50.0,
                    "source": {
                        "label": "Bob Example",
                        "party": "Beta",
                        "classification": "candidate",
                        "total_transferred": 50.0,
                        "components": [],
                        "subject_ids": [2],
                        "subject_signature": "subject:2",
                        "person_ids": [2],
                        "is_surplus": False,
                        "is_exclusion": True,
                        "raw_subject": "2",
                    },
                    "destinations": [
                        {
                            "name": "Alice Example",
                            "party": "Alpha",
                            "amount": 41.0,
                            "type": "candidate",
                            "person_id": 1,
                            "breakdown": [],
                        },
                        {
                            "name": "Non-transferable",
                            "party": None,
                            "amount": 5.0,
                            "type": "non_transferable",
                            "person_id": None,
                            "breakdown": [],
                        },
                        {
                            "name": "Carol Example",
                            "party": "Gamma",
                            "amount": 4.0,
                            "type": "candidate",
                            "person_id": None,
                            "breakdown": [],
                        },
                    ],
                }
            ],
        }
    }

    payload = _prepare_election_payload(
        df,
        {
            "date": "2022-01-01",
            "event": "DevolvedElection",
            "constituency": "Example",
            "elected_body": "Assembly",
        },
        occurrence_map={},
        full_df=df,
        transfers_df=pd.DataFrame(),
        transfer_events_df=pd.DataFrame(),
        transfer_sources_df=pd.DataFrame(),
        transfer_destinations_df=pd.DataFrame(),
        transfer_lookup=transfer_lookup,
    )

    assert payload["non_transferable_by_count"] == pytest.approx([0.0, 10.0, 15.0])

