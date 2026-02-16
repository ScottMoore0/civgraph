"""Temporal and multi-election referendum feature engineering.

This module consumes :class:`~ni_votes.data.ingestion.StructuredElectionData`
outputs to construct feature rows that capture constituency and NI-wide vote
history, endorsement strength and recency-aware metrics for referendum
modelling.  The helpers introduced here form the bridge between the enriched
historic datasets (added in task 1) and future modelling work that requires a
fully data-driven understanding of how parties and endorsements evolve over
time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple

import math
import re

import numpy as np
import pandas as pd

from ..config import (
    REFERENDUM_BODY_ELECTION_FAMILIES,
    REFERENDUM_EVENT_TYPE_FAMILIES,
)
from ..data import StructuredElectionData
from ..utils import normalize_constituency_name, normalize_option_label


FeatureDict = Dict[str, float]


@dataclass
class FeatureAssemblyConfig:
    """Configuration for temporal referendum feature assembly."""

    target_date: Optional[str]
    constituency: str
    event_type: str
    elected_body: str
    options: Sequence[str]
    body_key: Optional[str] = None
    families_override: Optional[Sequence[str]] = None
    # New toggle parameters for NI Assembly scenarios
    include_constitutional_convention: bool = False
    include_european_parliament: bool = False


@dataclass
class TemporalFeatureResult:
    """Return value produced by :func:`build_temporal_feature_row`."""

    frame: pd.DataFrame
    metadata: Dict[str, object]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_temporal_feature_row(
    data: StructuredElectionData,
    config: FeatureAssemblyConfig,
    *,
    endorsements: Optional[pd.DataFrame] = None,
) -> TemporalFeatureResult:
    """Construct a single-row dataframe of temporal referendum features."""

    if endorsements is None:
        endorsements = data.endorsements

    target_ts = _resolve_target_timestamp(config.target_date, data)
    families = _resolve_election_families(config)
    constituency_key, constituency_name = _resolve_constituency_key(data, config.constituency)

    constituency_history = _collect_election_history(
        data.constituency_results, constituency_key, families, target_ts
    )
    nation_history = _collect_election_history(
        data.nation_results, "nation::northern-ireland", families, target_ts
    )

    feature_row: FeatureDict = {}
    feature_row.update(
        _history_to_feature_dict(
            constituency_history, prefix="constituency", include_combined=True
        )
    )
    feature_row.update(
        _history_to_feature_dict(nation_history, prefix="nation", include_combined=True)
    )

    combined_nation_share = nation_history.combined_share
    feature_row.update(
        _build_endorsement_features(
            endorsements,
            config.body_key or config.elected_body,
            target_ts,
            config.options,
            combined_nation_share,
        )
    )

    feature_row["constituency_key"] = constituency_key
    feature_row["constituency_name"] = constituency_name
    feature_row["target_date"] = target_ts.isoformat() if target_ts is not None else ""

    frame = pd.DataFrame([feature_row]).fillna(np.nan)
    metadata = {
        "families_used": tuple(sorted(families)),
        "constituency_key": constituency_key,
        "constituency_name": constituency_name,
        "target_timestamp": target_ts,
        "body_key": config.body_key or config.elected_body,
    }

    return TemporalFeatureResult(frame=frame, metadata=metadata)


# ---------------------------------------------------------------------------
# Election family resolution & area lookup
# ---------------------------------------------------------------------------


def _resolve_election_families(config: FeatureAssemblyConfig) -> List[str]:
    if config.families_override:
        families = [str(f) for f in config.families_override if str(f).strip()]
        return families or [str(config.event_type or "").strip() or "DevolvedElection"]

    event_fams: List[str] = []
    body_fams: List[str] = []

    event_key = str(config.event_type or "").strip().casefold()
    body_key = str(config.body_key or config.elected_body or "").strip().casefold()

    if event_key in REFERENDUM_EVENT_TYPE_FAMILIES:
        event_fams.extend(REFERENDUM_EVENT_TYPE_FAMILIES[event_key])
    elif config.event_type:
        text = str(config.event_type).strip()
        if text:
            event_fams.append(text)

    if body_key in REFERENDUM_BODY_ELECTION_FAMILIES:
        body_fams.extend(REFERENDUM_BODY_ELECTION_FAMILIES[body_key])
    elif config.elected_body:
        text = str(config.elected_body).strip()
        if text:
            body_fams.append(text)

    event_fams = _dedupe_preserve_order(event_fams)
    body_fams = _dedupe_preserve_order(body_fams)

    if body_fams:
        allowed = {fam for fam in body_fams if fam}
        families = list(body_fams)
        for fam in event_fams:
            if allowed and fam not in allowed:
                continue
            if fam not in families and fam:
                families.append(fam)
    else:
        families = list(event_fams)

    # Special handling for Northern Ireland Assembly with DevolvedElection
    if (body_key == "northern ireland assembly" and 
        event_key == "devolvedelection" and
        (config.include_constitutional_convention or config.include_european_parliament)):
        
        # Add Constitutional Convention elections if requested
        if config.include_constitutional_convention:
            if "ConstitutionalConvention" not in families:
                families.append("ConstitutionalConvention")
        
        # Add European Parliament elections if requested
        if config.include_european_parliament:
            if "EuropeanElection" not in families:
                families.append("EuropeanElection")

    if not families:
        fallback = str(config.event_type or "DevolvedElection").strip() or "DevolvedElection"
        families = [fallback]

    return _dedupe_preserve_order(families)


def _dedupe_preserve_order(values: Sequence[str]) -> List[str]:
    seen = set()
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


def _resolve_constituency_key(
    data: StructuredElectionData, constituency: str
) -> Tuple[str, str]:
    normalized = normalize_constituency_name(constituency) or "Northern Ireland"
    const_results = data.constituency_results
    mask = const_results["area_name"].astype(str).str.casefold() == normalized.casefold()
    if mask.any():
        row = const_results[mask].iloc[0]
        return str(row["area_key"]), str(row["area_name"])

    register = data.area_register
    if register is not None and not register.empty:
        for _, row in register.iterrows():
            history = row.get("name_history", ())
            if isinstance(history, (list, tuple)):
                for name in history:
                    if str(name).casefold() == normalized.casefold():
                        return str(row["area_key"]), str(name)

    slug = _slugify(normalized)
    return f"constituency::{slug}" if slug else "constituency::unknown", normalized


# ---------------------------------------------------------------------------
# Election history processing
# ---------------------------------------------------------------------------


@dataclass
class _ElectionHistory:
    family_records: Dict[str, List[Tuple[pd.Timestamp, FeatureDict]]]
    combined_records: List[Tuple[str, pd.Timestamp, FeatureDict]]
    summaries: Dict[str, "_HistorySummary"]
    combined_summary: "_HistorySummary"

    @property
    def combined_share(self) -> FeatureDict:
        return self.combined_summary.share


@dataclass
class _HistorySummary:
    share: FeatureDict
    recency_years: float
    election_count: int
    weight_sum: float


def _collect_election_history(
    results: pd.DataFrame,
    area_key: str,
    families: Iterable[str],
    target_ts: Optional[pd.Timestamp],
) -> _ElectionHistory:
    families = list(families)
    family_records: Dict[str, List[Tuple[pd.Timestamp, FeatureDict]]] = {}
    combined_records: List[Tuple[str, pd.Timestamp, FeatureDict]] = []
    summaries: Dict[str, _HistorySummary] = {}

    for family in families:
        records = _extract_family_records(results, area_key, family, target_ts)
        family_records[family] = records
        summaries[family] = _summarise_records(records, target_ts)
        combined_records.extend((family, ts, share) for ts, share in records)

    combined_summary = _summarise_records(
        [(ts, share) for _, ts, share in combined_records], target_ts
    )

    return _ElectionHistory(
        family_records=family_records,
        combined_records=combined_records,
        summaries=summaries,
        combined_summary=combined_summary,
    )


def _extract_family_records(
    results: pd.DataFrame,
    area_key: str,
    family: str,
    target_ts: Optional[pd.Timestamp],
) -> List[Tuple[pd.Timestamp, FeatureDict]]:
    if results is None or results.empty:
        return []

    frame = results.copy()
    frame = frame[frame["area_key"].astype(str) == str(area_key)]
    frame = frame[frame["result_kind"].astype(str) == "party"]
    fam_mask = frame["event_type"].astype(str).str.casefold() == family.casefold()
    frame = frame[fam_mask]

    if frame.empty:
        return []

    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame[frame["date"].notna()]

    if target_ts is not None and not pd.isna(target_ts):
        prior = frame[frame["date"] <= target_ts]
        if not prior.empty:
            frame = prior
        else:
            frame = frame.sort_values("date", ascending=True, kind="mergesort").head(1)

    grouped: List[Tuple[pd.Timestamp, FeatureDict]] = []
    for date_ts, grp in frame.groupby("date"):
        total_votes = grp["votes"].sum()
        if not np.isfinite(total_votes) or total_votes <= 0:
            continue
        shares: MutableMapping[str, float] = {}
        for party_key, rows in grp.groupby("party_key"):
            key = str(party_key).strip()
            if not key:
                continue
            votes = rows["votes"].sum()
            share = float(votes) / float(total_votes)
            shares[key] = share
        if shares:
            grouped.append((pd.Timestamp(date_ts), dict(shares)))

    grouped.sort(key=lambda item: item[0])
    return grouped


def _summarise_records(
    records: Sequence[Tuple[pd.Timestamp, FeatureDict]],
    target_ts: Optional[pd.Timestamp],
) -> _HistorySummary:
    if not records:
        return _HistorySummary(share={}, recency_years=math.nan, election_count=0, weight_sum=0.0)

    if target_ts is None or pd.isna(target_ts):
        target_ts = max(ts for ts, _ in records)

    share_acc: MutableMapping[str, float] = {}
    weight_per_party: MutableMapping[str, float] = {}
    weight_sum = 0.0
    latest_recency = math.nan
    latest_ts: Optional[pd.Timestamp] = None

    for date_ts, share_map in records:
        years = _years_between(target_ts, date_ts)
        weight = 1.0 / (1.0 + years)
        weight_sum += weight
        total = sum(float(val) for val in share_map.values() if float(val) > 0)
        if total <= 0:
            continue
        for party, share in share_map.items():
            value = float(share)
            if value <= 0:
                continue
            normalised = value / total
            share_acc[party] = share_acc.get(party, 0.0) + normalised * weight
            weight_per_party[party] = weight_per_party.get(party, 0.0) + weight
        if latest_ts is None or date_ts > latest_ts:
            latest_ts = date_ts
            latest_recency = years

    combined: FeatureDict = {}
    for party, value in share_acc.items():
        w = weight_per_party.get(party, 0.0)
        if w <= 0:
            continue
        combined[party] = value / w

    total_combined = sum(combined.values())
    if total_combined > 0:
        combined = {party: val / total_combined for party, val in combined.items()}
    return _HistorySummary(
        share=combined,
        recency_years=latest_recency,
        election_count=len(records),
        weight_sum=weight_sum,
    )


def _history_to_feature_dict(
    history: _ElectionHistory,
    *,
    prefix: str,
    include_combined: bool,
) -> FeatureDict:
    features: FeatureDict = {}
    for family, summary in history.summaries.items():
        features[f"{prefix}_recency_years::{family}"] = summary.recency_years
        features[f"{prefix}_election_count::{family}"] = float(summary.election_count)
        features[f"{prefix}_weight_sum::{family}"] = summary.weight_sum
        for party, share in summary.share.items():
            features[f"{prefix}_share::{family}::{party}"] = share

    if include_combined:
        combined = history.combined_summary
        features[f"{prefix}_recency_years::combined"] = combined.recency_years
        features[f"{prefix}_election_count::combined"] = float(combined.election_count)
        features[f"{prefix}_weight_sum::combined"] = combined.weight_sum
        for party, share in combined.share.items():
            features[f"{prefix}_share::combined::{party}"] = share

    return features


# ---------------------------------------------------------------------------
# Endorsement features
# ---------------------------------------------------------------------------


def _build_endorsement_features(
    endorsements: Optional[pd.DataFrame],
    body_key: str,
    target_ts: Optional[pd.Timestamp],
    options: Sequence[str],
    party_weights: Mapping[str, float],
) -> FeatureDict:
    features: FeatureDict = {}
    if endorsements is None or endorsements.empty:
        return features

    body_cf = str(body_key or "").strip().casefold()
    if not body_cf:
        return features

    frame = endorsements.copy()
    frame["body_key"] = frame.get("body_key", "").astype(str)
    frame["body_cf"] = frame["body_key"].str.strip().str.casefold()
    frame = frame[frame["body_cf"] == body_cf]

    if frame.empty:
        return features

    date_source = None
    for candidate in ("date", "Date", "date_str", "DateStr"):
        if candidate in frame.columns:
            date_source = frame[candidate]
            break
    if date_source is None:
        date_source = frame.get("Date")

    ts_col = "_endorsement_ts"
    frame[ts_col] = pd.to_datetime(date_source, errors="coerce")
    frame = frame[frame[ts_col].notna()]

    if target_ts is not None and not pd.isna(target_ts):
        frame = frame[frame[ts_col] <= target_ts]
    if frame.empty:
        return features

    frame["party_key"] = frame.get("party_key", "").fillna("").astype(str).str.strip()
    frame = frame[frame["party_key"].astype(str).str.len().gt(0)]
    if frame.empty:
        return features

    frame["option_label"] = frame.get("option_label", "").apply(normalize_option_label)
    frame = frame[frame["option_label"].astype(str).str.len().gt(0)]
    if frame.empty:
        return features

    frame = frame.sort_values(["party_key", ts_col], ascending=[True, False], kind="mergesort")
    latest = frame.drop_duplicates(subset=["party_key"], keep="first")

    latest_option_groups = latest.groupby("option_label")

    option_labels = [normalize_option_label(opt) or opt for opt in options]
    label_to_original = {normalize_option_label(opt) or opt: str(opt) for opt in options}
    seen_parties: set[str] = set()

    for option in option_labels:
        opt_key = _option_feature_key(option)
        parties = latest_option_groups.get_group(option)["party_key"].tolist() if option in latest_option_groups.groups else []
        seen_parties.update(parties)
        features[f"endorsement_party_count::{opt_key}"] = float(len(parties))
        weight = sum(float(party_weights.get(party, 0.0)) for party in parties)
        features[f"endorsement_weighted_share::{opt_key}"] = weight
        canonical_label = label_to_original.get(option, option if option else opt_key)
        features[f"share_endorsing::{canonical_label}"] = weight

    features["endorsement_unique_parties"] = float(len(seen_parties))

    latest_ts = latest[ts_col].max()
    if target_ts is not None and not pd.isna(target_ts):
        features["endorsement_recency_years"] = _years_between(target_ts, latest_ts)
    else:
        features["endorsement_recency_years"] = 0.0

    return features


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _resolve_target_timestamp(
    target_date: Optional[str], data: StructuredElectionData
) -> Optional[pd.Timestamp]:
    if target_date:
        ts = pd.to_datetime(target_date, errors="coerce")
        if pd.notna(ts):
            return ts

    date_cols = []
    if data.constituency_results is not None and not data.constituency_results.empty:
        date_cols.append(pd.to_datetime(data.constituency_results["date"], errors="coerce"))
    if data.nation_results is not None and not data.nation_results.empty:
        date_cols.append(pd.to_datetime(data.nation_results["date"], errors="coerce"))

    if date_cols:
        merged = pd.concat(date_cols)
        merged = merged[merged.notna()]
        if not merged.empty:
            return merged.max()
    return None


def _years_between(target_ts: pd.Timestamp, past_ts: pd.Timestamp) -> float:
    diff_days = (target_ts - past_ts).days
    if diff_days <= 0:
        return 0.0
    return diff_days / 365.25


def _slugify(text: str) -> str:
    lowered = normalize_constituency_name(text)
    lowered = lowered.casefold()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    return lowered.strip("-")


def _option_feature_key(label: str) -> str:
    cleaned = normalize_option_label(label) or str(label)
    cleaned = cleaned.casefold()
    cleaned = re.sub(r"[^a-z0-9]+", "_", cleaned)
    cleaned = cleaned.strip("_")
    return cleaned or "unknown"

