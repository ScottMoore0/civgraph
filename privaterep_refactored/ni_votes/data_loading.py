import pandas as pd
import numpy as np
import re

from .data.loading import (
    load_election_results as _load_election_results,
    load_transfers_sheet as _load_transfers_sheet,
    load_endorsements as _load_endorsements,
)


def to_date_str(x):
    try:
        return pd.to_datetime(x).strftime("%Y-%m-%d")
    except Exception:
        return str(x)


def load_election_results(xl: pd.ExcelFile) -> pd.DataFrame:
    """Legacy wrapper that defers to the newer normaliser."""

    df = _load_election_results(xl)
    if "DateStr" not in df.columns and "Date" in df.columns:
        df["DateStr"] = df["Date"].apply(to_date_str)
    return df


def load_transfers_sheet(xl: pd.ExcelFile) -> pd.DataFrame:
    """Legacy wrapper that respects the configured transfer sheet order."""

    df = _load_transfers_sheet(xl)
    if not df.empty and "DateStr" not in df.columns and "Date" in df.columns:
        df["DateStr"] = df["Date"].apply(to_date_str)
    return df


def load_endorsements(xl: pd.ExcelFile) -> pd.DataFrame:
    """Legacy wrapper that ensures DateStr is present."""

    df = _load_endorsements(xl)
    if not df.empty and "DateStr" not in df.columns and "Date" in df.columns:
        df["DateStr"] = df["Date"].apply(to_date_str)
    return df
