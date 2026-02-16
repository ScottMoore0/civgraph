# ni_votes/utils.py
import re
import unicodedata

import pandas as pd
import numpy as np

def to_date_str(x) -> str:
    try:
        return pd.to_datetime(x).strftime("%Y-%m-%d")
    except Exception:
        return str(x)

def parse_ids_csv(s):
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return []
    parts = [p.strip() for p in str(s).split(",") if p.strip()]
    out = []
    for p in parts:
        p2 = re.sub(r"[^\d.]+", "", p)
        if p2:
            try:
                out.append(int(float(p2)))
            except Exception:
                pass
    return out

def split_csv(s):
    if s is None or (isinstance(s, float) and np.isnan(s)):
        return []
    return [p.strip() for p in str(s).split(",") if p.strip()]

def normalize_constituency_name(c: str) -> str:
    return re.sub(r"\s+", " ", str(c or "")).strip()

def is_dnv_label(x: str) -> bool:
    s = str(x or "").strip().lower()
    return s in {
        "did not vote",
        "didn't vote",
        "did-not-vote",
        "non-voters",
        "non voters",
        "nonvoters",
        "no vote",
        "no votes",
        "abstain",
        "abstained",
        "abstention",
    }


def is_spoiled_label(x: str) -> bool:
    s = str(x or "").strip().lower()
    return bool(re.search(r"(spoiled|spoilt|rejected|invalid)", s))


_OPTION_ALIAS_MAP = {
    "yes": "Yes",
    "no": "No",
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

_OPTION_DROP_TOKENS = {
    "",
    "nan",
    "none",
    "null",
    "?",
    "n/a",
    "not applicable",
    "no position",
    "no stance",
    "neutral",
    "unknown",
    "-",
    "—",
}


def normalize_option_label(label: str) -> str:
    """Return a canonical option label or ``""`` when the value should be dropped."""

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
    """Return a sorted list of unique option labels (DNV last)."""

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

    def _sort_key(opt: str):
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

    return sorted(unique, key=_sort_key)


def remove_redundant_national_views(
    df: pd.DataFrame,
    group_cols=("DateStr", "GroupBody"),
    constituency_col: str = "Constituency",
    national_label: str = "Northern Ireland",
) -> pd.DataFrame:
    """Drop national-level rows when more granular constituencies are available.

    Many workbooks include an overall "Northern Ireland" constituency alongside
    per-constituency breakdowns for the same referendum date/body. These rows
    should be treated as an alternate view rather than an additional sample, so
    we strip them out during data preparation when finer detail is present.

    Parameters
    ----------
    df:
        DataFrame containing referendum-like rows.
    group_cols:
        Columns identifying a unique referendum grouping (defaults to
        (DateStr, GroupBody)).
    constituency_col:
        Column name that stores the constituency string.
    national_label:
        The label that should be considered the national-level view.
    """

    if df is None or df.empty:
        return df

    missing = [c for c in (*group_cols, constituency_col) if c not in df.columns]
    if missing:
        return df

    cons = df[constituency_col].astype(str).str.strip()
    national_pattern = rf"(?i){re.escape(national_label)}"
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
