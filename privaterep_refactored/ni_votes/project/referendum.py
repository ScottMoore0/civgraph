"""
Referendum projection utilities.

This module contains the *real* referendum feature-building and projection
functions used by the CLI. Do NOT import from this module inside itself.
(Any shim to preserve old import paths must live in ni_votes/features/referendum.py)
"""

from typing import List, Dict, Tuple, Optional, Sequence, Mapping, Iterable
import re
import numpy as np
import pandas as pd

from ..features.referendum_ml_features_fast import FastReferendumFeatureEngineer
from ..config import (
    REFERENDUM_TYPES,
    TARGET_DATE,
    STV_EVENTS,
    REFERENDUM_BODY_ELECTION_FAMILIES,
    REFERENDUM_EVENT_TYPE_FAMILIES,
)
from ..utils import (
    to_date_str,
    normalize_constituency_name,
    is_dnv_label,
    is_spoiled_label,
    normalize_option_label,
    sort_option_labels,
    remove_redundant_national_views,
)
from ..features.baselines import get_baseline_party_shares, get_baseline_election_rows
from ..features.endorsements import (
    EndorsementSnapshot,
    build_endorsement_history,
    resolve_endorsements_for_date,
    normalize_party_key,
)
from .party_breakdown import build_party_breakdown, merge_party_breakdowns

NON_PARTICIPANT_BASELINE_LABEL = "Did not vote"
SPOILED_BASELINE_LABEL = "Spoiled"

# Prefer the model-level helpers if available; otherwise provide safe fallbacks.
try:
    from ..models_referendum import (
        turnout_prior,
        compute_constituency_totals,
    )
except Exception:
    def turnout_prior(er, constituency: str, date_str: str) -> float:
        # conservative default turnout prior
        return 0.65

    def compute_constituency_totals(er_group: pd.DataFrame, event: str, elected_body: str) -> Dict[str, float]:
        # minimal fallback; real implementation should live in models_referendum
        return {
            "electorate": float("nan"),
            "valid_total": float("nan"),
            "spoiled": 0.0,
            "did_not_vote": float("nan"),
        }

# ---- real functions start below (define: filter_referendum_rows, infer_body_options,
#      build_referendum_features_for_group, project_referendum, etc.) ----
# -----------------------------
# Referendum detection / filters
# -----------------------------
def filter_referendum_rows(er: pd.DataFrame) -> pd.DataFrame:
    """
    Return rows in ElectionResults that look like referendum / recall data.
    We check EventType against REFERENDUM_TYPES, and also look for telltale
    option labels in 'Name usually known by'.
    """
    df = er.copy()

    # By EventType if present
    et = df.get("EventType", pd.Series("", index=df.index)).astype(str).str.lower()
    by_et = et.isin([t.lower() for t in REFERENDUM_TYPES])

    # By option labels (Yes/No/Remain/Leave/Did not vote)
    optcol = df.get("Name usually known by", pd.Series("", index=df.index)).astype(str).str.strip().str.lower()
    by_opt = optcol.isin(
        {
            "yes",
            "no",
            "remain",
            "leave",
            "remain in the european union",
            "leave the european union",
            "did not vote",
            "dnv",
            "abstain",
        }
    )

    # By textual match in Event / ElectedBody (fallback)
    ev = df.get("Event", pd.Series("", index=df.index)).astype(str).str.lower()
    eb = df.get("ElectedBody", pd.Series("", index=df.index)).astype(str).str.lower()
    by_text = ev.str.contains(r"referendum", na=False) | eb.str.contains(r"referendum", na=False)

    base_mask = by_et | by_opt | by_text
    recall_mask = (
        et.str.contains("recall", na=False)
        | ev.str.contains("recall", na=False)
        | eb.str.contains("recall", na=False)
    )

    mask = base_mask & ~recall_mask
    out = df[mask].copy()

    # Make a stable "GroupBody" key we can use for grouping
    gb = out.get("ElectedBody", pd.Series("", index=out.index)).astype(str)
    gb_blank = gb.str.strip().eq("") | gb.str.lower().isin({"nan", "none"})
    out["GroupBody"] = gb.mask(gb_blank, out.get("Event", pd.Series("", index=out.index)).astype(str))

    # Normalise DateStr just in case
    out["DateStr"] = out.get("DateStr", out.get("Date", pd.Series("", index=out.index))).apply(to_date_str)

    return remove_redundant_national_views(out)


# -----------------------------
# Option inference for a body
# -----------------------------
def infer_body_options(er: pd.DataFrame,
                       endorsements: Optional[pd.DataFrame],
                       body_key: str) -> List[str]:
    """
    Determine which option labels should be shown for a referendum 'body'.
    Priority:
      1) If real rows exist in ElectionResults for this body -> use those options (+ 'Did not vote').
      2) Else if endorsements exist -> use endorsed options (+ 'Did not vote').
      3) Else -> default to ['Yes', 'No', 'Did not vote'].
    """
    ref = filter_referendum_rows(er)

    if not ref.empty:
        body_match = (ref["GroupBody"].astype(str) == str(body_key)) | \
                     (ref.get("ElectedBody", "").astype(str) == str(body_key)) | \
                     (ref.get("Event", "").astype(str) == str(body_key))
        sub = ref[body_match]
        if not sub.empty and "Name usually known by" in sub.columns:
            collected = []
            for raw in sub["Name usually known by"].astype(str).tolist():
                label = normalize_option_label(raw)
                if not label or is_dnv_label(label) or is_spoiled_label(label):
                    continue
                collected.append(label)
            opts = sort_option_labels(collected)
            if opts:
                if not any(is_dnv_label(opt) for opt in opts):
                    opts.append("Did not vote")
                return opts

    if endorsements is not None and not endorsements.empty:
        en = endorsements.copy()
        if "BodyKey" not in en.columns:
            # try to build BodyKey
            body_col = None
            for c in ["ElectedBody", "ReferendumName", "Body", "PollName"]:
                if c in en.columns:
                    body_col = c
                    break
            en["BodyKey"] = en[body_col].astype(str) if body_col else ""
        en_body = en[en["BodyKey"].astype(str) == str(body_key)]
        if not en_body.empty:
            collected = []
            for raw in en_body.get("EndorsedClean", "").astype(str).tolist():
                label = normalize_option_label(raw)
                if not label or is_dnv_label(label) or is_spoiled_label(label):
                    continue
                collected.append(label)
            opts = sort_option_labels(collected)
            if opts:
                if not any(is_dnv_label(opt) for opt in opts):
                    opts.append("Did not vote")
                return opts

    return ["Yes", "No", "Did not vote"]


