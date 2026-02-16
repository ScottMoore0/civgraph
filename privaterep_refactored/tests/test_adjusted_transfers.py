from __future__ import annotations

from pathlib import Path

import pytest

pd = pytest.importorskip("pandas")

from ni_votes.adjusted_transfers import build_adjusted_transfers, write_adjusted_transfers
from ni_votes.features.transfers.pairs import _build_pairs_stateful


def _df(rows):
    columns = [
        "Date",
        "Event",
        "Constituency",
        "ElectedBody",
        "Count",
        "ResultType",
        "PersonID",
        "Name",
        "Party",
        "Votes",
        "Transfers",
        "TransferSubject",
        "TransferName",
        "TransferParty",
    ]
    return pd.DataFrame(rows, columns=columns)


def test_build_adjusted_transfers_splits_combo(tmp_path: Path) -> None:
    base_rows = [
        # Single-donor history for calibration
        ["2020-01-01", "Test", "X", "Body", 0, "Transfer", 10003, "Dest", "DestParty", 0, 60, "10001", "Donor A", "PartyA"],
        ["2020-01-01", "Test", "X", "Body", 0, "Transfer", 10003, "Dest", "DestParty", 0, 40, "10002", "Donor B", "PartyB"],
        # Negative rows showing elimination tallies
        ["2020-01-01", "Test", "X", "Body", 1, "Transfer", 10001, "Donor A", "PartyA", 300, -300, "", "", ""],
        ["2020-01-01", "Test", "X", "Body", 1, "Transfer", 10002, "Donor B", "PartyB", 200, -200, "", "", ""],
        # Combination positive row to be decomposed
        [
            "2020-01-01",
            "Test",
            "X",
            "Body",
            1,
            "Transfer",
            10003,
            "Dest",
            "DestParty",
            0,
            400,
            "10001,10002",
            "Donor A,Donor B",
            "PartyA,PartyB",
        ],
    ]

    df = _df(base_rows)
    adjusted = build_adjusted_transfers(df)

    assert "DonorTransferPct" in adjusted.columns
    assert "DonorTransferTotal" in adjusted.columns

    combo_rows = adjusted[(adjusted["Count"] == 1) & (adjusted["PersonID"] == 10003)]
    assert len(combo_rows) == 2
    assert set(combo_rows["TransferSubject"]) == {"10001", "10002"}
    assert abs(combo_rows["Transfers"].sum() - 400) < 1e-6
    # each donor supplied 80% of their tally to the destination in this synthetic example
    assert all(abs(pct - 80.0) < 1e-6 for pct in combo_rows["DonorTransferPct"].dropna())
    assert set(round(float(total), 6) for total in combo_rows["DonorTransferTotal"].dropna()) == {-300.0, -200.0}

    # Ensure single-donor rows are untouched
    single_rows = adjusted[adjusted["TransferSubject"] == "10001"]
    assert not single_rows.empty
    assert abs(single_rows.iloc[0]["Transfers"] - 60) < 1e-6
    assert abs(single_rows.iloc[0]["DonorTransferTotal"] + 300.0) < 1e-6

    # Negative self-transfer rows should keep their totals and reference the donor explicitly
    neg_row = adjusted[(adjusted["Count"] == 1) & (adjusted["PersonID"] == 10001) & (adjusted["Transfers"] < 0)]
    assert not neg_row.empty
    assert set(neg_row["TransferSubject"]) == {"10001"}

    out_path = tmp_path / "AdjustedTransfers.xlsx"
    write_adjusted_transfers(adjusted, out_path)
    assert out_path.exists()
    assert out_path.stat().st_size > 0


def test_combo_negative_uses_vote_hint_when_total_missing() -> None:
    df = _df(
        [
            [
                "2020-02-02",
                "Test",
                "X",
                "Body",
                1,
                "Candidate",
                99999,
                "Dest",
                "DestParty",
                15764,
                0.0,
                "10001,10002",
                "Donor A,Donor B",
                "PartyA,PartyB",
            ]
        ]
    )

    adjusted = build_adjusted_transfers(df)

    neg_rows = adjusted[(adjusted["PersonID"] == 10001) & (adjusted["TransferSubject"] == "10001")]
    assert not neg_rows.empty
    assert pytest.approx(float(neg_rows.iloc[0]["Transfers"]), rel=1e-6) == -15764.0
    assert pytest.approx(float(neg_rows.iloc[0]["DonorTransferTotal"]), rel=1e-6) == -15764.0


