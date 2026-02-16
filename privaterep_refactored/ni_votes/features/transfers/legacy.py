"""Compatibility helpers retained for legacy CLI workflows."""
from __future__ import annotations

from typing import Optional

import pandas as pd

from .pairs import _build_pairs_stateful

__all__ = ["build_training_from_transfers_with_context"]


def build_training_from_transfers_with_context(
    tr_df: pd.DataFrame, er_df: Optional[pd.DataFrame] = None
) -> pd.DataFrame:
    """Legacy helper to derive ML-style training rows from raw transfer tables."""
    if tr_df is None or tr_df.empty or er_df is None or er_df.empty:
        return pd.DataFrame()

    pairs, _ = _build_pairs_stateful(er_df, tr_df)
    if pairs.empty:
        return pd.DataFrame()

    df = pd.DataFrame(
        {
            "DateStr": pairs["date"].astype(str),
            "Constituency": pairs["constituency"].astype(str),
            "SourceParty": pairs["donor_party"].astype(str),
            "SourcePersonID": pd.to_numeric(pairs["donor_pid"], errors="coerce").fillna(-1).astype(int),
            "DestParty": pairs["recipient_party"].astype(str),
            "Weight": pd.to_numeric(pairs.get("weight", 1.0), errors="coerce").fillna(1.0),
            "EType": pairs.get("etype", "").astype(str),
            "Body": pairs.get("body", "").astype(str),
            "Count": pd.to_numeric(pairs.get("count", 0), errors="coerce").fillna(0).astype(int),
            "don_first_share": pd.to_numeric(pairs.get("don_first_share", 0.0), errors="coerce").fillna(0.0),
            "don_transfer_share": pd.to_numeric(
                pairs.get("don_transfer_share", 0.0), errors="coerce"
            ).fillna(0.0),
            "rec_first_share": pd.to_numeric(pairs.get("rec_first_share", 0.0), errors="coerce").fillna(0.0),
            "rec_transfer_share": pd.to_numeric(
                pairs.get("rec_transfer_share", 0.0), errors="coerce"
            ).fillna(0.0),
        }
    )

    if "recipient_pid" in pairs.columns:
        df["DestPersonID"] = pd.to_numeric(pairs["recipient_pid"], errors="coerce").fillna(-1).astype(int)
    else:
        df["DestPersonID"] = -1

    return df