def _coerce_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _coerce_numeric_series(values: object) -> pd.Series:
    """Return a numeric Series regardless of scalar/iterable input."""

    if isinstance(values, pd.Series):
        return pd.to_numeric(values, errors="coerce")

    if values is None:
        return pd.Series(dtype=float)

    if isinstance(values, np.ndarray):
        base = pd.Series(values)
    elif isinstance(values, Iterable) and not isinstance(values, (str, bytes)):
        base = pd.Series(list(values))
    else:
        base = pd.Series([values])

    return pd.to_numeric(base, errors="coerce")


def _total_value_missing(value) -> bool:
    if value is None:
        return True
    try:
        return not np.isfinite(float(value))
    except (TypeError, ValueError):
        return True


def _ensure_total_consistency(totals: Dict[str, float]) -> Dict[str, float]:
    updated = dict(totals)
    electorate = _coerce_float(updated.get("electorate"))
    valid_total = _coerce_float(updated.get("valid_total"))
    spoiled = _coerce_float(updated.get("spoiled", 0.0))
    dnv = _coerce_float(updated.get("did_not_vote"))
    if not np.isfinite(spoiled):
        spoiled = 0.0

    if not np.isfinite(electorate):
        pieces: List[float] = []
        if np.isfinite(valid_total):
            pieces.append(float(valid_total))
        if np.isfinite(spoiled):
            pieces.append(float(spoiled))
        if np.isfinite(dnv):
            pieces.append(float(dnv))
        if pieces:
            electorate = float(sum(pieces))
            updated["electorate"] = electorate

    if np.isfinite(electorate) and np.isfinite(valid_total):
        turnout = float(valid_total) + float(spoiled)
        did_not_vote = float(electorate) - turnout
        if did_not_vote < 0:
            did_not_vote = 0.0
        updated["electorate"] = float(electorate)
        updated["valid_total"] = float(valid_total)
        updated["spoiled"] = float(spoiled)
        updated["did_not_vote"] = float(did_not_vote)
    return updated


def _fallback_totals_with_baseline(
    er: pd.DataFrame, constituency: str, date_use: str, totals: Dict[str, float]
) -> Dict[str, float]:
    updated = _ensure_total_consistency(dict(totals))
    if not (
        _total_value_missing(updated.get("electorate"))
        or _total_value_missing(updated.get("valid_total"))
    ):
        return updated

    baseline_rows = get_baseline_election_rows(er, constituency, date_use)
    if baseline_rows.empty:
        return _ensure_total_consistency(updated)

    event_val = ""
    if "Event" in baseline_rows.columns and not baseline_rows["Event"].empty:
        event_val = str(baseline_rows["Event"].iloc[0])
    body_val = ""
    if "ElectedBody" in baseline_rows.columns and not baseline_rows["ElectedBody"].empty:
        body_val = str(baseline_rows["ElectedBody"].iloc[0])

    fallback = dict(compute_constituency_totals(baseline_rows, event=event_val, elected_body=body_val))

    fallback_electorate = fallback.get("electorate")
    if _total_value_missing(fallback_electorate):
        total = 0.0
        seen = False
        for key in ("valid_total", "spoiled", "did_not_vote"):
            value = fallback.get(key)
            if _total_value_missing(value):
                continue
            total += float(value)
            seen = True
        if seen:
            fallback["electorate"] = total

    for key, value in fallback.items():
        if _total_value_missing(updated.get(key)):
            updated[key] = value

    return _ensure_total_consistency(updated)


def _resolve_breakdown_families(event_type: Optional[str], elected_body: Optional[str]) -> List[str]:
    event_fams: List[str] = []
    body_fams: List[str] = []

    if event_type:
        key = str(event_type).strip().casefold()
        mapped = REFERENDUM_EVENT_TYPE_FAMILIES.get(key)
        if mapped:
            event_fams.extend(mapped)
        else:
            text = str(event_type).strip()
            if text:
                event_fams.append(text)

    if elected_body:
        key = str(elected_body).strip().casefold()
        mapped = REFERENDUM_BODY_ELECTION_FAMILIES.get(key)
        if mapped:
            body_fams.extend(mapped)
        else:
            text = str(elected_body).strip()
            if text:
                body_fams.append(text)

    event_fams = _dedupe_families(event_fams)
    body_fams = _dedupe_families(body_fams)

    if body_fams:
        allowed = {fam for fam in body_fams if fam}
        families = list(body_fams)
        for fam in event_fams:
            if allowed and fam not in allowed:
                continue
            if fam and fam not in families:
                families.append(fam)
    else:
        families = list(event_fams)

    if not families:
        fallback = str(event_type or "DevolvedElection").strip() or "DevolvedElection"
        families = [fallback]

    return _dedupe_families(families)


def _dedupe_families(values: Sequence[str]) -> List[str]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for value in values:
        text = str(value).strip()
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def _filter_rows_for_family(df: pd.DataFrame, family: str) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()

    fam_key = str(family or "").strip()
    if not fam_key:
        return pd.DataFrame()

    fam_norm = fam_key.casefold()
    event_type_series = df.get("EventType", pd.Series("", index=df.index)).astype(str).str.strip()
    event_series = df.get("Event", pd.Series("", index=df.index)).astype(str).str.strip()
    body_series = df.get("ElectedBody", pd.Series("", index=df.index)).astype(str).str.strip()

    event_type_norm = event_type_series.str.casefold()
    event_norm = event_series.str.casefold()
    body_norm = body_series.str.casefold()

    mask = event_type_norm.eq(fam_norm) | event_norm.eq(fam_norm) | body_norm.eq(fam_norm)
    if not mask.any():
        return pd.DataFrame()
    return df[mask].copy()


def _pick_latest_rows(df: pd.DataFrame, target_ts: pd.Timestamp) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()

    working = df.copy()
    if "DateTS" not in working.columns:
        working["DateTS"] = pd.to_datetime(working.get("DateStr"), errors="coerce")

    if target_ts is not None and not pd.isna(target_ts):
        before = working[working["DateTS"] <= target_ts]
        if not before.empty:
            working = before

    if working.empty:
        return pd.DataFrame()

    latest_ts = working["DateTS"].max()
    return working[working["DateTS"] == latest_ts].copy()


