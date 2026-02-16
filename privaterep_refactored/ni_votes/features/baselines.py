import pandas as pd
from typing import Dict, Optional
from ..config import STV_EVENTS

def get_baseline_election_rows(
    er: pd.DataFrame, constituency: str, target_date: Optional[str]
) -> pd.DataFrame:
    """Return the STV election rows that underpin baseline shares.

    The selection mirrors :func:`get_baseline_party_shares` so other callers
    (e.g. referendum projections) can reuse the same election slice for
    turnout/electorate fallbacks.
    """

    cons_mask = er["Constituency"].astype(str).str.strip() == constituency
    stv = er[er["Event"].isin(STV_EVENTS) & cons_mask].copy()
    if stv.empty:
        return pd.DataFrame()

    stv["DateTS"] = pd.to_datetime(stv["DateStr"], errors="coerce")

    if target_date:
        td = pd.to_datetime(target_date, errors="coerce")
        if not pd.isna(td):
            stv_pre = stv[stv["DateTS"] <= td]
            if not stv_pre.empty:
                stv = stv_pre

    if stv.empty:
        return pd.DataFrame()

    latest_date = stv["DateTS"].max()
    latest = stv[stv["DateTS"] == latest_date].copy()
    return latest


def get_baseline_party_shares(
    er: pd.DataFrame, constituency: str, target_date: Optional[str]
) -> Dict[str, float]:
    """
    Use the most recent STV-type election on or BEFORE `target_date` for this constituency
    to estimate baseline party shares. If `target_date` is None, use the latest available STV election.
    Fallbacks:
      - If there is no election on/before `target_date`, use the latest STV election.
      - If no STV events exist for the constituency, return {}.
    Returns: dict Party -> share (sums to ~1.0).
    """

    latest = get_baseline_election_rows(er, constituency, target_date)
    if latest.empty:
        return {}

    cand = latest[latest["ResultType"] == "Candidate"].copy()
    if cand.empty or "Votes1" not in cand.columns:
        return {}

    cand["Votes1"] = pd.to_numeric(cand["Votes1"], errors="coerce").fillna(0.0)
    party_label_col = "Party Name" if "Party Name" in cand.columns else ("Party" if "Party" in cand.columns else None)
    if party_label_col is None:
        return {}

    party_sum = cand.groupby(cand[party_label_col].astype(str))["Votes1"].sum(min_count=1)
    total = float(party_sum.sum())
    if total <= 0:
        return {}

    shares = (party_sum / total).to_dict()
    # ensure float serialization and normalize defensively
    shares = {str(k): float(v) for k, v in shares.items()}
    s = sum(shares.values())
    if s > 0:
        shares = {k: v / s for k, v in shares.items()}
    return shares


def get_alltime_party_shares(er: pd.DataFrame, constituency: str, asof: Optional[str]) -> Dict[str, float]:
    """
    Average party shares across all STV elections in this constituency (optionally up to `asof` date).
    Useful as a long-run prior.
    """
    cons_mask = er["Constituency"].astype(str).str.strip() == constituency
    stv = er[er["Event"].isin(STV_EVENTS) & cons_mask].copy()
    if stv.empty:
        return {}

    stv["DateTS"] = pd.to_datetime(stv["DateStr"], errors="coerce")
    if asof:
        td = pd.to_datetime(asof, errors="coerce")
        if not pd.isna(td):
            stv = stv[stv["DateTS"] <= td]
            if stv.empty:
                return {}

    cand = stv[stv["ResultType"] == "Candidate"].copy()
    if cand.empty or "Votes1" not in cand.columns:
        return {}

    cand["Votes1"] = pd.to_numeric(cand["Votes1"], errors="coerce").fillna(0.0)
    party_label_col = "Party Name" if "Party Name" in cand.columns else ("Party" if "Party" in cand.columns else None)
    if party_label_col is None:
        return {}

    by_date = []
    for d, g in cand.groupby("DateTS"):
        s = g.groupby(g[party_label_col].astype(str))["Votes1"].sum(min_count=1)
        total = s.sum()
        if total > 0:
            by_date.append((d, (s / total).to_dict()))
    if not by_date:
        return {}

    agg: Dict[str, float] = {}
    for _, shares in by_date:
        for p, v in shares.items():
            agg[p] = agg.get(p, 0.0) + float(v)
    # average across dates
    n = float(len(by_date))
    for k in list(agg.keys()):
        agg[k] /= max(n, 1.0)
    # renormalize
    ssum = sum(agg.values())
    if ssum > 0:
        agg = {k: float(v / ssum) for k, v in agg.items()}
    return agg
