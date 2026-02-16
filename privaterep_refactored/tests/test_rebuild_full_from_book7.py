import sys
from pathlib import Path

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from rebuild_full_from_book7 import (  # noqa: E402
    build_events_sources_dests,
    load_book7,
    melt_transfers_from_er,
    normalise_transfer_relations,
)
from rebuild_from_book7 import rebuild_core  # noqa: E402
from ni_votes.adjusted_transfers import build_adjusted_transfers  # noqa: E402


BOOK7 = Path("Book7.xlsx")


def test_rebuild_pipeline_preserves_donor_metadata():
    er, _, _ = load_book7(BOOK7)
    transfers_long, _ = melt_transfers_from_er(er)
    transfers_long = normalise_transfer_relations(transfers_long)

    (
        transfer_events,
        transfer_sources,
        transfer_destinations,
        transfers,
        _,
        _,
    ) = build_events_sources_dests(er, transfers_long)

    # Raw transfers should include donor rows with negative totals and relation tags.
    assert len(transfers) == 14081
    assert (transfers["Transfers"] < 0).sum() == 1708
    relations = set(transfers["TransferPartyRelation"].dropna().unique())
    assert relations == {"Same party", "Different party", "NonTransferable", "Outgoing"}

    adjusted = build_adjusted_transfers(transfers)
    assert len(adjusted) == 17943
    assert (adjusted["Transfers"] < 0).sum() == 1243
    assert adjusted["DonorTransferTotal"].notna().all()
    adjusted_rel = set(adjusted["TransferPartyRelation"].dropna().unique())
    assert adjusted_rel == {"Same party", "Different party", "NonTransferable", "Outgoing"}

    dest_types = set(transfer_destinations["TransferType"].unique())
    assert dest_types == {"SameParty", "DifferentParty", "NonTransferable"}

    # Sanity check that donor labels survive the merge step.
    assert transfer_sources["SourceCandidateID"].notna().all()
    assert transfer_events["TotalSourceVotesMoved"].gt(0).any()


def test_rebuild_from_book7_outputs_donor_rows(tmp_path: Path) -> None:
    out = tmp_path / "Book7_rebuilt.xlsx"
    rebuild_core(BOOK7, Path("Full election tables (5).xlsx"), output=out)

    adjusted = pd.read_excel(out, sheet_name="AdjustedTransfers")
    assert len(adjusted) == 17943
    assert (adjusted["Transfers"] < 0).sum() == 1243
    rel = set(adjusted["TransferPartyRelation"].dropna().unique())
    assert rel == {"Same party", "Different party", "NonTransferable", "Outgoing"}

    transfers = pd.read_excel(out, sheet_name="Transfers")
    assert len(transfers) == 14081
    assert (transfers["Transfers"] < 0).sum() == 1708

    destinations = pd.read_excel(out, sheet_name="TransferDestinations")
    assert set(destinations["TransferType"].unique()) == {
        "SameParty",
        "DifferentParty",
        "NonTransferable",
    }