def _rows_to_party_share(df: pd.DataFrame) -> Tuple[Dict[str, float], Dict[str, object]]:
    if df.empty:
        return {}, {}

    result_type = df.get("ResultType", pd.Series("", index=df.index)).astype(str).str.strip()
    mask = result_type.str.casefold() == "candidate"
    cand = df[mask].copy()
    if cand.empty:
        return {}, {}

    if "Votes1" in cand.columns:
        votes_series = pd.to_numeric(cand["Votes1"], errors="coerce").fillna(0.0)
    else:
        votes_series = pd.to_numeric(cand.get("Votes"), errors="coerce").fillna(0.0)

    party_col = None
    for candidate in ("Party Name", "Party", "Source Party Name"):
        if candidate in cand.columns:
            party_col = candidate
            break
    if party_col is None:
        return {}, {}

    party_series = cand[party_col].astype(str).str.strip()
    grouped = votes_series.groupby(party_series).sum(min_count=1)
    total_votes = float(grouped.sum())
    if total_votes <= 0:
        return {}, {}

    shares = {str(party): float(v / total_votes) for party, v in grouped.items() if total_votes > 0}

    date_series = df.get("DateTS")
    if date_series is not None and not date_series.empty:
        date_ts = date_series.iloc[0]
    else:
        parsed = pd.to_datetime(df.get("DateStr"), errors="coerce")
        date_ts = parsed.iloc[0] if isinstance(parsed, pd.Series) and not parsed.empty else pd.NaT

    electorate_series = _coerce_numeric_series(df.get("Electorate"))
    electorate_val = None
    if not electorate_series.empty:
        valid_values = electorate_series.dropna()
        if not valid_values.empty:
            electorate_val = float(valid_values.iloc[0])

    turnout_ratio = None
    if electorate_val is not None and electorate_val > 0:
        turnout_ratio = float(total_votes) / float(electorate_val)
        if turnout_ratio < 0:
            turnout_ratio = 0.0
        elif turnout_ratio > 1:
            turnout_ratio = 1.0

    other_rows = df[~mask].copy()
    result_type_all = other_rows.get("ResultType", pd.Series("", index=other_rows.index)).astype(str).str.strip()

    def _sum_votes(block: pd.DataFrame) -> float:
        if block.empty:
            return 0.0
        for col in ("Votes1", "Votes"):
            if col in block.columns:
                series = pd.to_numeric(block[col], errors="coerce")
                if not series.empty:
                    return float(series.fillna(0.0).sum())
        return 0.0

    spoiled_mask = result_type_all.str.contains("spoil", case=False, na=False)
    spoiled_total = _sum_votes(other_rows[spoiled_mask])

    abstain_mask = result_type_all.str.contains(
        r"did not vote|not vote|abstain|abstention", case=False, na=False
    )
    abstain_total = _sum_votes(other_rows[abstain_mask])

    spoiled_share = None
    abstain_share = None
    if electorate_val is not None and electorate_val > 0:
        if np.isfinite(spoiled_total) and spoiled_total > 0:
            spoiled_share = float(np.clip(spoiled_total / float(electorate_val), 0.0, 1.0))
        if np.isfinite(abstain_total) and abstain_total > 0:
            abstain_share = float(np.clip(abstain_total / float(electorate_val), 0.0, 1.0))

    meta = {
        "date": to_date_str(date_ts) if not pd.isna(date_ts) else "",
        "date_ts": date_ts,
        "event": str(df.get("Event", "").iloc[0]) if "Event" in df.columns and not df.empty else "",
        "event_type": str(df.get("EventType", "").iloc[0]) if "EventType" in df.columns and not df.empty else "",
        "elected_body": str(df.get("ElectedBody", "").iloc[0]) if "ElectedBody" in df.columns and not df.empty else "",
        "electorate": electorate_val,
        "votes_total": total_votes,
        "turnout_ratio": turnout_ratio,
    }

    if spoiled_total and np.isfinite(spoiled_total):
        meta["spoiled_total"] = float(spoiled_total)
    if abstain_total and np.isfinite(abstain_total):
        meta["did_not_vote_total"] = float(abstain_total)
    if spoiled_share is not None:
        meta["spoiled_share"] = spoiled_share
    if abstain_share is not None:
        meta["did_not_vote_share"] = abstain_share

    return shares, meta


def _recency_weight(event_ts: pd.Timestamp, target_ts: pd.Timestamp) -> float:
    if event_ts is None or pd.isna(event_ts):
        return 1.0
    if target_ts is None or pd.isna(target_ts):
        return 1.0
    delta_days = abs((target_ts - event_ts).days)
    years = delta_days / 365.25 if delta_days >= 0 else 0.0
    return 1.0 / ((1.0 + years) ** 2)


def _combine_weighted_shares(weighted: Sequence[Tuple[Dict[str, float], float]]) -> Dict[str, float]:
    if not weighted:
        return {}

    totals: Dict[str, float] = {}
    weight_per_party: Dict[str, float] = {}

    for share_map, weight in weighted:
        w = float(weight) if weight and weight > 0 else 0.0
        if w <= 0:
            continue
        total = sum(float(val) for val in share_map.values() if float(val) > 0)
        if total <= 0:
            continue
        for party, value in share_map.items():
            val = float(value)
            if val <= 0:
                continue
            normalised = val / total
            totals[party] = totals.get(party, 0.0) + normalised * w
            weight_per_party[party] = weight_per_party.get(party, 0.0) + w

    combined: Dict[str, float] = {}
    for party, total_value in totals.items():
        weight_sum = weight_per_party.get(party, 0.0)
        if weight_sum <= 0:
            continue
        combined[party] = total_value / weight_sum

    if not combined:
        return {}

    total_combined = sum(combined.values())
    if total_combined > 0:
        combined = {party: value / total_combined for party, value in combined.items()}
    return combined


