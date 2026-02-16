"""Structured election and referendum data ingestion utilities.

This module upgrades the legacy workbook loaders so downstream code can work
with a consistent, normalised view of historic election and referendum
results.  The helpers exposed here combine the "ElectionResults" and
"Endorsements" worksheets into tidy tables that capture constituency-level and
NI-wide vote totals, option labels, party identifiers and endorsement
snapshots.  The goal is to provide a single ingestion point that future tasks
can rely on when building richer features for the referendum simulator.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import math
import re

import numpy as np
import pandas as pd

from ..config import REFERENDUM_TYPES
from ..utils import (
    is_dnv_label,
    is_spoiled_label,
    normalize_constituency_name,
    normalize_option_label,
    to_date_str,
)
from ..features.endorsements import (
    build_endorsement_history,
    infer_party_family,
    normalize_party_key,
    resolve_endorsements_for_date,
)
from .loading import load_election_results, load_endorsements


REFERENDUM_TYPE_KEYS = {t.casefold() for t in REFERENDUM_TYPES}
NATION_LABELS = {
    "",
    "nan",
    "none",
    "northern ireland",
    "ni",
    "ni-wide",
    "ni wide",
    "northern ireland overall",
    "northern ireland total",
}


@dataclass
class StructuredElectionData:
    """Container returned by :func:`ingest_election_data`.

    Attributes
    ----------
    constituency_results:
        Normalised per-area vote totals (first preferences, referendum options,
        turnout, electorate, etc.).  Each row represents a unique combination
        of (date, event, elected body, area, result kind, option label).
    nation_results:
        NI-wide aggregates generated from ``constituency_results`` so callers
        have a consistent national series even when the workbook omits explicit
        "Northern Ireland" rows.
    endorsements:
        Cleaned endorsement timeline extracted from the workbook.
    party_register:
        Reference table describing each normalised party key and the distinct
        labels observed for that key over time.
    area_register:
        Reference table mapping area keys to the collection of historic
        constituency labels that resolved to that key (useful for tracking
        boundary changes).
    issues:
        Human-readable warnings about incomplete or ambiguous data that callers
        may want to surface in logs or diagnostics.
    """

    constituency_results: pd.DataFrame
    nation_results: pd.DataFrame
    endorsements: pd.DataFrame
    party_register: pd.DataFrame
    area_register: pd.DataFrame
    referendum_party_results: pd.DataFrame
    issues: List[str]


def ingest_election_data(
    xl_or_path: str | pd.ExcelFile,
    *,
    source: str | None = None,
) -> StructuredElectionData:
    """Return a structured view of election and referendum history.

    Parameters
    ----------
    xl_or_path:
        Either a ``pd.ExcelFile`` that has already been opened or a string path
        to the workbook containing ``ElectionResults`` and (optionally)
        ``Endorsements`` sheets.
    source:
        Friendly label describing the data source.  Stored in the returned
        tables for downstream provenance tracking.
    """

    if isinstance(xl_or_path, pd.ExcelFile):
        xl = xl_or_path
    else:
        xl = pd.ExcelFile(xl_or_path)

    raw_results = load_election_results(xl)
    raw_endorsements = load_endorsements(xl)

    structured_results = normalize_election_results(raw_results, source=source)
    structured_endorsements = normalize_endorsements(raw_endorsements)
    referendum_party_results = build_referendum_party_results(
        structured_results, structured_endorsements
    )

    constituency_results = structured_results[
        structured_results["area_scope"].isin({"constituency", "constituency_group"})
    ].copy()
    nation_results = aggregate_nationwide(constituency_results)

    party_register = build_party_register(structured_results)
    area_register = build_area_register(structured_results)

    issues: List[str] = []
    issues.extend(_collect_result_issues(structured_results))
    issues.extend(_collect_endorsement_issues(structured_endorsements))

    return StructuredElectionData(
        constituency_results=constituency_results,
        nation_results=nation_results,
        endorsements=structured_endorsements,
        party_register=party_register,
        area_register=area_register,
        referendum_party_results=referendum_party_results,
        issues=issues,
    )


def normalize_election_results(
    df: pd.DataFrame, *, source: str | None = None
) -> pd.DataFrame:
    """Normalise the raw ``ElectionResults`` worksheet into tidy records."""

    if df is None or df.empty:
        return pd.DataFrame(
            columns=[
                "date",
                "date_str",
                "event",
                "event_type",
                "elected_body",
                "area_name",
                "area_key",
                "area_scope",
                "result_kind",
                "option_label",
                "option_key",
                "party_name",
                "party_key",
                "candidate_count",
                "votes",
                "is_valid_vote",
                "source",
                "source_result_types",
                "person_ids",
                "devolved_instance",
                "wm_instance",
                "eu_instance",
                "total_instance",
            ]
        )

    working = df.copy()

    if "DateStr" not in working.columns:
        working["DateStr"] = working.get("Date", pd.Series("", index=working.index)).apply(to_date_str)
    else:
        working["DateStr"] = working["DateStr"].apply(to_date_str)

    working["Date"] = pd.to_datetime(working["DateStr"], errors="coerce")

    # Normalise key text columns so downstream processing is reliable.
    text_cols = [
        "Event",
        "EventType",
        "ElectedBody",
        "ResultType",
        "Constituency",
        "Party Name",
        "Party",
        "Source Party Name",
        "Name usually known by",
    ]
    for col in text_cols:
        if col in working.columns:
            working[col] = working[col].fillna("").astype(str).str.strip()
        else:
            working[col] = ""

    if "Votes1" in working.columns:
        working["Votes1"] = pd.to_numeric(working["Votes1"], errors="coerce").fillna(0.0)
    else:
        working["Votes1"] = 0.0

    records: List[dict] = []
    provenance = source if source is not None else "workbook"

    for row in working.to_dict("records"):
        result_kind = _classify_result_kind(row)

        option_label, option_key, party_name, party_key = _resolve_option_and_party(row, result_kind)

        area_name = normalize_constituency_name(_value(row, "Constituency", ""))
        area_scope = _classify_area_scope(area_name)
        area_key = _make_area_key(area_name, area_scope)

        candidate_name = _value(row, "Name usually known by", "") if result_kind == "party" else ""
        person_id = _value(row, "PersonID", np.nan)
        person_ids: Tuple[int, ...]
        if result_kind == "party":
            person_ids = _collect_person_ids([person_id])
        else:
            person_ids = tuple()

        records.append(
            {
                "date": _value(row, "Date"),
                "date_str": _value(row, "DateStr", ""),
                "event": _value(row, "Event", ""),
                "event_type": _value(row, "EventType", ""),
                "elected_body": _value(row, "ElectedBody", ""),
                "area_name": area_name if area_name else "Northern Ireland",
                "area_key": area_key,
                "area_scope": area_scope,
                "result_kind": result_kind,
                "option_label": option_label,
                "option_key": option_key,
                "party_name": party_name,
                "party_key": party_key,
                "candidate_name": candidate_name,
                "candidate_count": 1 if (result_kind == "party" and candidate_name) else 0,
                "votes": float(_value(row, "Votes1", 0.0) or 0.0),
                "is_valid_vote": result_kind in {"party", "referendum_option"},
                "source": provenance,
                "source_result_type": _value(row, "ResultType", ""),
                "person_ids": person_ids,
                "devolved_instance": _value(row, "DevolvedInstance", np.nan),
                "wm_instance": _value(row, "WMInstance", np.nan),
                "eu_instance": _value(row, "EUInstance", np.nan),
                "total_instance": _value(row, "TotalInstance", np.nan),
            }
        )

    base = pd.DataFrame.from_records(records)
    if base.empty:
        return base

    grouped = _aggregate_structured_rows(base)
    grouped = grouped.sort_values(
        ["date", "event", "elected_body", "area_key", "result_kind", "option_key"]
    ).reset_index(drop=True)
    return grouped


def normalize_endorsements(df: pd.DataFrame) -> pd.DataFrame:
    """Return a tidy endorsement table with normalised option labels."""

    if df is None or df.empty:
        return pd.DataFrame(
            columns=[
                "date",
                "date_str",
                "body_key",
                "party",
                "party_key",
                "endorsement_raw",
                "option_label",
                "option_key",
            ]
        )

    end = df.copy()
    if "DateStr" not in end.columns:
        end["DateStr"] = end.get("Date", pd.Series("", index=end.index)).apply(to_date_str)
    else:
        end["DateStr"] = end["DateStr"].apply(to_date_str)

    end["Date"] = pd.to_datetime(end["DateStr"], errors="coerce")

    body_candidates = [
        "BodyKey",
        "ElectedBody",
        "ReferendumName",
        "Body",
        "PollName",
        "Event",
    ]

    end["body_key"] = ""
    for candidate in body_candidates:
        if candidate not in end.columns:
            continue

        candidate_values = end[candidate].fillna("").astype(str).str.strip()
        if candidate_values.str.len().eq(0).all():
            continue

        mask = end["body_key"].str.len().eq(0) & candidate_values.str.len().gt(0)
        if mask.any():
            end.loc[mask, "body_key"] = candidate_values[mask]

    # Fall back to the raw event name when no other identifier was present.
    if "body_key" not in end.columns or end["body_key"].str.len().eq(0).all():
        end["body_key"] = end.get("Event", pd.Series("", index=end.index)).fillna("").astype(str).str.strip()

    party_series = end.get("Party", pd.Series("", index=end.index))
    end["Party"] = party_series.fillna("").astype(str).str.strip()
    endorsed_series = end.get("Endorsed", pd.Series("", index=end.index))
    end["Endorsed"] = endorsed_series.fillna("").astype(str).str.strip()
    if "EndorsedClean" in end.columns:
        end["EndorsedClean"] = end["EndorsedClean"].fillna("").astype(str).str.strip()
    else:
        end["EndorsedClean"] = end["Endorsed"].astype(str)

    option_fallback_columns = [
        "Name usually known by",
        "NameUsuallyKnownBy",
    ]
    for col in option_fallback_columns:
        if col not in end.columns:
            continue

        values = end[col].fillna("").astype(str).str.strip()
        mask = end["EndorsedClean"].str.len().eq(0) & values.str.len().gt(0)
        if mask.any():
            end.loc[mask, "EndorsedClean"] = values[mask]

    neutral_mask = end["EndorsedClean"].str.strip().eq("")
    if neutral_mask.any():
        end.loc[neutral_mask, "EndorsedClean"] = "Neutral"

    option_label = end["EndorsedClean"].map(normalize_option_label)
    option_label = option_label.replace({"": pd.NA})
    end["option_label"] = option_label
    end["option_key"] = end["option_label"].str.casefold()

    end["party_key"] = end["Party"].map(normalize_party_key)
    end.loc[end["party_key"].eq(""), "party_key"] = pd.NA

    tidy = end[
        [
            "Date",
            "DateStr",
            "body_key",
            "Party",
            "party_key",
            "Endorsed",
            "option_label",
            "option_key",
        ]
    ].rename(
        columns={
            "Date": "date",
            "DateStr": "date_str",
            "Party": "party",
            "Endorsed": "endorsement_raw",
        }
    )

    tidy = tidy.drop_duplicates(
        subset=["date_str", "body_key", "party", "option_label"], keep="last"
    ).reset_index(drop=True)

    return tidy


def aggregate_nationwide(constituency_results: pd.DataFrame) -> pd.DataFrame:
    """Aggregate constituency rows into NI-wide totals."""

    if constituency_results is None or constituency_results.empty:
        return pd.DataFrame(columns=constituency_results.columns if constituency_results is not None else [])

    group_cols = [
        "date",
        "date_str",
        "event",
        "event_type",
        "elected_body",
        "result_kind",
        "option_label",
        "option_key",
        "party_name",
        "party_key",
        "is_valid_vote",
        "source",
    ]

    aggregated = (
        constituency_results.groupby(group_cols, dropna=False)
        .agg(
            votes=("votes", "sum"),
            candidate_count=("candidate_count", "sum"),
            source_result_types=("source_result_types", _merge_string_tuples),
        )
        .reset_index()
    )

    aggregated["area_name"] = "Northern Ireland"
    aggregated["area_scope"] = "nation"
    aggregated["area_key"] = "nation::northern-ireland"
    aggregated["person_ids"] = aggregated.apply(lambda _: tuple(), axis=1)
    aggregated["devolved_instance"] = np.nan
    aggregated["wm_instance"] = np.nan
    aggregated["eu_instance"] = np.nan
    aggregated["total_instance"] = np.nan

    columns = constituency_results.columns
    aggregated = aggregated.reindex(columns=columns, fill_value=np.nan)
    aggregated["candidate_count"] = aggregated["candidate_count"].fillna(0).astype(int)
    aggregated["votes"] = aggregated["votes"].astype(float)

    return aggregated


def build_party_register(results: pd.DataFrame) -> pd.DataFrame:
    """Create a reference table describing normalised parties."""

    if results is None or results.empty:
        return pd.DataFrame(
            columns=["party_key", "primary_name", "name_history", "first_seen", "last_seen"]
        )

    subset = results[results["result_kind"] == "party"].copy()
    subset = subset[subset["party_key"].notna() & subset["party_key"].astype(str).str.len().gt(0)]
    if subset.empty:
        return pd.DataFrame(
            columns=["party_key", "primary_name", "name_history", "first_seen", "last_seen"]
        )

    subset = subset.sort_values(["date", "party_name"], kind="mergesort")

    entries = []
    for key, grp in subset.groupby("party_key"):
        grp_names = [name for name in grp["party_name"].tolist() if name]
        history = _unique_preserve_order(grp_names)
        last_row = grp.sort_values("date", ascending=False, kind="mergesort").iloc[0]
        primary = last_row["party_name"] if last_row["party_name"] else (history[0] if history else "")
        entries.append(
            {
                "party_key": key,
                "primary_name": primary,
                "name_history": tuple(history),
                "first_seen": grp["date"].min(),
                "last_seen": grp["date"].max(),
            }
        )

    register = pd.DataFrame(entries)
    register = register.sort_values("party_key").reset_index(drop=True)
    return register


def build_area_register(results: pd.DataFrame) -> pd.DataFrame:
    """Create a register mapping area keys to all observed labels."""

    if results is None or results.empty:
        return pd.DataFrame(
            columns=["area_key", "area_scope", "name_history", "first_seen", "last_seen"]
        )

    subset = results[["area_key", "area_scope", "area_name", "date"]].drop_duplicates()

    entries = []
    for key, grp in subset.groupby("area_key"):
        names = _unique_preserve_order(grp["area_name"].tolist())
        scope = grp["area_scope"].mode(dropna=False)
        scope_value = scope.iloc[0] if not scope.empty else "constituency"
        entries.append(
            {
                "area_key": key,
                "area_scope": scope_value,
                "name_history": tuple(names),
                "first_seen": grp["date"].min(),
                "last_seen": grp["date"].max(),
            }
        )

    register = pd.DataFrame(entries)
    register = register.sort_values("area_key").reset_index(drop=True)
    return register


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _value(row, key: str, default=None):
    if isinstance(row, dict):
        value = row.get(key, default)
    if hasattr(row, "get"):
        try:
            value = row.get(key, default)
        except Exception:
            value = getattr(row, key, default)
    else:
        value = getattr(row, key, default)

    if value is None:
        return default
    if isinstance(value, float) and math.isnan(value):
        return default
    try:
        if pd.isna(value):  # type: ignore[arg-type]
            return default
    except Exception:
        pass
    return value


def _classify_result_kind(row) -> str:
    rtype = str(_value(row, "ResultType", "")).strip()
    rtype_key = rtype.casefold()
    event_type = str(_value(row, "EventType", "")).casefold()

    if rtype_key == "turnout":
        return "turnout"
    if rtype_key == "electorate":
        return "electorate"
    if rtype_key == "spoiled" or is_spoiled_label(rtype):
        return "spoiled"
    if is_dnv_label(rtype):
        return "did_not_vote"
    if rtype_key == "answer" or event_type in REFERENDUM_TYPE_KEYS:
        return "referendum_option"
    if rtype_key.startswith("regionallistcandidate") or rtype_key.startswith("listcandidate"):
        return "party"
    return "party"


def _resolve_option_and_party(row, result_kind: str) -> Tuple[str, str, str, str]:
    if result_kind == "referendum_option":
        raw_label = _value(row, "Name usually known by", "") or _value(row, "Party Name", "")
        label = normalize_option_label(raw_label) or normalize_option_label(_value(row, "ResultType", ""))
        if not label:
            label = "Unknown option"
        return label, label.casefold(), "", ""

    if result_kind == "did_not_vote":
        return "Did not vote", "did_not_vote", "", ""

    if result_kind == "spoiled":
        return "Spoiled", "spoiled", "", ""

    if result_kind == "turnout":
        return "Turnout", "turnout", "", ""

    if result_kind == "electorate":
        return "Electorate", "electorate", "", ""

    party_label = _resolve_party_label(row)
    party_key = normalize_party_key(party_label) if party_label else ""
    if not party_label:
        party_label = "Unknown/Independent"
    return party_label, party_key or party_label.casefold(), party_label, party_key


def _resolve_party_label(row) -> str:
    candidates = [
        _value(row, "Party Name", ""),
        _value(row, "Party", ""),
        _value(row, "Source Party Name", ""),
    ]
    invalid_tokens = {"", "nan", "none", "null", "n/a", "na"}
    for candidate in candidates:
        candidate = str(candidate or "").strip()
        lowered = candidate.casefold()
        if lowered in invalid_tokens:
            continue
        if candidate:
            return candidate
    return ""


def _classify_area_scope(area_name: str) -> str:
    lowered = area_name.casefold()
    if lowered in NATION_LABELS:
        return "nation"
    if "," in area_name:
        return "constituency_group"
    return "constituency"


def _make_area_key(area_name: str, area_scope: str) -> str:
    if area_scope == "nation":
        return "nation::northern-ireland"

    cleaned = _slugify(area_name)
    if area_scope == "constituency_group":
        parts = sorted(_slugify(part) for part in area_name.split(",") if part.strip())
        cleaned = "+".join(parts)
        return f"group::{cleaned}" if cleaned else "group::unknown"
    return f"constituency::{cleaned}" if cleaned else "constituency::unknown"


def _slugify(value: str) -> str:
    text = normalize_constituency_name(value)
    text = text.casefold()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def _collect_person_ids(values: Iterable) -> Tuple[int, ...]:
    found: set[int] = set()
    for val in values:
        if val is None or (isinstance(val, float) and math.isnan(val)):
            continue
        try:
            iv = int(float(val))
        except Exception:
            continue
        found.add(iv)
    return tuple(sorted(found))


def _aggregate_structured_rows(base: pd.DataFrame) -> pd.DataFrame:
    group_cols = [
        "date",
        "date_str",
        "event",
        "event_type",
        "elected_body",
        "area_name",
        "area_key",
        "area_scope",
        "result_kind",
        "option_label",
        "option_key",
        "party_name",
        "party_key",
        "is_valid_vote",
        "source",
        "devolved_instance",
        "wm_instance",
        "eu_instance",
        "total_instance",
    ]

    aggregated = (
        base.groupby(group_cols, dropna=False)
        .agg(
            votes=("votes", "sum"),
            candidate_count=("candidate_count", "sum"),
            source_result_types=("source_result_type", _merge_strings),
            person_ids=("person_ids", _merge_person_id_tuples),
        )
        .reset_index()
    )

    aggregated["candidate_count"] = aggregated["candidate_count"].fillna(0).astype(int)
    aggregated["votes"] = aggregated["votes"].astype(float)
    aggregated["source_result_types"] = aggregated["source_result_types"].apply(tuple)
    aggregated["person_ids"] = aggregated["person_ids"].apply(tuple)
    return aggregated


def _merge_strings(values: Sequence[str]) -> Tuple[str, ...]:
    seen = []
    for value in values:
        if not value:
            continue
        if value not in seen:
            seen.append(value)
    return tuple(seen)


def _merge_person_id_tuples(values: Sequence[Tuple[int, ...]]) -> Tuple[int, ...]:
    collected: set[int] = set()
    for ids in values:
        for pid in ids:
            collected.add(int(pid))
    return tuple(sorted(collected))


def _merge_string_tuples(values: Sequence[Tuple[str, ...]]) -> Tuple[str, ...]:
    collected: List[str] = []
    for tup in values:
        for val in tup:
            if val and val not in collected:
                collected.append(val)
    return tuple(collected)


def _unique_preserve_order(values: Sequence[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


# ---------------------------------------------------------------------------
# Referendum party outcome allocation
# ---------------------------------------------------------------------------


def build_referendum_party_results(
    results: pd.DataFrame, endorsements: pd.DataFrame
) -> pd.DataFrame:
    """Allocate referendum outcomes down to the party level."""

    columns = [
        "date",
        "date_str",
        "event",
        "event_type",
        "elected_body",
        "area_key",
        "area_name",
        "party_key",
        "party_family",
        "endorsement_option",
        "party_baseline_share",
        "party_total_votes",
        "party_electorate",
        "option_label",
        "option_votes",
        "option_share_of_party",
        "option_share_of_total",
        "total_votes",
        "electorate",
    ]

    if results is None or results.empty:
        return pd.DataFrame(columns=columns)

    referendum_mask = results["result_kind"].isin(
        {"referendum_option", "did_not_vote", "spoiled"}
    )
    referendum_rows = results[referendum_mask].copy()
    if referendum_rows.empty:
        return pd.DataFrame(columns=columns)

    party_rows = results[results["result_kind"] == "party"].copy()
    party_rows = party_rows[party_rows["votes"].astype(float).gt(0)]
    if party_rows.empty:
        return pd.DataFrame(columns=columns)

    prepared_endorsements = _prepare_endorsements_for_history(endorsements)
    endorsement_history = (
        build_endorsement_history(prepared_endorsements)
        if prepared_endorsements is not None and not prepared_endorsements.empty
        else {}
    )

    records: List[Dict[str, object]] = []
    group_cols = [
        "date",
        "date_str",
        "event",
        "event_type",
        "elected_body",
        "area_key",
        "area_name",
    ]

    for key, frame in referendum_rows.groupby(group_cols, dropna=False):
        date_ts, date_str, event, event_type, body, area_key, area_name = key
        option_totals = _collect_referendum_option_totals(frame)
        if not option_totals:
            continue

        baseline = _resolve_party_baseline_shares(
            party_rows, area_key, pd.to_datetime(date_ts, errors="coerce")
        )
        if not baseline:
            continue

        body_key = str(body or "").strip()
        if not body_key:
            body_key = str(event or "").strip()
        endorsements_map = resolve_endorsements_for_date(
            endorsement_history, body_key, str(date_str or "")
        )
        if not endorsements_map and event:
            endorsements_map = resolve_endorsements_for_date(
                endorsement_history, str(event).strip(), str(date_str or "")
            )
        normalized_endorsements = {
            normalize_party_key(party): normalize_option_label(choice) or choice
            for party, choice in endorsements_map.items()
        }

        allocations = _allocate_party_option_votes(
            baseline, option_totals, normalized_endorsements
        )
        if not allocations:
            continue

        total_votes = float(sum(option_totals.values()))
        electorate = _lookup_referendum_electorate(
            results, area_key, date_ts, event, event_type, body
        )

        for party_key, option_map in allocations.items():
            party_total = float(sum(option_map.values()))
            if party_total <= 0:
                continue

            baseline_share = float(baseline.get(party_key, 0.0))
            endorsement_choice = normalized_endorsements.get(party_key)
            family = infer_party_family(party_key)
            party_electorate = (
                baseline_share * float(electorate)
                if electorate is not None and np.isfinite(electorate)
                else float("nan")
            )

            for option_label, votes in option_map.items():
                share_party = float(votes / party_total) if party_total else 0.0
                share_total = float(votes / total_votes) if total_votes else 0.0
                records.append(
                    {
                        "date": date_ts,
                        "date_str": date_str,
                        "event": event,
                        "event_type": event_type,
                        "elected_body": body,
                        "area_key": area_key,
                        "area_name": area_name,
                        "party_key": party_key,
                        "party_family": family,
                        "endorsement_option": endorsement_choice,
                        "party_baseline_share": baseline_share,
                        "party_total_votes": party_total,
                        "party_electorate": party_electorate,
                        "option_label": option_label,
                        "option_votes": float(votes),
                        "option_share_of_party": share_party,
                        "option_share_of_total": share_total,
                        "total_votes": total_votes,
                        "electorate": float(electorate)
                        if electorate is not None
                        else float("nan"),
                    }
                )

    if not records:
        return pd.DataFrame(columns=columns)

    frame = pd.DataFrame(records)
    return frame[columns]


def _collect_referendum_option_totals(frame: pd.DataFrame) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    for _, row in frame.iterrows():
        label = normalize_option_label(row.get("option_label", ""))
        kind = str(row.get("result_kind", ""))
        votes = float(row.get("votes", 0.0) or 0.0)
        if kind == "referendum_option" and label:
            totals[label] = totals.get(label, 0.0) + votes
        elif kind == "did_not_vote":
            totals["Did not vote"] = totals.get("Did not vote", 0.0) + votes
        elif kind == "spoiled":
            totals["Spoiled"] = totals.get("Spoiled", 0.0) + votes
    return {label: value for label, value in totals.items() if value >= 0.0}


def _resolve_party_baseline_shares(
    party_rows: pd.DataFrame, area_key: str, target_ts: Optional[pd.Timestamp]
) -> Dict[str, float]:
    if party_rows.empty:
        return {}

    subset = party_rows[party_rows["area_key"] == area_key].copy()
    subset = subset[subset["party_key"].astype(str).str.len().gt(0)]
    subset = subset[subset["votes"].astype(float).gt(0)]
    if subset.empty:
        return {}

    if target_ts is not None and not pd.isna(target_ts):
        subset = subset[subset["date"] <= target_ts]
    if subset.empty:
        return {}

    group_cols = ["date", "event", "event_type", "elected_body", "total_instance"]
    if "total_instance" not in subset.columns or subset["total_instance"].isna().all():
        group_cols = ["date", "event", "event_type", "elected_body"]
    subset["total_votes"] = subset.groupby(group_cols)["votes"].transform("sum")
    subset = subset[subset["total_votes"].astype(float).gt(0)]
    if subset.empty:
        return {}

    shares: Dict[str, float] = {}
    weights: Dict[str, float] = {}

    for _, row in subset.iterrows():
        party = str(row.get("party_key", ""))
        total = float(row.get("total_votes", 0.0) or 0.0)
        vote_share = float(row.get("votes", 0.0) or 0.0) / total if total else 0.0
        if vote_share <= 0 or not party:
            continue
        source_ts = pd.to_datetime(row.get("date"), errors="coerce")
        weight = _recency_weight(target_ts, source_ts)
        shares[party] = shares.get(party, 0.0) + vote_share * weight
        weights[party] = weights.get(party, 0.0) + weight

    normalized: Dict[str, float] = {}
    for party, total_share in shares.items():
        weight = weights.get(party, 0.0)
        if weight <= 0:
            continue
        normalized[party] = total_share / weight

    total_norm = sum(value for value in normalized.values() if value > 0)
    if total_norm > 0:
        normalized = {
            party: value / total_norm for party, value in normalized.items() if value > 0
        }
    else:
        normalized = {}
    return normalized


def _recency_weight(
    target_ts: Optional[pd.Timestamp], source_ts: Optional[pd.Timestamp]
) -> float:
    if target_ts is None or pd.isna(target_ts) or source_ts is None or pd.isna(source_ts):
        return 1.0
    delta = max((target_ts - source_ts).days / 365.25, 0.0)
    return 1.0 / (1.0 + delta)


def _allocate_party_option_votes(
    party_shares: Mapping[str, float],
    option_votes: Mapping[str, float],
    endorsements: Mapping[str, str],
) -> Dict[str, Dict[str, float]]:
    parties = {party: share for party, share in party_shares.items() if share > 0}
    if not parties:
        return {}

    normalized_options = {
        normalize_option_label(option) or option: float(votes)
        for option, votes in option_votes.items()
    }
    all_options = list(normalized_options.keys())

    endorsements_norm = {
        normalize_party_key(party): normalize_option_label(choice) or choice
        for party, choice in endorsements.items()
        if normalize_party_key(party) in parties
    }

    allocations: Dict[str, Dict[str, float]] = {
        party: {option: 0.0 for option in all_options}
        for party in parties
    }

    unendorsed = [party for party in parties if party not in endorsements_norm]

    for option, total in normalized_options.items():
        if total <= 0:
            continue

        endorsers = [party for party, choice in endorsements_norm.items() if choice == option]
        allocated = 0.0
        if endorsers:
            share_sum = sum(parties[party] for party in endorsers)
            if share_sum > 0:
                for party in endorsers:
                    portion = total * (parties[party] / share_sum)
                    allocations[party][option] += portion
                    allocated += portion

        residual = total - allocated
        if residual > 0 and unendorsed:
            share_sum = sum(parties[party] for party in unendorsed)
            if share_sum > 0:
                for party in unendorsed:
                    portion = residual * (parties[party] / share_sum)
                    allocations[party][option] += portion
                    allocated += portion

        if allocated <= 0 and parties:
            share_sum = sum(parties.values())
            if share_sum > 0:
                for party, share in parties.items():
                    allocations[party][option] += total * (share / share_sum)
                allocated = total

        if allocated > 0:
            diff = total - allocated
            if abs(diff) > 1e-6:
                largest_party = max(
                    allocations.items(), key=lambda item: item[1][option]
                )[0]
                allocations[largest_party][option] += diff

    return allocations


def _lookup_referendum_electorate(
    results: pd.DataFrame,
    area_key: str,
    date_ts: pd.Timestamp,
    event: str,
    event_type: str,
    body: str,
) -> Optional[float]:
    matching = results[
        (results["area_key"] == area_key)
        & (results["result_kind"].isin({"electorate", "turnout"}))
        & (results["event"] == event)
        & (results["event_type"] == event_type)
        & (results["elected_body"] == body)
        & (results["date"] == date_ts)
    ]
    if matching.empty:
        return None
    votes = matching["votes"].astype(float)
    total = float(votes.max()) if not votes.empty else float("nan")
    return total if np.isfinite(total) else None


def _prepare_endorsements_for_history(
    endorsements: Optional[pd.DataFrame],
) -> Optional[pd.DataFrame]:
    if endorsements is None or endorsements.empty:
        return endorsements

    prepared = endorsements.copy()
    if "Party" not in prepared.columns and "party" in prepared.columns:
        prepared["Party"] = prepared["party"].astype(str)
    if "EndorsedClean" not in prepared.columns and "option_label" in prepared.columns:
        prepared["EndorsedClean"] = prepared["option_label"].astype(str)
    if "Endorsed" not in prepared.columns and "endorsement_raw" in prepared.columns:
        prepared["Endorsed"] = prepared["endorsement_raw"].astype(str)
    if "Date" not in prepared.columns and "date" in prepared.columns:
        prepared["Date"] = prepared["date"]
    if "DateStr" not in prepared.columns and "date_str" in prepared.columns:
        prepared["DateStr"] = prepared["date_str"].astype(str)
    if "BodyKey" not in prepared.columns and "body_key" in prepared.columns:
        prepared["BodyKey"] = prepared["body_key"].astype(str)
    return prepared


def _collect_result_issues(results: pd.DataFrame) -> List[str]:
    issues: List[str] = []
    if results is None or results.empty:
        return issues

    missing_party = results[
        (results["result_kind"] == "party") & (~results["party_key"].astype(str).str.len().gt(0))
    ]
    if not missing_party.empty:
        sample = missing_party.head(3)[["date_str", "event", "area_name", "party_name"]]
        issues.append(
            "Party rows missing normalised keys: "
            f"{len(missing_party)} issue(s) (examples: {sample.to_dict('records')})"
        )

    negative_votes = results[results["votes"] < 0]
    if not negative_votes.empty:
        sample = negative_votes.head(3)[["date_str", "event", "area_name", "option_label", "votes"]]
        issues.append(
            "Negative vote totals detected: "
            f"{len(negative_votes)} row(s) (examples: {sample.to_dict('records')})"
        )

    return issues


def _collect_endorsement_issues(endorsements: pd.DataFrame) -> List[str]:
    issues: List[str] = []
    if endorsements is None or endorsements.empty:
        return issues

    missing_option = endorsements[endorsements["option_label"].isna()]
    if not missing_option.empty:
        sample = missing_option.head(3)[["date_str", "body_key", "party", "endorsement_raw"]]
        issues.append(
            "Endorsement rows missing recognised options: "
            f"{len(missing_option)} issue(s) (examples: {sample.to_dict('records')})"
        )

    return issues


__all__ = [
    "StructuredElectionData",
    "aggregate_nationwide",
    "build_area_register",
    "build_party_register",
    "ingest_election_data",
    "normalize_election_results",
    "normalize_endorsements",
]

