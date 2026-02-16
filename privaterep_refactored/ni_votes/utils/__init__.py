# ni_votes/utils/__init__.py
from __future__ import annotations

import re
import unicodedata
import pandas as pd


def remove_redundant_national_views(
    df: pd.DataFrame,
    group_cols=("DateStr", "GroupBody"),
    constituency_col: str = "Constituency",
    national_label: str = "Northern Ireland",
) -> pd.DataFrame:
    """Drop national-level rows when finer constituencies are available."""

    if df is None or df.empty:
        return df

    required = [*group_cols, constituency_col]
    if any(col not in df.columns for col in required):
        return df

    national_pattern = rf"(?i){re.escape(national_label)}"
    cons = df[constituency_col].astype(str).str.strip()
    is_national = cons.str.fullmatch(national_pattern)
    if not is_national.any():
        return df

    def _has_specific(series: pd.Series) -> bool:
        for value in series:
            if not re.fullmatch(national_pattern, str(value or "").strip()):
                return True
        return False

    has_specific = df.groupby(list(group_cols))[constituency_col].transform(_has_specific)
    mask_drop = is_national & has_specific
    if not mask_drop.any():
        return df

    return df.loc[~mask_drop].copy()


def to_date_str(x) -> str:
    """
    Coerce a date-like value to 'YYYY-MM-DD' string if possible; otherwise str(x).
    """
    try:
        dt = pd.to_datetime(x, errors="coerce")
        if pd.isna(dt):
            return str(x)
        # If it's a Timestamp with timezone, normalise to date
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return str(x)


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize_constituency_name(x: str) -> str:
    """Light normalisation: trim whitespace and strip accents."""

    s = str(x or "").strip()
    s = re.sub(r"\s+", " ", s)
    s = _strip_accents(s)
    return s


def is_dnv_label(s: str) -> bool:
    """Identify 'Did not vote' style rows/labels."""

    lowered = str(s or "").strip().lower()
    return lowered in {
        "did not vote",
        "didn't vote",
        "did-not-vote",
        "dnv",
        "non-voters",
        "non voters",
        "nonvoters",
        "no vote",
        "no votes",
        "abstain",
        "abstained",
        "abstention",
    }


def is_spoiled_label(s: str) -> bool:
    """Return True for spoiled/invalid ballot labels."""

    return bool(
        re.search(r"(spoiled|spoilt|rejected|invalid)", str(s or ""), flags=re.I)
    )


_OPTION_ALIAS_MAP = {
    "yes": "Yes",
    "no": "No",
    "neutral": "Neutral",
    "no official position": "Neutral",
    "no official stance": "Neutral",
    "no stated position": "Neutral",
    "remain": "Remain a member of the European Union",
    "remain in the european union": "Remain a member of the European Union",
    "remain a member of the european union": "Remain a member of the European Union",
    "leave": "Leave the European Union",
    "leave the european union": "Leave the European Union",
    "did not vote": "Did not vote",
    "didn't vote": "Did not vote",
    "did-not-vote": "Did not vote",
    "no vote": "Did not vote",
    "non-voters": "Did not vote",
    "non voters": "Did not vote",
    "nonvoters": "Did not vote",
    "abstain": "Did not vote",
    "abstained": "Did not vote",
    "abstention": "Did not vote",
    "spoiled": "Spoiled",
    "spoilt": "Spoiled",
    "spoilt ballot": "Spoiled",
    "spoiled ballot": "Spoiled",
    "spoil": "Spoiled",
    "spoil ballot": "Spoiled",
    "rejected": "Spoiled",
    "invalid": "Spoiled",
}

_OPTION_NEUTRAL_TOKENS = {
    "?",
    "neutral",
    "no position",
    "no stance",
    "no official position",
    "no official stance",
    "no stated position",
}

_OPTION_DROP_TOKENS = {
    "nan",
    "none",
    "null",
    "n/a",
    "not applicable",
    "unknown",
    "-",
    "—",
}


def normalize_option_label(label: str) -> str:
    """Return a canonical option label or ``""`` when the value should be ignored."""

    try:
        text = str(label or "")
    except Exception:
        text = ""

    text = text.strip()
    if not text:
        return ""

    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text).strip()
    lowered = text.casefold()

    if lowered in _OPTION_NEUTRAL_TOKENS:
        return "Neutral"

    if lowered in _OPTION_DROP_TOKENS:
        return ""

    if re.fullmatch(r"0+", lowered):
        return ""

    alias = _OPTION_ALIAS_MAP.get(lowered)
    if alias:
        return alias

    if is_dnv_label(text):
        return "Did not vote"

    if is_spoiled_label(text):
        return "Spoiled"

    return text


def sort_option_labels(options):
    """Return unique option labels sorted with likely "Yes"-style responses first."""

    seen = set()
    unique = []
    for opt in options:
        if opt in seen:
            continue
        seen.add(opt)
        unique.append(opt)

    positive_tokens = (
        "yes",
        "remain",
        "stay",
        "approve",
        "keep",
        "support",
        "accept",
        "for",
    )
    negative_tokens = (
        "no",
        "leave",
        "reject",
        "oppose",
        "withdraw",
        "against",
    )

    def _key(opt: str):
        lower = opt.casefold()
        if is_dnv_label(opt):
            return (3, lower)
        if is_spoiled_label(opt):
            return (4, lower)
        if any(lower.startswith(token) for token in positive_tokens):
            return (0, lower)
        if any(lower.startswith(token) for token in negative_tokens):
            return (1, lower)
        return (2, lower)

    return sorted(unique, key=_key)