def _compute_breakdown_party_shares(
    er: pd.DataFrame,
    constituency: str,
    date_str: str,
    event_type: Optional[str],
    elected_body: Optional[str],
) -> Dict[str, object]:
    families = _resolve_breakdown_families(event_type, elected_body)

    cons_mask = er.get("Constituency", pd.Series("", index=er.index)).astype(str).str.strip() == constituency
    er_cons = er[cons_mask].copy()
    if er_cons.empty:
        return {"shares": {}, "families": tuple(families), "elections": tuple(), "electorate": None}

    if "DateStr" not in er_cons.columns:
        er_cons["DateStr"] = er_cons.get("Date", pd.Series("", index=er_cons.index)).apply(to_date_str)
    er_cons["DateTS"] = pd.to_datetime(er_cons["DateStr"], errors="coerce")

    target_ts = pd.to_datetime(date_str, errors="coerce") if date_str else pd.NaT

    weighted_shares: List[Tuple[Dict[str, float], float]] = []
    election_records: List[Dict[str, object]] = []
    electorate_weights: List[Tuple[float, float]] = []
    turnout_weights: List[Tuple[float, float]] = []
    dnv_weights: List[Tuple[float, float]] = []
    spoiled_weights: List[Tuple[float, float]] = []

    for fam in families:
        fam_rows = _filter_rows_for_family(er_cons, fam)
        if fam_rows.empty:
            continue
        latest_rows = _pick_latest_rows(fam_rows, target_ts)
        if latest_rows.empty:
            continue
        share_map, meta = _rows_to_party_share(latest_rows)
        if not share_map:
            continue
        weight = _recency_weight(meta.get("date_ts"), target_ts)
        if weight <= 0:
            weight = 1.0
        weighted_shares.append((share_map, weight))

        election_meta = {
            "family": fam,
            "date": meta.get("date", ""),
            "event": meta.get("event", ""),
            "event_type": meta.get("event_type", ""),
            "elected_body": meta.get("elected_body", ""),
        }
        electorate_val = meta.get("electorate")
        if electorate_val is not None and np.isfinite(electorate_val):
            electorate_weights.append((float(electorate_val), weight))
            election_meta["electorate"] = float(electorate_val)
        election_records.append(election_meta)

        turnout_ratio = meta.get("turnout_ratio")
        if turnout_ratio is not None and np.isfinite(turnout_ratio):
            turnout_weights.append((float(turnout_ratio), weight))

        dnv_share = meta.get("did_not_vote_share")
        if dnv_share is not None and np.isfinite(dnv_share):
            dnv_weights.append((float(dnv_share), weight))

        spoiled_share = meta.get("spoiled_share")
        if spoiled_share is not None and np.isfinite(spoiled_share):
            spoiled_weights.append((float(spoiled_share), weight))

    combined_shares = _combine_weighted_shares(weighted_shares)

    if not combined_shares:
        result_payload: Dict[str, object] = {
            "shares": {},
            "families": tuple(families),
            "elections": tuple(election_records),
            "electorate": None,
        }
        if turnout_weights:
            weight_sum = sum(w for _, w in turnout_weights if w > 0)
            if weight_sum > 0:
                avg_turnout = sum(r * w for r, w in turnout_weights if w > 0) / weight_sum
                avg_turnout = float(np.clip(avg_turnout, 0.0, 1.0))
                result_payload["turnout_share"] = avg_turnout
                result_payload["non_participant_share"] = max(0.0, 1.0 - avg_turnout)
        return result_payload

    total_weight = sum(w for _, w in electorate_weights if w > 0)
    if total_weight > 0:
        electorate = sum(val * w for val, w in electorate_weights if w > 0) / total_weight
    elif electorate_weights:
        electorate = sum(val for val, _ in electorate_weights) / float(len(electorate_weights))
    else:
        electorate = None

    turnout_ratio = None
    if turnout_weights:
        weight_sum = sum(w for _, w in turnout_weights if w > 0)
        if weight_sum > 0:
            turnout_ratio = sum(r * w for r, w in turnout_weights if w > 0) / weight_sum
            turnout_ratio = float(np.clip(turnout_ratio, 0.0, 1.0))

    def _weighted_average(pairs: List[Tuple[float, float]]) -> Optional[float]:
        total = sum(weight for _, weight in pairs if weight > 0)
        if total <= 0:
            return None
        return sum(value * weight for value, weight in pairs if weight > 0) / total

    shares_payload: Dict[str, float] = dict(combined_shares)
    non_participant_share: Optional[float] = None
    spoiled_share: Optional[float] = None

    weighted_spoiled = _weighted_average(spoiled_weights)
    if weighted_spoiled is not None:
        spoiled_share = float(np.clip(weighted_spoiled, 0.0, 1.0))

    weighted_dnv = _weighted_average(dnv_weights)
    if weighted_dnv is not None:
        non_participant_share = float(np.clip(weighted_dnv, 0.0, 1.0))

    if turnout_ratio is not None:
        valid_share = float(np.clip(turnout_ratio, 0.0, 1.0))
        shares_payload = {party: value * valid_share for party, value in combined_shares.items()}
        if spoiled_share is None:
            spoiled_share = None
        if non_participant_share is None:
            remainder = 1.0 - valid_share - (spoiled_share if spoiled_share is not None else 0.0)
            non_participant_share = float(np.clip(remainder, 0.0, 1.0))
        elif spoiled_share is None:
            remainder = 1.0 - valid_share - non_participant_share
            spoiled_share = float(np.clip(remainder, 0.0, 1.0)) if remainder > 0 else 0.0
    else:
        shares_payload = dict(combined_shares)

    if spoiled_share is not None and spoiled_share > 0:
        shares_payload[SPOILED_BASELINE_LABEL] = spoiled_share
    if non_participant_share is not None and non_participant_share > 0:
        shares_payload[NON_PARTICIPANT_BASELINE_LABEL] = non_participant_share

    return {
        "shares": shares_payload,
        "families": tuple(families),
        "elections": tuple(election_records),
        "electorate": electorate,
        "turnout_share": turnout_ratio,
        "non_participant_share": non_participant_share,
        "non_participant_label": NON_PARTICIPANT_BASELINE_LABEL,
        "spoiled_share": spoiled_share,
        "spoiled_label": SPOILED_BASELINE_LABEL,
    }


def _canonical_endorsement_lookup(en_map: Dict[str, str]) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for party, choice in en_map.items():
        key = normalize_party_key(party)
        clean_choice = str(choice).strip()
        if key and clean_choice and clean_choice not in {"?", "No position", "No stance", "Neutral", "None", "Unknown"}:
            lookup[key] = clean_choice
    return lookup


def _resolve_party_choice(party: str,
                          en_map: Dict[str, str],
                          canonical: Dict[str, str]) -> str:
    direct = en_map.get(str(party))
    if direct:
        return direct
    key = normalize_party_key(party)
    if key:
        return canonical.get(key, "")
    return ""


