import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

pd = pytest.importorskip("pandas")


def test_missing_transfer_relations_are_inferred() -> None:
    from ni_votes.features.transfers.ml_tables import _build_from_transfer_sheet

    transfers = pd.DataFrame(
        {
            "Date": ["2022-05-05"] * 3,
            "Event": ["DevolvedElection"] * 3,
            "Constituency": ["Test"] * 3,
            "ElectedBody": ["Northern Ireland Assembly"] * 3,
            "TransferParty": ["Alliance", "Alliance", "Alliance"],
            "Party": ["Alliance", "SDLP", ""],
            "TransferPartyRelation": [None, None, None],
            "Count": [1, 1, 1],
            "Transfers": [100.0, 50.0, 25.0],
            "RemainingCandidateIDsDesc": ["1,2", "1,2", "1,2"],
            "RemainingCandidatePartiesInIDOrder": [
                "Alliance,SDLP",
                "Alliance,SDLP",
                "Alliance,SDLP",
            ],
            "SourcePersonID": [123, 123, 123],
            "EliminatedThisRound": [1, 1, 1],
            "ElectedThisRound": [0, 0, 0],
        }
    )

    result = _build_from_transfer_sheet(pd.DataFrame(), transfers, scenario_dict=None)

    assert not result.empty
    assert set(result["DestParty"]) == {"Alliance", "SDLP", "__NT__"}
