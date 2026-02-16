"""Shared constants and helper utilities for transfer modelling."""
from __future__ import annotations

import math
import unicodedata
from typing import Any

import pandas as pd

__all__ = [
    "_DEF_KEY_DATE",
    "_DEF_KEY_CONS",
    "_DEF_KEY_BODY",
    "_TOPK_PARTIES",
    "_df_fingerprint",
    "_party_col",
    "_clean_party",
    "_infer_type_from_body",
    "_SHARE_BIN_COUNT",
    "_share_bin_label",
    "_share_combo_key",
    "infer_event_type_and_seats",
]

# Canonical column keys used across the transfer feature builders.
_DEF_KEY_DATE = "DateStr"
_DEF_KEY_CONS = "Constituency"
_DEF_KEY_BODY = "ElectedBody"

# Default number of parties to model explicitly in provenance vectors.
_TOPK_PARTIES = 12

# Number of buckets used when binning first-vs-transfer share metadata.
_SHARE_BIN_COUNT = 5


def _df_fingerprint(df: pd.DataFrame) -> int:
    """Return a lightweight fingerprint for cache invalidation."""
    try:
        return hash((id(df), tuple(df.columns), df.shape))
    except Exception:
        return id(df)


def _party_col(df: pd.DataFrame) -> str:
    """Return the best-available column name representing party labels."""
    if "Party Name" in df.columns:
        return "Party Name"
    if "Party" in df.columns:
        return "Party"
    return "Party"


def _clean_party(p: str) -> str:
    """Normalise party strings and collapse common aliases to canonical forms."""

    try:
        s = str(p)
    except Exception:
        return ""

    # Remove inline metadata such as trailing ``#`` hints that appear in some
    # source tables.
    if "#" in s:
        s = s.split("#", 1)[0]

    s = s.strip()
    if not s:
        return ""

    # Normalise Unicode characters (e.g. fancy apostrophes) and strip any
    # diacritics so that "Sinn Féin" and "Sinn Fein" collapse to the same key.
    s = unicodedata.normalize("NFKC", s)
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))

    # Collapse internal whitespace.
    s = " ".join(part for part in s.split() if part)
    if not s:
        return ""

    # Map frequent aliases onto their canonical labels using a casefolded key
    # with punctuation removed for resilience to free-text inputs.
    alias_key = "".join(ch for ch in s.casefold() if ch.isalnum())

    alias_map = {
        "sinnfein": "Sinn Fein",
        "alliancepartyofnorthernireland": "Alliance",
        "thealliancepartyofnorthernireland": "Alliance",
        "alliancepartyofnireland": "Alliance",
        "alliancenorthernireland": "Alliance",
        "allianceni": "Alliance",
    }

    if alias_key in alias_map:
        return alias_map[alias_key]

    if alias_key.endswith("ni") and alias_key.startswith("alliance"):
        return "Alliance"

    return s


def _infer_type_from_body(body: str) -> str:
    """Fallback election-type inference based on elected body text."""
    bl = str(body or "").strip().lower()
    if "assembly" in bl:
        return "Assembly"
    if "house of commons" in bl or "westminster" in bl:
        return "Westminster"
    if "european" in bl:
        return "European Parliament"
    if "council" in bl or "local" in bl:
        return "Local"
    return "Other"


def _share_bin_label(value: Any, bins: int = _SHARE_BIN_COUNT) -> str:
    """Return a stable bucket label for a share value in ``[0, 1]``."""

    try:
        v = float(value)
    except Exception:
        return "na"

    if not math.isfinite(v):
        return "na"

    v = max(0.0, min(0.999, v))
    bins = max(1, int(bins))
    idx = int(v * bins)
    return f"b{idx}"


def _share_combo_key(
    first_share: Any,
    transfer_share: Any,
    *,
    bins: int = _SHARE_BIN_COUNT,
) -> str:
    """Combine first/transfer share buckets into a single lookup key."""

    first_lbl = _share_bin_label(first_share, bins=bins)
    transf_lbl = _share_bin_label(transfer_share, bins=bins)
    if first_lbl == "na" and transf_lbl == "na":
        return ""
    return f"{first_lbl}|{transf_lbl}"


def infer_event_type_and_seats(
    er_df: pd.DataFrame, date_str: str, constituency: str
) -> Tuple[str, int]:
    """Infer the event type and seats for a given election slice."""
    df = er_df.copy()
    df["DateStr"] = df["DateStr"].astype(str)
    df["Constituency"] = df["Constituency"].astype(str)
    sub = df[(df["DateStr"] == str(date_str)) & (df["Constituency"] == str(constituency))]

    # EventType normalisation
    raw_et = str(sub["Event"].iloc[0]) if ("Event" in sub.columns and not sub.empty) else ""
    low = raw_et.lower()
    if "by" in low and "election" in low:
        et = "ByElection"
    elif "recall" in low:
        et = "RecallPetition"
    elif "referendum" in low or "poll" in low:
        et = "Referendum"
    else:
        et = "GeneralElection"

    # Seats
    seats = 1
    if "Seats" in sub.columns and not sub["Seats"].isna().all():
        try:
            seats = int(sub["Seats"].dropna().iloc[0])
        except Exception:
            pass
    elif "TotalSeats" in sub.columns and not sub["TotalSeats"].isna().all():
        try:
            seats = int(sub["TotalSeats"].dropna().iloc[0])
        except Exception:
            pass
    else:
        # estimate from elected markers if present
        try:
            if "ElectedThisRound" in sub.columns:
                seats = max(1, int(sub["ElectedThisRound"].astype(float).sum()))
        except Exception:
            seats = max(1, seats)

    return et, max(1, seats)