def _add_northern_ireland_view(df: pd.DataFrame) -> pd.DataFrame:
    """Append a Northern Ireland aggregate view derived from constituency rows."""

    if df.empty:
        return df

    cons = df.get("Constituency", pd.Series([], dtype=str)).astype(str).str.strip().str.lower()
    if cons.eq("northern ireland").any():
        # Already present; assume caller has handled aggregation.
        return df

    group_cols = ["ProjectedDate", "OriginalDate", "ElectedBody"]
    missing = [c for c in group_cols if c not in df.columns]
    if missing:
        return df

    extra_rows = []
    for key, sub in df.groupby(group_cols):
        # Sum electorates/spoiled using unique constituencies to avoid duplication.
        unique_const = sub.drop_duplicates("Constituency")
        electorate_series = _coerce_numeric_series(unique_const.get("Electorate"))
        spoiled_series = _coerce_numeric_series(unique_const.get("ProjectedSpoiled"))
        electorate = electorate_series.sum(min_count=1)
        spoiled_total = spoiled_series.sum(min_count=1)

        counts_series = sub.groupby("Option")["ProjectedCount"].sum(min_count=1)
        counts = {opt: float(val) if pd.notna(val) else np.nan for opt, val in counts_series.items()}
        options_order = list(dict.fromkeys(sub["Option"].tolist()))

        breakdown_payload = {}
        if "PartyBreakdown" in sub.columns:
            breakdowns = [
                bd
                for bd in sub.get("PartyBreakdown", [])
                if isinstance(bd, Mapping) and bd
            ]
            aggregated_breakdown = merge_party_breakdowns(
                breakdowns,
                output_labels=options_order,
                electorate=float(electorate) if np.isfinite(electorate) else None,
            )
            if aggregated_breakdown:
                breakdown_payload = aggregated_breakdown

        valid_sum = 0.0
        valid_defined = False
        for opt, value in counts.items():
            if not np.isfinite(value):
                continue
            if is_dnv_label(opt) or is_spoiled_label(opt):
                continue
            valid_sum += float(value)
            valid_defined = True
        valid_total = valid_sum if valid_defined else np.nan

        spoiled_labels = [opt for opt in options_order if is_spoiled_label(opt)]
        spoiled_total = 0.0
        spoiled_defined = False
        for opt in spoiled_labels:
            value = counts.get(opt)
            if value is None or not np.isfinite(value):
                continue
            spoiled_total += float(value)
            spoiled_defined = True
        if not spoiled_defined:
            spoiled_series = _coerce_numeric_series(sub.get("ProjectedSpoiled"))
            spoiled_total = (
                float(spoiled_series.sum(skipna=True)) if not spoiled_series.empty else float("nan")
            )

        dnv_labels = [opt for opt in options_order if is_dnv_label(opt)]
        if np.isfinite(electorate) and np.isfinite(valid_total) and np.isfinite(spoiled_total):
            dnv_target = float(electorate) - float(valid_total) - float(spoiled_total)
            if dnv_target < 0:
                dnv_target = 0.0
            if dnv_labels:
                if len(dnv_labels) == 1:
                    counts[dnv_labels[0]] = dnv_target
                else:
                    current_sum = sum(float(counts.get(opt, 0.0)) for opt in dnv_labels if np.isfinite(counts.get(opt, np.nan)))
                    if current_sum > 0:
                        for opt in dnv_labels:
                            value = counts.get(opt, 0.0)
                            ratio = float(value) / current_sum if np.isfinite(value) and current_sum > 0 else 0.0
                            counts[opt] = dnv_target * ratio
                    else:
                        share = dnv_target / float(len(dnv_labels))
                        for opt in dnv_labels:
                            counts[opt] = share

        spoiled_value = float(spoiled_total) if np.isfinite(spoiled_total) else np.nan

        for idx, opt in enumerate(options_order):
            count = counts.get(opt, np.nan)
            if np.isfinite(count) and count < 0:
                count = 0.0

            if np.isfinite(electorate) and electorate > 0 and np.isfinite(count):
                pct_electorate = 100.0 * float(count) / float(electorate)
            else:
                pct_electorate = np.nan

            if (not is_dnv_label(opt)) and (not is_spoiled_label(opt)) and np.isfinite(valid_total) and valid_total > 0 and np.isfinite(count):
                pct_valid = 100.0 * float(count) / float(valid_total)
            else:
                pct_valid = np.nan

            if is_spoiled_label(opt) and np.isfinite(spoiled_total):
                row_spoiled = spoiled_value
            elif idx == 0 and np.isfinite(spoiled_total):
                row_spoiled = spoiled_value
            else:
                row_spoiled = np.nan

            payload = {
                "ProjectedDate": key[0],
                "OriginalDate": key[1],
                "Constituency": "Northern Ireland",
                "ElectedBody": key[2],
                "Option": opt,
                "ProjectedPctElectorate": pct_electorate,
                "ProjectedPctValid": pct_valid,
                "ProjectedCount": float(count) if np.isfinite(count) else np.nan,
                "Electorate": float(electorate) if pd.notna(electorate) else np.nan,
                "ProjectedSpoiled": row_spoiled,
            }
            if idx == 0:
                payload["PartyBreakdown"] = breakdown_payload
            else:
                payload["PartyBreakdown"] = None
            extra_rows.append(payload)

    if not extra_rows:
        return df

    agg_df = pd.DataFrame(extra_rows)
    return pd.concat([df, agg_df], ignore_index=True, sort=False)