def test_non_transferable_rows_receive_donor_percentages() -> None:
    rows = [
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            0,
            "Transfer",
            10003,
            "Dest",
            "DestParty",
            0,
            70,
            "10001",
            "Donor A",
            "PartyA",
        ],
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            0,
            "Transfer",
            10003,
            "Dest",
            "DestParty",
            0,
            30,
            "10002",
            "Donor B",
            "PartyB",
        ],
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            1,
            "Transfer",
            10001,
            "Donor A",
            "PartyA",
            120,
            -120,
            "",
            "",
            "",
        ],
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            1,
            "Transfer",
            10002,
            "Donor B",
            "PartyB",
            80,
            -80,
            "",
            "",
            "",
        ],
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            1,
            "Transfer",
            10003,
            "Dest",
            "DestParty",
            0,
            140,
            "10001,10002",
            "Donor A,Donor B",
            "PartyA,PartyB",
        ],
        [
            "2020-03-03",
            "Test",
            "X",
            "Body",
            1,
            "NonTransferable",
            None,
            "",
            "",
            0,
            60,
            "10001,10002",
            "Donor A,Donor B",
            "PartyA,PartyB",
        ],
    ]

    adjusted = build_adjusted_transfers(_df(rows))

    combo = adjusted[(adjusted["Count"] == 1) & (adjusted["Transfers"] >= 0)]
    combo_total = sum(
        abs(float(adjusted[(adjusted["TransferSubject"] == donor) & (adjusted["Transfers"] < 0)]["Transfers"].iloc[0]))
        for donor in ("10001", "10002")
    )
    for donor in ("10001", "10002"):
        donor_rows = combo[combo["TransferSubject"] == donor]
        assert not donor_rows.empty

        neg_row = adjusted[
            (adjusted["PersonID"] == int(donor)) & (adjusted["Transfers"] < 0)
        ].iloc[0]
        denom = abs(float(neg_row["Transfers"]))

        nt_rows = donor_rows[donor_rows["PersonID"].isna()]
        assert not nt_rows.empty
        assert nt_rows["TransferPct"].notna().all()
        nt_pct = float(nt_rows.iloc[0]["DonorTransferPct"])
        nt_amount = float(nt_rows.iloc[0]["Transfers"])
        assert pytest.approx(nt_pct, rel=1e-6) == pytest.approx((nt_amount / denom) * 100.0, rel=1e-6)
        assert pytest.approx(float(nt_rows.iloc[0]["DonorTransferTotal"]), rel=1e-6) == -denom
        assert float(nt_rows.iloc[0]["Votes"]) == 0.0
        nt_combo_pct = float(nt_rows.iloc[0]["TransferPct"])
        assert pytest.approx(nt_combo_pct, rel=1e-6) == pytest.approx((abs(nt_amount) / combo_total) * 100.0, rel=1e-6)
        total_pct = float(donor_rows["DonorTransferPct"].sum())
        assert pytest.approx(total_pct, rel=1e-6) == 100.0

def test_pair_builder_respects_single_donor_rows() -> None:
    er = pd.DataFrame(
        {
            "DateStr": ["2022-01-01"] * 4,
            "Constituency": ["Test"] * 4,
            "ElectedBody": ["Assembly"] * 4,
            "ResultType": ["Candidate"] * 4,
            "PersonID": [10001, 10002, 10003, 10004],
            "Party": ["UUP", "SDLP", "SF", "Alliance"],
            "Votes1": [1200, 1100, 900, 800],
            "Name": ["Donor A", "Donor B", "Recipient C", "Recipient D"],
        }
    )

    tr = pd.DataFrame(
        [
            {
                "DateStr": "2022-01-01",
                "Constituency": "Test",
                "ElectedBody": "Assembly",
                "Count": 1,
                "ResultType": "Candidate",
                "PersonID": 10001,
                "Name": "Donor A",
                "Party": "UUP",
                "Votes": 0,
                "Transfers": -120.0,
                "TransferSubject": "",
                "TransferName": "",
                "TransferParty": "",
            },
            {
                "DateStr": "2022-01-01",
                "Constituency": "Test",
                "ElectedBody": "Assembly",
                "Count": 1,
                "ResultType": "Candidate",
                "PersonID": 10002,
                "Name": "Donor B",
                "Party": "SDLP",
                "Votes": 0,
                "Transfers": -80.0,
                "TransferSubject": "",
                "TransferName": "",
                "TransferParty": "",
            },
            {
                "DateStr": "2022-01-01",
                "Constituency": "Test",
                "ElectedBody": "Assembly",
                "Count": 1,
                "ResultType": "Candidate",
                "PersonID": 10003,
                "Name": "Recipient C",
                "Party": "SF",
                "Votes": 0,
                "Transfers": 90.0,
                "TransferSubject": "10001",
                "TransferName": "Donor A",
                "TransferParty": "UUP",
            },
            {
                "DateStr": "2022-01-01",
                "Constituency": "Test",
                "ElectedBody": "Assembly",
                "Count": 1,
                "ResultType": "Candidate",
                "PersonID": 10004,
                "Name": "Recipient D",
                "Party": "Alliance",
                "Votes": 0,
                "Transfers": 30.0,
                "TransferSubject": "10001",
                "TransferName": "Donor A",
                "TransferParty": "UUP",
            },
            {
                "DateStr": "2022-01-01",
                "Constituency": "Test",
                "ElectedBody": "Assembly",
                "Count": 1,
                "ResultType": "Candidate",
                "PersonID": 10003,
                "Name": "Recipient C",
                "Party": "SF",
                "Votes": 0,
                "Transfers": 80.0,
                "TransferSubject": "10002",
                "TransferName": "Donor B",
                "TransferParty": "SDLP",
            },
        ]
    )

    pairs, _ = _build_pairs_stateful(er, tr)
    assert not pairs.empty

    combo_rows = pairs[pairs["donor_pid"].astype(str).str.startswith("combo:")]
    assert combo_rows.empty, "Bundled donors should not be inferred when rows already specify sources"

    donor_ids = set(pairs[pairs["recipient_party"] != "NonTransferable"]["donor_pid"].tolist())
    assert {10001, 10002}.issubset(donor_ids)

    weight_10001 = pairs[pairs["donor_pid"] == 10001]["weight"].iloc[0]
    assert pytest.approx(weight_10001, rel=1e-6) == 120.0

    weight_10002 = pairs[pairs["donor_pid"] == 10002]["weight"].iloc[0]
    assert pytest.approx(weight_10002, rel=1e-6) == 80.0
