"""Utilities for normalising workbook seat data and computing seat counts."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Optional, Tuple

import pandas as pd

# Seat allocations for the Northern Ireland Assembly after the 1998 agreement.
ASSEMBLY_SEATS_POST_1998: Dict[int, int] = {year: 6 for year in range(1998, 2017)}
ASSEMBLY_SEATS_POST_1998.update({2017: 5, 2022: 5})
EUROPEAN_PARLIAMENT_SEATS = 3


def _vote_column_key(column: str) -> Tuple[int, str]:
    suffix = column.replace("Votes", "")
    try:
        return (int(suffix), "")
    except ValueError:
        return (0, suffix)


def _final_votes_for_candidates(candidates: pd.DataFrame) -> pd.Series:
    vote_cols = [col for col in candidates.columns if str(col).startswith("Votes")]
    if not vote_cols:
        return pd.Series([0.0] * len(candidates), index=candidates.index)
    ordered = sorted(vote_cols, key=_vote_column_key)
    votes = candidates[ordered].apply(pd.to_numeric, errors="coerce")
    final_votes = votes.ffill(axis=1).iloc[:, -1]
    return final_votes.fillna(0.0)


def _first_valid(series: pd.Series) -> Optional[str]:
    series = series.dropna()
    if series.empty:
        return None
    return series.iloc[0]


def _expected_seats_for_group(group: pd.DataFrame) -> Optional[int]:
    year = pd.to_datetime(group["Date"], errors="coerce").dt.year.dropna()
    year_value: Optional[int] = int(year.iloc[0]) if not year.empty else None
    event = _first_valid(group.get("Event", pd.Series(dtype=object)))
    body = _first_valid(group.get("ElectedBody", pd.Series(dtype=object)))

    if isinstance(event, str) and event.strip() == "EuropeanElection":
        return EUROPEAN_PARLIAMENT_SEATS
    if isinstance(body, str) and body.strip() == "Northern Ireland Assembly" and year_value:
        seats = ASSEMBLY_SEATS_POST_1998.get(year_value)
        if seats is not None:
            return seats
    return None


def normalise_election_outcomes(frame: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of ``frame`` where candidate outcomes match expected seats."""

    if "ResultType" not in frame.columns:
        return frame.copy()

    df = frame.copy()
    candidate_mask = df["ResultType"] == "Candidate"
    if not candidate_mask.any():
        return df

    candidates = df.loc[candidate_mask].copy()
    candidates["_FinalVotes"] = _final_votes_for_candidates(candidates)
    candidates["_PersonID"] = pd.to_numeric(candidates.get("PersonID"), errors="coerce")
    candidates["_OutcomeNorm"] = (
        candidates.get("Outcome", pd.Series(dtype=object))
        .astype(str)
        .str.strip()
        .str.lower()
    )

    for election_key, group in candidates.groupby("ElectionKey"):
        expected = _expected_seats_for_group(group)
        if expected is None:
            continue
        valid = group.dropna(subset=["_PersonID"]).copy()
        if valid.empty:
            continue
        deduped = (
            valid.sort_values(["_PersonID", "_FinalVotes"], ascending=[True, False])
            .drop_duplicates(subset=["_PersonID"], keep="first")
        )
        winners = (
            deduped.sort_values(["_FinalVotes", "_PersonID"], ascending=[False, True])
            .head(expected)["_PersonID"]
            .tolist()
        )
        mask = candidates["ElectionKey"] == election_key
        is_winner = candidates["_PersonID"].isin(winners)
        candidates.loc[mask & is_winner, "Outcome"] = "Elected"
        losing_mask = mask & ~is_winner & candidates["_OutcomeNorm"].isin(
            {"", "elected", "eliminated", "not elected"}
        )
        candidates.loc[losing_mask, "Outcome"] = "Eliminated"

    df.loc[candidate_mask, "Outcome"] = candidates["Outcome"].astype(str)
    return df


def seat_counts_by_year_constituency(frame: pd.DataFrame) -> Dict[Tuple[int, str], int]:
    df = normalise_election_outcomes(frame)
    candidates = df[df["ResultType"] == "Candidate"].copy()
    candidates["_PersonID"] = pd.to_numeric(candidates.get("PersonID"), errors="coerce")
    candidates["_Year"] = pd.to_datetime(candidates.get("Date"), errors="coerce").dt.year
    outcome_norm = candidates.get("Outcome", pd.Series(dtype=object)).astype(str).str.strip().str.lower()
    elected = candidates[(outcome_norm == "elected") & candidates["_PersonID"].notna()]
    grouped = elected.groupby(["_Year", "Constituency"])["_PersonID"].nunique()
    return {(int(year), str(constituency)): int(count) for (year, constituency), count in grouped.items()}


def seat_counts_by_election(frame: pd.DataFrame) -> Dict[str, int]:
    df = normalise_election_outcomes(frame)
    candidates = df[df["ResultType"] == "Candidate"].copy()
    candidates["_PersonID"] = pd.to_numeric(candidates.get("PersonID"), errors="coerce")
    outcome_norm = candidates.get("Outcome", pd.Series(dtype=object)).astype(str).str.strip().str.lower()
    elected = candidates[(outcome_norm == "elected") & candidates["_PersonID"].notna()]
    counts = elected.groupby("ElectionKey")["_PersonID"].nunique()
    return {str(key): int(value) for key, value in counts.items()}


def build_candidate_state_lookup(candidate_state: pd.DataFrame) -> Dict[Tuple[int, str], pd.DataFrame]:
    lookup: Dict[Tuple[int, str], pd.DataFrame] = {}
    if "ElectionKey" not in candidate_state.columns:
        return lookup
    for key, group in candidate_state.groupby("ElectionKey"):
        if not isinstance(key, str):
            continue
        parts = key.split("|", 2)
        if len(parts) != 3:
            continue
        date_str, event, constituency = parts
        if event != "DevolvedElection":
            continue
        try:
            year = datetime.fromisoformat(date_str).year
        except ValueError:
            continue
        lookup[(year, constituency)] = group.copy()
    return lookup