# ---------------------------------------------
# Feature row for a (date, constituency, body)
# ---------------------------------------------
def build_referendum_features_for_group(
    er: pd.DataFrame,
    endorsements: Optional[pd.DataFrame],
    date_str: str,
    constituency: str,
    body_key: str,
    options: List[str],
    endorsement_history: Optional[Dict[str, List[EndorsementSnapshot]]] = None,
    override_endorsements: Optional[Dict[str, str]] = None,
    breakdown_event_type: Optional[str] = None,
    breakdown_elected_body: Optional[str] = None,
    census_features: pd.DataFrame = None,
) -> Tuple[pd.DataFrame, Dict[str, float], Dict[str, object]]:
    """
    Build a single-row feature DF using FastReferendumFeatureEngineer.
    """
    from ..features.referendum_ml_features_fast import FastReferendumFeatureEngineer
    
    engineer = FastReferendumFeatureEngineer()
    
    # Resolve endorsements to dict
    if endorsement_history is None:
        endorsement_history = build_endorsement_history(endorsements) if endorsements is not None else {}

    base_map = resolve_endorsements_for_date(endorsement_history, str(body_key), date_str)
    en_map: Dict[str, str] = dict(base_map)

    if override_endorsements is not None:
        for party, opt in override_endorsements.items():
            party_key = str(party).strip()
            if not party_key: continue
            opt_key = normalize_option_label(opt)
            if opt_key: en_map[party_key] = opt_key
            else: en_map.pop(party_key, None)

    canonical_map = _canonical_endorsement_lookup(en_map)
    
    # Map dict to engineer format: {Party: {'position': Choice}}
    eng_endorsements = {p: {'position': v} for p, v in en_map.items()}
    
    # Identify Option 1 / Option 2 keys for the engineer
    # We assume options[0] is "Option 1" (e.g. Yes/Remain/Unionist) and options[1] is "Option 2".
    # This depends on how options are sorted. infer_body_options sorts alphabetically?
    # If options are ['No', 'Yes'], then Opt1=No, Opt2=Yes.
    # The engineer sums shares for keys in option_1_keys.
    # We need to map the labels in en_map (e.g. "Yes") to these keys.
    
    # Use normalized keys from the options list
    opt1_keys = {normalize_option_label(options[0])} if len(options) > 0 else set()
    opt2_keys = {normalize_option_label(options[1])} if len(options) > 1 else set()
    
    # Also add semantic variations to keys to ensure matches
    # e.g. if option is "Remain", add "yes" to keys?
    # The engineer compares: `any(k in pos for k in opt1_norm)`
    # `pos` is the endorsement string (e.g. "Yes").
    # If opt1_keys={'remain'}, and pos='Yes', it fails.
    # But if we pass the full list of options, we rely on user input matching options.
    # For robustness, we should add common synonyms if standard options are used.
    
    def expand_keys(keys):
        expanded = set(keys)
        for k in list(keys):
            k = k.lower()
            if k in ('remain', 'united kingdom', 'stay', 'uk'): expanded.add('yes')
            if k in ('leave', 'united ireland', 'join', 'republic'): expanded.add('no')
        return expanded

    # Build features
    feat_series = engineer.build_features_for_constituency(
        constituency, er, eng_endorsements, date_str, census_features,
        option_1_keys=expand_keys(opt1_keys), option_2_keys=expand_keys(opt2_keys),
        max_historical_date=date_str
    )
    
    # Calculate totals (reuse existing logic)
    date_use = TARGET_DATE if TARGET_DATE else date_str
    er_cons = er[er["Constituency"].astype(str).str.strip() == constituency].copy()
    if not er_cons.empty:
        er_cons["DateTS"] = pd.to_datetime(er_cons["DateStr"], errors="coerce")
        ts_target = pd.to_datetime(date_use, errors="coerce")
        if pd.isna(ts_target):
            er_use = er_cons[er_cons["DateTS"] == er_cons["DateTS"].max()]
        else:
            before = er_cons[er_cons["DateTS"] <= ts_target]
            er_use = before if not before.empty else er_cons
            
        if not er_use.empty:
            latest_ts = er_use["DateTS"].max()
            er_use = er_use[er_use["DateTS"] == latest_ts]
        totals = compute_constituency_totals(er_use, event="Referendum", elected_body=str(body_key))
    else:
        totals = {
            "electorate": float("nan"),
            "valid_total": float("nan"),
            "spoiled": 0.0,
            "did_not_vote": float("nan"),
        }
    totals = _fallback_totals_with_baseline(er, constituency, date_use, totals)

    context = {
        "endorsements": en_map,
        "canonical_endorsements": canonical_map,
    }
    
    return pd.DataFrame([feat_series]), totals, context


def build_custom_two_option_features(
    er: pd.DataFrame,
    date_str: str,
    constituency: str,
    body_key: str,
    model_options: List[str],
    custom_options: List[str],
    custom_endorsements: Optional[Dict[str, str]] = None,
    breakdown_event_type: Optional[str] = None,
    breakdown_elected_body: Optional[str] = None,
    census_features: pd.DataFrame = None,
) -> Tuple[pd.DataFrame, Dict[str, float], Dict[str, str], Dict[str, object]]:
    """Build a feature row for an ad-hoc two-option referendum.

    Parameters
    ----------
    er:
        Election results dataframe used to derive baseline party strengths.
    date_str:
        Date the hypothetical referendum is held (YYYY-MM-DD).
    constituency:
        Constituency name (normalised internally).
    body_key:
        Identifier for the custom referendum body (used for totals lookup only).
    model_options:
        Option labels known to the trained model (e.g. ["Yes", "No", "Did not vote"]).
    custom_options:
        Exactly two user-defined option labels for the referendum.
    custom_endorsements:
        Mapping of party -> custom option label indicating endorsements.
    census_features:
        Cached census data DataFrame.

    Returns
    -------
    feature_df, totals_dict, model_to_custom
        ``feature_df`` is suitable for passing to the trained model, ``totals_dict``
        mirrors :func:`build_referendum_features_for_group`, ``model_to_custom``
        maps model option labels to the user-visible custom labels, and
        ``context`` carries metadata for downstream party breakdowns.
    """

    if len(custom_options) != 2:
        raise ValueError("Custom referendums must define exactly two options.")

    custom_clean = []
    for opt in custom_options:
        opt_clean = str(opt).strip()
        if not opt_clean:
            raise ValueError("Custom option labels cannot be empty.")
        custom_clean.append(opt_clean)

    if len(set(custom_clean)) != 2:
        raise ValueError("Custom option labels must be distinct.")

    if not model_options:
        raise ValueError("Model options list cannot be empty when building custom features.")

    non_dnv_model_opts = [opt for opt in model_options if opt and not is_dnv_label(opt)]
    # preserve original ordering but ensure uniqueness
    seen_opts: Dict[str, None] = {}
    ordered_non_dnv = []
    for opt in non_dnv_model_opts:
        key = opt
        if key in seen_opts:
            continue
        seen_opts[key] = None
        ordered_non_dnv.append(opt)

    if len(ordered_non_dnv) < 2:
        raise ValueError("Referendum model metadata must contain at least two non 'Did not vote' options.")

    canonical_targets = ordered_non_dnv[:2]

    dnv_opt = next((opt for opt in model_options if is_dnv_label(opt)), None)
    if dnv_opt is None:
        raise ValueError("Model options must include a 'Did not vote' slot for custom simulations.")

    spoiled_opt = next((opt for opt in model_options if is_spoiled_label(opt)), None)

    alias_map = {
        custom_clean[0]: canonical_targets[0],
        custom_clean[1]: canonical_targets[1],
    }

    override: Dict[str, str] = {}
    custom_endorsements = custom_endorsements or {}
    for party, custom_choice in custom_endorsements.items():
        party_key = str(party).strip()
        choice_key = str(custom_choice).strip()
        if not party_key or not choice_key:
            continue
        if is_dnv_label(choice_key):
            override[party_key] = dnv_opt
            continue
        if is_spoiled_label(choice_key):
            if spoiled_opt is None:
                raise ValueError(
                    "Referendum model metadata must include a 'Spoiled' option to support spoiled endorsements."
                )
            override[party_key] = spoiled_opt
            continue
        canonical_choice = alias_map.get(choice_key)
        if canonical_choice is None:
            raise ValueError(
                f"Custom endorsement option '{choice_key}' is not recognised amongst the custom labels."
            )
        override[party_key] = canonical_choice

    cons_norm = normalize_constituency_name(constituency)
    if not cons_norm:
        cons_norm = str(constituency)

    feature_df, totals, context = build_referendum_features_for_group(
        er,
        endorsements=None,
        date_str=date_str,
        constituency=cons_norm,
        body_key=body_key,
        options=model_options,
        endorsement_history=None,
        override_endorsements=override,
        breakdown_event_type=breakdown_event_type,
        breakdown_elected_body=breakdown_elected_body,
        census_features=census_features,
    )

    model_to_custom: Dict[str, str] = {}
    for model_opt in model_options:
        if is_dnv_label(model_opt):
            model_to_custom[model_opt] = "Did not vote"
        elif spoiled_opt and is_spoiled_label(model_opt):
            model_to_custom[model_opt] = "Spoiled"
        elif model_opt == canonical_targets[0]:
            model_to_custom[model_opt] = custom_clean[0]
        elif model_opt == canonical_targets[1]:
            model_to_custom[model_opt] = custom_clean[1]
        else:
            # For any additional model options, default to the closest available custom option
            # based on simple keyword heuristics; fall back to the first option.
            lower = model_opt.lower()
            if any(k in lower for k in ("leave", "no", "withdraw", "reject", "oppose", "abolish")):
                model_to_custom[model_opt] = custom_clean[1]
            elif any(k in lower for k in ("remain", "yes", "stay", "approve", "keep", "support")):
                model_to_custom[model_opt] = custom_clean[0]
            else:
                # Pick whichever custom option currently has fewer mappings to keep things balanced
                counts = {
                    custom_clean[0]: sum(1 for v in model_to_custom.values() if v == custom_clean[0]),
                    custom_clean[1]: sum(1 for v in model_to_custom.values() if v == custom_clean[1]),
                }
                if counts[custom_clean[0]] <= counts[custom_clean[1]]:
                    model_to_custom[model_opt] = custom_clean[0]
                else:
                    model_to_custom[model_opt] = custom_clean[1]

    if dnv_opt not in model_to_custom:
        model_to_custom[dnv_opt] = "Did not vote"
    if spoiled_opt and spoiled_opt not in model_to_custom:
        model_to_custom[spoiled_opt] = "Spoiled"

    return feature_df, totals, model_to_custom, context


