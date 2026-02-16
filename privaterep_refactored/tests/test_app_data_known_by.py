from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

pd = pytest.importorskip("pandas")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ELECTIONSNI_PATH = PROJECT_ROOT / "electionsni-master"
if str(ELECTIONSNI_PATH) not in sys.path:
    sys.path.insert(0, str(ELECTIONSNI_PATH))

from app_data import ElectionSelection, WorkbookData  # type: ignore  # pylint: disable=wrong-import-position


def test_known_by_only_candidates_survive_pipeline():
    selection = ElectionSelection(
        elected_body="Assembly",
        date="2024-02-01",
        constituency="Example",
    )

    results = pd.DataFrame(
        [
            {
                "ElectedBody": "Assembly",
                "Date": date(2024, 2, 1),
                "Constituency": "Example",
                "Event": "Example Election",
                "ResultType": "Candidate",
                "PersonID": 100,
                "First Name": "Alex",
                "Last Name": "Sample",
                "Name usually known by": pd.NA,
                "Party Name": "Sample Party",
                "Outcome": "Elected",
                "Votes1": 4200,
            },
            {
                "ElectedBody": "Assembly",
                "Date": date(2024, 2, 1),
                "Constituency": "Example",
                "Event": "Example Election",
                "ResultType": "Candidate",
                "PersonID": 101,
                "First Name": pd.NA,
                "Last Name": pd.NA,
                "Name usually known by": "Dr Jane Doe OBE",
                "Party Name": "Independent",
                "Outcome": "Not elected",
                "Votes1": 3100,
            },
            {
                "ElectedBody": "Assembly",
                "Date": date(2024, 2, 1),
                "Constituency": "Example",
                "Event": "Example Election",
                "ResultType": "Quota",
                "PersonID": pd.NA,
                "First Name": pd.NA,
                "Last Name": pd.NA,
                "Name usually known by": pd.NA,
                "Party Name": pd.NA,
                "Outcome": pd.NA,
                "Votes1": 3600,
            },
        ]
    )

    transfers = pd.DataFrame(
        columns=[
            "ElectedBody",
            "Date",
            "Constituency",
            "PersonID",
            "Count",
            "ElectedThisRound",
            "EliminatedThisRound",
        ]
    )
    candidate_state = pd.DataFrame(
        columns=[
            "ElectionKey",
            "CandidateName",
            "Count",
            "TotalVotes",
            "IncomingVotesThisCount",
        ]
    )

    workbook = WorkbookData(Path("dummy.xlsx"))
    workbook._workbook = {  # type: ignore[attr-defined]
        "results": results,
        "transfers": transfers,
        "candidate_state": candidate_state,
    }

    payload = workbook.build_results_payload(selection)
    assert payload is not None

    count_group = payload["Constituency"]["countGroup"]
    known_by_entries = [row for row in count_group if row["Candidate_Id"] == "101"]
    assert known_by_entries, "Known-by-only candidate should be present in count group"

    for row in known_by_entries:
        assert row["Firstname"] == ""
        assert row["Surname"] == ""
        assert row["candidateName"] == "Dr Jane Doe OBE"

    # Ensure other candidates still populate their split names for backwards compatibility.
    split_entries = [row for row in count_group if row["Candidate_Id"] == "100"]
    assert split_entries
    for row in split_entries:
        assert row["Firstname"] == "Alex"
        assert row["Surname"] == "Sample"
        assert row["candidateName"] == "Alex Sample"
