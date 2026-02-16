from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1] / "electionsni-master"))

from workbook_seat_utils import normalise_election_outcomes  # noqa: E402


def _load_candidates() -> pd.DataFrame:
    workbook = Path("Full election tables.xlsx")
    df = pd.read_excel(workbook, sheet_name="ElectionResults")
    df = normalise_election_outcomes(df)
    candidates = df[df["ResultType"] == "Candidate"].copy()
    candidates["OutcomeNorm"] = candidates.get("Outcome", pd.Series(dtype=object)).astype(str).str.strip().str.lower()
    candidates["Year"] = pd.to_datetime(candidates.get("Date"), errors="coerce").dt.year
    candidates["PersonID"] = pd.to_numeric(candidates.get("PersonID"), errors="coerce")
    return candidates


def test_seat_counts_match_expected_allocations() -> None:
    candidates = _load_candidates()
    winners = candidates[(candidates["OutcomeNorm"] == "elected") & candidates["PersonID"].notna()].copy()

    assembly = winners[winners["ElectedBody"] == "Northern Ireland Assembly"].copy()
    recent_counts = assembly[assembly["Year"].isin([2017, 2022])]
    if not recent_counts.empty:
        seats_recent = recent_counts.groupby(["Year", "Constituency"])["PersonID"].nunique()
        assert seats_recent.eq(5).all()

    post_1998 = assembly[assembly["Year"].between(1998, 2016)]
    if not post_1998.empty:
        seats_post_1998 = post_1998.groupby(["Year", "Constituency"])["PersonID"].nunique()
        assert seats_post_1998.eq(6).all()

    european = winners[winners["Event"] == "EuropeanElection"]
    if not european.empty:
        seats_euro = european.groupby(["Year", "Constituency"])["PersonID"].nunique()
        assert seats_euro.eq(3).all()

    legacy_mask = winners["ElectedBody"].isin(
        ["Northern Ireland Constitutional Convention", "Northern Ireland Assembly"]
    )
    legacy_years = winners["Year"].isin([1973, 1975, 1982])
    legacy = winners[legacy_mask & legacy_years]
    if not legacy.empty:
        seats_legacy = legacy.groupby(["Year", "Constituency"])["PersonID"].nunique()
        assert seats_legacy.min() >= 4
        assert seats_legacy.max() <= 10