def predict_group_rows(
    model,
    feat_cols: List[str],
    model_options: List[str],
    feat_df: pd.DataFrame,
    totals: Dict[str, float],
    output_labels: List[str],
    model_to_output: Dict[str, str],
    *,
    date_str: str,
    constituency: str,
    body_key: str,
    context: Optional[Dict[str, object]] = None,
) -> Tuple[List[Dict[str, object]], Dict[str, object]]:
    """Convert a feature row into projected option rows and party breakdown."""

    if feat_df is None or feat_df.empty:
        return [], {}

    for col in feat_cols:
        if col not in feat_df.columns:
            feat_df[col] = 0.0

    X = feat_df[feat_cols].astype(np.float32).values
    probs = model.predict_proba_rows(X)[0]

    model_opt_to_idx = {opt: idx for idx, opt in enumerate(model_options)}

    electorate = totals.get("electorate", np.nan)
    valid_total = totals.get("valid_total", np.nan)
    spoiled = totals.get("spoiled", 0.0)

    counts: Dict[str, float] = {}
    probabilities: Dict[str, float] = {}
    for label in output_labels:
        related_opts = [m_opt for m_opt, out in model_to_output.items() if out == label]
        prob = 0.0
        for m_opt in related_opts:
            idx = model_opt_to_idx.get(m_opt)
            if idx is None:
                continue
            prob += float(probs[idx])
        probabilities[label] = prob
        counts[label] = float(prob * electorate) if np.isfinite(electorate) else np.nan

    target_valid = totals.get("valid_total", np.nan)
    target_valid = float(target_valid) if np.isfinite(target_valid) else np.nan

    valid_sum = 0.0
    valid_defined = False
    for label, value in counts.items():
        if not np.isfinite(value):
            continue
        if is_dnv_label(label) or is_spoiled_label(label):
            continue
        valid_sum += float(value)
        valid_defined = True

    if valid_defined and np.isfinite(target_valid) and target_valid >= 0:
        scale = target_valid / valid_sum if valid_sum > 0 else 0.0
        non_dnv_labels = [lbl for lbl in output_labels if not is_dnv_label(lbl) and not is_spoiled_label(lbl)]
        if scale > 0 and valid_sum > 0:
            for lbl in non_dnv_labels:
                value = counts.get(lbl)
                if value is None or not np.isfinite(value):
                    continue
                counts[lbl] = float(value) * scale
        else:
            share = target_valid / float(len(non_dnv_labels)) if non_dnv_labels else 0.0
            for lbl in non_dnv_labels:
                counts[lbl] = share
        valid_total = float(target_valid)
        valid_sum = valid_total
    elif valid_defined:
        valid_total = valid_sum
    else:
        valid_total = float(target_valid)

    spoiled_labels = [label for label in output_labels if is_spoiled_label(label)]
    spoiled_defined = False
    spoiled_total = 0.0
    for label in spoiled_labels:
        value = counts.get(label)
        if value is None or not np.isfinite(value):
            continue
        spoiled_total += float(value)
        spoiled_defined = True
    target_spoiled = totals.get("spoiled", np.nan)
    target_spoiled = float(target_spoiled) if np.isfinite(target_spoiled) else np.nan
    if np.isfinite(target_spoiled) and target_spoiled >= 0:
        if spoiled_labels:
            current_sum = 0.0
            for label in spoiled_labels:
                value = counts.get(label)
                if value is None or not np.isfinite(value):
                    continue
                current_sum += float(value)
            if current_sum > 0:
                scale = target_spoiled / current_sum
                for label in spoiled_labels:
                    value = counts.get(label)
                    if value is None or not np.isfinite(value):
                        continue
                    counts[label] = float(value) * scale
            else:
                share = target_spoiled / float(len(spoiled_labels))
                for label in spoiled_labels:
                    counts[label] = share
        spoiled_total = float(target_spoiled)
    elif not spoiled_defined:
        spoiled_total = float(totals.get("spoiled", 0.0))

    dnv_labels = [label for label in output_labels if is_dnv_label(label)]
    dnv_target = totals.get("did_not_vote", np.nan)
    dnv_target = float(dnv_target) if np.isfinite(dnv_target) else np.nan
    if not np.isfinite(dnv_target):
        if np.isfinite(electorate) and np.isfinite(valid_total) and np.isfinite(spoiled_total):
            dnv_target = float(electorate) - float(valid_total) - float(spoiled_total)
            if dnv_target < 0:
                dnv_target = 0.0
        else:
            dnv_target = None
    if dnv_target is not None and dnv_labels:
        current_sum = 0.0
        for label in dnv_labels:
            value = counts.get(label)
            if value is None or not np.isfinite(value):
                continue
            current_sum += float(value)
        if len(dnv_labels) == 1:
            counts[dnv_labels[0]] = dnv_target
        elif current_sum > 0:
            for label in dnv_labels:
                value = counts.get(label)
                ratio = float(value) / current_sum if value is not None and np.isfinite(value) and current_sum > 0 else 0.0
                counts[label] = dnv_target * ratio
        else:
            share = dnv_target / float(len(dnv_labels))
            for label in dnv_labels:
                counts[label] = share

    spoiled_value = float(spoiled_total) if np.isfinite(spoiled_total) else np.nan

    projected_rows: List[Dict[str, object]] = []
    for idx, label in enumerate(output_labels):
        count = counts.get(label, np.nan)
        if np.isfinite(count) and count < 0:
            count = 0.0
        prob = probabilities.get(label, 0.0)
        pct_electorate = float("nan")
        if np.isfinite(electorate) and electorate > 0 and np.isfinite(count):
            pct_electorate = 100.0 * float(count) / float(electorate)
        elif np.isfinite(prob):
            pct_electorate = 100.0 * prob

        pct_valid = float("nan")
        if (not is_dnv_label(label)) and (not is_spoiled_label(label)) and np.isfinite(valid_total) and valid_total > 0 and np.isfinite(count):
            pct_valid = 100.0 * float(count) / float(valid_total)

        if is_spoiled_label(label) and np.isfinite(spoiled_total):
            row_spoiled = spoiled_value
        elif idx == 0 and np.isfinite(spoiled_total):
            row_spoiled = spoiled_value
        else:
            row_spoiled = np.nan

        projected_rows.append({
            "ProjectedDate": TARGET_DATE if TARGET_DATE else date_str,
            "OriginalDate": date_str,
            "Constituency": constituency,
            "ElectedBody": str(body_key),
            "Option": label,
            "ProjectedPctElectorate": pct_electorate,
            "ProjectedPctValid": pct_valid,
            "ProjectedCount": count,
            "Electorate": electorate,
            "ProjectedSpoiled": row_spoiled,
        })

    breakdown = None

    if projected_rows:
        for idx, row in enumerate(projected_rows):
            row["PartyBreakdown"] = None

    return projected_rows, {}


