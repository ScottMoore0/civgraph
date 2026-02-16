from __future__ import annotations

import pytest


def _example_transfer_df(pd):
    rows = [
        # Combination donors lose votes in the same count.
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "Candidate",
            "Name": "Alice Example",
            "Party": "Party A",
            "Transfers": -300.0,
            "TransferName": "Alice Example, Bob Example",
            "TransferParty": "Party Mix",
            "TransferSubject": "100,200",
            "PersonID": 100,
            "SourcePersonID": 100,
            "EliminatedThisRound": True,
            "ElectedThisRound": False,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "Candidate",
            "Name": "Bob Example",
            "Party": "Party B",
            "Transfers": -200.0,
            "TransferName": "Alice Example, Bob Example",
            "TransferParty": "Party Mix",
            "TransferSubject": "100,200",
            "PersonID": 200,
            "SourcePersonID": 200,
            "EliminatedThisRound": True,
            "ElectedThisRound": False,
        },
        # Alice's contributions
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "Candidate",
            "Name": "Charlie Recipient",
            "Party": "Party C",
            "Transfers": 180.0,
            "TransferName": "Alice Example",
            "TransferParty": "Party A",
            "TransferSubject": "100,200",
            "PersonID": 300,
            "SourcePersonID": 100,
            "EliminatedThisRound": False,
            "ElectedThisRound": False,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "NonTransferable",
            "Name": "",
            "Party": "",
            "Transfers": 120.0,
            "TransferName": "Alice Example",
            "TransferParty": "Party A",
            "TransferSubject": "100,200",
            "PersonID": "",
            "SourcePersonID": 100,
            "EliminatedThisRound": True,
            "ElectedThisRound": False,
        },
        # Bob's contributions
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "Candidate",
            "Name": "Charlie Recipient",
            "Party": "Party C",
            "Transfers": 150.0,
            "TransferName": "Bob Example",
            "TransferParty": "Party B",
            "TransferSubject": "100,200",
            "PersonID": 300,
            "SourcePersonID": 200,
            "EliminatedThisRound": False,
            "ElectedThisRound": False,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 2,
            "ResultType": "Candidate",
            "Name": "Dana Recipient",
            "Party": "Party D",
            "Transfers": 50.0,
            "TransferName": "Bob Example",
            "TransferParty": "Party B",
            "TransferSubject": "100,200",
            "PersonID": 400,
            "SourcePersonID": 200,
            "EliminatedThisRound": False,
            "ElectedThisRound": False,
        },
        # Single-donor event for comparison.
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 3,
            "ResultType": "Candidate",
            "Name": "Daisy Donor",
            "Party": "Party E",
            "Transfers": -100.0,
            "TransferName": "Daisy Donor",
            "TransferParty": "Party E",
            "TransferSubject": "500",
            "PersonID": 500,
            "SourcePersonID": 500,
            "EliminatedThisRound": False,
            "ElectedThisRound": True,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 3,
            "ResultType": "Candidate",
            "Name": "Evan Recipient",
            "Party": "Party F",
            "Transfers": 90.0,
            "TransferName": "Daisy Donor",
            "TransferParty": "Party E",
            "TransferSubject": "500",
            "PersonID": 600,
            "SourcePersonID": 500,
            "EliminatedThisRound": False,
            "ElectedThisRound": True,
        },
        {
            "Date": "2022-01-01",
            "Event": "DevolvedElection",
            "Constituency": "Example",
            "ElectedBody": "Assembly",
            "Count": 3,
            "ResultType": "NonTransferable",
            "Name": "",
            "Party": "",
            "Transfers": 10.0,
            "TransferName": "Daisy Donor",
            "TransferParty": "Party E",
            "TransferSubject": "500",
            "PersonID": "",
            "SourcePersonID": 500,
            "EliminatedThisRound": False,
            "ElectedThisRound": True,
        },
    ]

    return pd.DataFrame(rows)


@pytest.mark.filterwarnings("ignore::FutureWarning")
def test_build_transfer_event_lookup_handles_combination_and_single_events():
    pd = pytest.importorskip("pandas")

    from ni_votes.web.transfer_data import build_transfer_event_lookup

    df = _example_transfer_df(pd)
    lookup = build_transfer_event_lookup(df)

    key = ("2022-01-01", "DevolvedElection", "Example", "Assembly")
    assert key in lookup

    combination_events = lookup[key][2]
    assert len(combination_events) == 1
    combo_event = combination_events[0]
    assert combo_event["source"]["label"] == "Alice Example, Bob Example"
    assert combo_event["source"]["classification"] == "combination"
    assert combo_event["source"]["is_exclusion"] is True
    assert combo_event["source"]["is_surplus"] is False
    assert combo_event["source"]["subject_ids"] == [100, 200]

    components = {comp["label"]: comp for comp in combo_event["source"]["components"]}
    assert pytest.approx(components["Alice Example"]["contribution"]) == 300.0
    assert pytest.approx(components["Bob Example"]["contribution"]) == 200.0

    destinations = {dest["name"]: dest for dest in combo_event["destinations"]}
    assert pytest.approx(destinations["Charlie Recipient"]["amount"]) == 330.0
    assert pytest.approx(destinations["Dana Recipient"]["amount"]) == 50.0
    non_transferable = next(dest for dest in combo_event["destinations"] if dest["type"] == "non_transferable")
    assert non_transferable["name"] == "Non-transferable votes"
    assert pytest.approx(non_transferable["amount"]) == 120.0

    charlie_breakdown = {entry["source_label"] for entry in destinations["Charlie Recipient"]["breakdown"]}
    assert charlie_breakdown == {"Alice Example", "Bob Example"}

    single_events = lookup[key][3]
    assert len(single_events) == 1
    single_event = single_events[0]
    assert single_event["source"]["classification"] == "candidate"
    assert single_event["source"]["label"] == "Daisy Donor"
    assert pytest.approx(single_event["destinations"][0]["amount"]) == 90.0
    assert single_event["destinations"][0]["type"] == "candidate"
    assert single_event["source"]["is_surplus"] is True


@pytest.mark.filterwarnings("ignore::FutureWarning")
def test_get_transfer_events_for_election_returns_isolated_copy():
    pd = pytest.importorskip("pandas")

    from ni_votes.web.transfer_data import (
        build_transfer_event_lookup,
        get_transfer_events_for_election,
    )

    df = _example_transfer_df(pd)
    lookup = build_transfer_event_lookup(df)

    key = ("2022-01-01", "DevolvedElection", "Example", "Assembly")
    events = get_transfer_events_for_election(lookup, key)

    assert events
    assert sorted(events.keys()) == [2, 3]
    assert all(isinstance(count, int) for count in events)

    # Ensure deep copy behaviour – mutating the result should not affect the cache.
    events[2][0]["source"]["label"] = "Changed"
    assert lookup[key][2][0]["source"]["label"] == "Alice Example, Bob Example"

    # Unknown elections should yield an empty mapping.
    missing = get_transfer_events_for_election(lookup, ("1900-01-01", "", "", ""))
    assert missing == {}