# -----------------------------
# Project referendum
# -----------------------------
def project_referendum(er: pd.DataFrame,
                       endorsements: Optional[pd.DataFrame],
                       model,
                       meta: Dict,
                       constituency_filter: Optional[str],
                       event_filter: Optional[str],
                       output_xlsx: str) -> None:
    """
    Use trained referendum model to project results for all (date, constituency, body) groups
    that match the optional filters. Writes an Excel with option percentages and counts.
    """
    meta_map = meta if isinstance(meta, Mapping) else {}
    model_options = list(getattr(model, "options", []) or meta_map.get("options", []) or [])
    if not model_options:
        raise ValueError("Model metadata must include option labels.")
    feat_cols = list(
        getattr(model, "feature_columns", [])
        or getattr(model, "feat_cols", [])
        or meta_map.get("feat_cols", [])
        or []
    )
    if not feat_cols:
        raise ValueError("Model metadata must include feature column names.")

    ref = filter_referendum_rows(er)

    endorsement_history = build_endorsement_history(endorsements) if endorsements is not None else {}

    # Apply filters
    if constituency_filter:
        ref = ref[ref["Constituency"].astype(str).str.strip() == constituency_filter]
    if event_filter:
        m = ref.get("GroupBody", "").astype(str).str.contains(event_filter, case=False, na=False) | \
            ref.get("ElectedBody", "").astype(str).str.contains(event_filter, case=False, na=False) | \
            ref.get("Event", "").astype(str).str.contains(event_filter, case=False, na=False)
        ref = ref[m]

    if ref.empty:
        sample_events = er["Event"].astype(str).str.lower().dropna().unique().tolist()[:10]
        sample_types = er.get("EventType", pd.Series([], dtype=str)).astype(str).str.lower().dropna().unique().tolist()[:10]
        raise ValueError(
            "No referendum groups matched the filters.\n"
            f"- Detected 0 referendum-like rows after filtering.\n"
            f"- Sample Event values: {sample_events}\n"
            f"- Sample EventType values: {sample_types}"
        )

    groups = list(ref.groupby(["DateStr", "Constituency", "GroupBody"]))
    if not groups:
        raise ValueError("Referendum grouping produced no (Date, Constituency, Body) groups.")

    out_rows = []

    for (date_str, cons, body_key), _grp in groups:
        cons_norm = normalize_constituency_name(cons)

        # Determine the right options for this body and ensure DNV last
        desired_opts = infer_body_options(er, endorsements, str(body_key))
        dnv = "Did not vote"
        desired_non_dnv = [o for o in desired_opts if not is_dnv_label(o)]
        if not any(is_spoiled_label(o) for o in desired_non_dnv) and any(
            is_spoiled_label(o) for o in model_options
        ):
            desired_non_dnv.append("Spoiled")
        desired = desired_non_dnv + [dnv]

        feat_df, totals, context = build_referendum_features_for_group(
            er,
            endorsements,
            date_str,
            cons_norm,
            body_key,
            model_options,
            endorsement_history=endorsement_history,
        )
        context = dict(context or {})
        context.setdefault("endorsement_profiles", meta_map.get("endorsement_profiles"))
        context.setdefault("neutral_profile", meta_map.get("neutral_profile"))

        rows, _ = predict_group_rows(
            model,
            feat_cols,
            model_options,
            feat_df,
            totals,
            desired,
            {opt: opt for opt in model_options},
            date_str=date_str,
            constituency=cons_norm,
            body_key=str(body_key),
            context=context,
        )
        out_rows.extend(rows)

    out = pd.DataFrame(out_rows)
    out = _add_northern_ireland_view(out)
    # Write Excel
    with pd.ExcelWriter(output_xlsx, engine="openpyxl") as w:
        out.to_excel(w, sheet_name="ProjectedReferendum", index=False)
