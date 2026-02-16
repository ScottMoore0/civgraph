"""Helpers for constructing transfer training data from ML tables."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple
import json

import numpy as np
import pandas as pd

from .base import _clean_party, _party_col

__all__ = [
    "build_training_from_ml_tables",
    "_canonical_event",
    "_canonical_body",
    "_canonical_event_for_model",
    "_canonical_body_for_model",
]


def _canonical_event(value: Any) -> str:
    """Return a canonical token for known election event labels."""

    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    collapsed = "".join(ch for ch in text.casefold() if ch.isalnum())

    aliases = {
        "europeanelection": "EuropeanElection",
        "europeanparliamentelection": "EuropeanElection",
        "devolvedelection": "DevolvedElection",
        "assemblyelection": "AssemblyElection",
        "northernirelandassemblyelection": "AssemblyElection",
        "generalelection": "GeneralElection",
        "westminsterelection": "GeneralElection",
        "localelection": "LocalElection",
    }

    canonical = aliases.get(collapsed)
    if canonical:
        return canonical

    return text


def _canonical_body(value: Any) -> str:
    """Return a canonical label for common elected-body strings."""

    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    collapsed = "".join(ch for ch in text.casefold() if ch.isalnum())

    aliases = {
        "northernirelandassembly": "Northern Ireland Assembly",
        "niassembly": "Northern Ireland Assembly",
        "northernirelandconstitutionalconvention": "Northern Ireland Constitutional Convention",
        "niconstitutionalconvention": "Northern Ireland Constitutional Convention",
        "europeanparliament": "European Parliament",
    }

    canonical = aliases.get(collapsed)
    if canonical:
        return canonical

    return text


def _canonical_event_for_model(value: Any) -> str:
    """Collapse event labels to the tokens consumed by the ML model."""

    canonical = _canonical_event(value)
    if not canonical:
        canonical = str(value or "").strip()

    token_cf = str(canonical).strip().casefold()
    if token_cf in {
        "assemblyelection",
        "devolvedelection",
        "europeanelection",
        "assembly",
        "northernirelandassembly",
        "northernirelandconstitutionalconvention",
        "europeanparliament",
        "regionalelection",
    }:
        return "RegionalElection"

    return str(canonical)


def _canonical_body_for_model(value: Any) -> str:
    """Collapse elected-body labels to the tokens consumed by the ML model."""

    canonical = _canonical_body(value)
    token_cf = str(canonical).strip().casefold()
    if token_cf in {
        "northern ireland assembly",
        "northern ireland constitutional convention",
        "european parliament",
        "regionalbody",
    }:
        return "RegionalBody"

    return str(canonical)


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    if values.size == 0:
        return 0.0
    order = np.argsort(values)
    vals_sorted = values[order]
    w_sorted = weights[order]
    cum = np.cumsum(w_sorted)
    cutoff = float(w_sorted.sum()) / 2.0
    idx = int(np.searchsorted(cum, cutoff, side="left"))
    idx = min(max(idx, 0), len(vals_sorted) - 1)
    return float(vals_sorted[idx])


def _split_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, float) and pd.isna(value):
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _augment_sparse_donors(
    df: pd.DataFrame,
    full_df: pd.DataFrame,
    *,
    allowed_events_cf: Optional[set] = None,
    allowed_bodies_cf: Optional[set] = None,
    canonical_event: Optional[str] = None,
    canonical_body: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, Dict[str, Any]]]:
    """Augment sparse donor distributions with pooled STV data.

    When scenario filters leave donors with insufficient coverage (few
    destinations or drastically reduced weights), layer in devolved/local
    transfer rows to restore historical balance. The returned metadata captures
    how much weight was sourced from pooled events for transparency in the
    fallback prior construction.
    """

    if df is None or full_df is None or full_df.empty:
        return df, {}

    filtered = df.copy()
    pooled_meta: Dict[str, Dict[str, Any]] = {}
    filters_meta: Dict[str, Any] = {}
    if allowed_events_cf:
        filters_meta["allowed_events"] = sorted(str(ev) for ev in allowed_events_cf)
    if allowed_bodies_cf:
        filters_meta["allowed_bodies"] = sorted(str(body) for body in allowed_bodies_cf)

    # Only augment when scenario-level filters are active.
    if not (allowed_events_cf or allowed_bodies_cf):
        return filtered, pooled_meta

    if filtered.empty:
        return filtered, pooled_meta

    donors = set(str(party) for party in filtered["TransferParty"].dropna().unique())
    if not donors:
        return filtered, pooled_meta

    def _count_unique_dest(data: pd.DataFrame) -> pd.Series:
        if data.empty:
            return pd.Series(dtype=float)
        rel = data[
            data["TransferPartyRelation"].str.casefold() != "nontransferable"
        ].copy()
        if rel.empty:
            return pd.Series(dtype=float)
        rel["_DestParty"] = rel["Party"].astype(str)
        counts = rel.groupby("TransferParty")["_DestParty"].nunique()
        return counts.astype(float)

    def _sum_weights(data: pd.DataFrame) -> pd.Series:
        if data.empty:
            return pd.Series(dtype=float)
        return data.groupby("TransferParty")["Transfers"].sum().astype(float)

    # Restrict the donor pool to STV-style events so we don't mix incompatible
    # transfer regimes (e.g. Westminster FPTP results).
    stv_event_tokens = {
        "devolvedelection",
        "europeanelection",
        "localelection",
        "byelection",
        "customelection",
    }
    full_events_cf = full_df["Event"].map(_canonical_event).astype(str).str.casefold()
    stv_mask = full_events_cf.isin(stv_event_tokens)
    stv_source = full_df[stv_mask].copy() if stv_mask.any() else full_df.copy()
    if stv_source.empty:
        return filtered, pooled_meta

    full_totals = _sum_weights(stv_source)
    full_unique = _count_unique_dest(stv_source)

    filtered_totals = _sum_weights(filtered)
    filtered_unique = _count_unique_dest(filtered)

    donors_to_augment: List[str] = []
    for donor in donors:
        base_total = float(full_totals.get(donor, 0.0))
        base_unique = int(full_unique.get(donor, 0))
        filt_total = float(filtered_totals.get(donor, 0.0))
        filt_unique = int(filtered_unique.get(donor, 0))
        if base_total <= 0:
            continue
        coverage_ratio = float(filt_total / base_total) if base_total else 0.0
        # Flag donors with heavily reduced coverage or missing counterparties.
        needs_weight = coverage_ratio < 0.6
        needs_unique = base_unique >= 2 and filt_unique < min(base_unique, 2)
        if needs_weight or needs_unique:
            donors_to_augment.append(donor)

    if not donors_to_augment:
        return filtered, pooled_meta

    pooled_rows: List[pd.DataFrame] = []
    stv_source = stv_source.copy()
    stv_source["TransferParty"] = stv_source["TransferParty"].astype(str)

    # Remove rows already present in the filtered subset to avoid duplicates.
    base_index = set(filtered.index)
    stv_source = stv_source[~stv_source.index.isin(base_index)]

    if allowed_events_cf:
        allowed_set = {str(ev).casefold() for ev in allowed_events_cf}
    else:
        allowed_set = set()

    stv_source_events = stv_source["Event"].map(_canonical_event).astype(str).str.casefold()
    if allowed_set:
        stv_source = stv_source[~stv_source_events.isin(allowed_set)]
        stv_source_events = stv_source["Event"].map(_canonical_event).astype(str).str.casefold()

    if stv_source.empty:
        return filtered, pooled_meta

    stv_totals = _sum_weights(stv_source)

    for donor in donors_to_augment:
        donor_pool = stv_source[stv_source["TransferParty"] == donor].copy()
        if donor_pool.empty:
            continue
        base_total = float(full_totals.get(donor, 0.0))
        filt_total = float(filtered_totals.get(donor, 0.0))
        donor_available = float(stv_totals.get(donor, 0.0))
        if donor_available <= 0 or base_total <= 0:
            continue
        needed = max(base_total - filt_total, 0.0)
        if needed <= 0:
            continue
        scale = min(1.0, float(needed / donor_available)) if donor_available > 0 else 0.0
        if scale <= 0:
            continue
        donor_pool["Transfers"] = donor_pool["Transfers"].astype(float) * scale
        donor_pool["PooledSource"] = "pooled_stv"
        donor_pool["PooledSourceEvent"] = donor_pool["Event"].map(
            lambda val: _canonical_event(val) or str(val)
        )
        donor_pool["PooledSourceBody"] = donor_pool["ElectedBody"].astype(str)
        if canonical_event:
            donor_pool["Event"] = canonical_event
        else:
            donor_pool["Event"] = donor_pool["Event"].map(
                lambda val: _canonical_event(val) or str(val)
            )
        if canonical_body:
            donor_pool["ElectedBody"] = canonical_body
        pooled_rows.append(donor_pool)
        pooled_meta[donor] = {
            "weight_added": float(donor_pool["Transfers"].sum()),
            "weight_scale": float(scale),
            "base_weight": base_total,
            "filtered_weight": filt_total,
            "source_events": sorted(
                {
                    _canonical_event(val) or str(val)
                    for val in donor_pool.get("PooledSourceEvent", pd.Series(dtype=str))
                }
            ),
        }

    if not pooled_rows:
        if pooled_meta and filters_meta:
            pooled_meta.setdefault("__filters__", filters_meta)
        return filtered, pooled_meta

    augmented = pd.concat([filtered] + pooled_rows, ignore_index=True, copy=False)
    if filters_meta:
        pooled_meta.setdefault("__filters__", filters_meta)
    return augmented, pooled_meta


def _build_from_transfer_sheet(
    er_df: pd.DataFrame,
    transfers_df: pd.DataFrame,
    scenario_dict: Optional[Dict[str, Any]] = None,
) -> pd.DataFrame:
    df = transfers_df.copy()
    if df.empty:
        return pd.DataFrame()

    df.columns = [str(c) for c in df.columns]

    if "DateStr" in df.columns:
        df["DateStr"] = df["DateStr"].astype(str)
    elif "Date" in df.columns:
        df["DateStr"] = pd.to_datetime(df["Date"], errors="coerce").dt.strftime("%Y-%m-%d")
    else:
        df["DateStr"] = ""

    def _as_str_column(name: str, default: str = "") -> pd.Series:
        if name in df.columns:
            return df[name].astype(str)
        if df.empty:
            return pd.Series([], dtype=str)
        return pd.Series([default] * len(df), index=df.index, dtype=str)

    df["Event"] = _as_str_column("Event")
    df["Constituency"] = _as_str_column("Constituency")
    df["ElectedBody"] = _as_str_column("ElectedBody")
    df["TransferParty"] = _as_str_column("TransferParty").apply(_clean_party)
    df.loc[
        df["TransferParty"].str.casefold().isin({"nan", "none"}),
        "TransferParty",
    ] = ""
    df["Party"] = _as_str_column("Party").apply(_clean_party)
    df.loc[df["Party"].str.casefold().isin({"nan", "none"}), "Party"] = ""
    df["TransferPartyRelation"] = (
        _as_str_column("TransferPartyRelation").astype(str).str.strip()
    )
    relation_cf = df["TransferPartyRelation"].str.casefold()
    relation_missing = relation_cf.isin({"", "nan", "none"})
    dest_tokens = df["Party"].astype(str).str.strip()
    dest_blank = dest_tokens.str.casefold().isin({"", "nan", "none"})
    donor_tokens = df["TransferParty"].astype(str).str.strip().str.casefold()
    same_party = (~dest_blank) & (donor_tokens == dest_tokens.str.casefold())
    df.loc[relation_missing & dest_blank, "TransferPartyRelation"] = "nontransferable"
    df.loc[relation_missing & same_party, "TransferPartyRelation"] = "same party"
    df.loc[
        relation_missing & ~(dest_blank | same_party),
        "TransferPartyRelation",
    ] = "different party"
    df["Count"] = pd.to_numeric(df.get("Count"), errors="coerce").fillna(0).astype(int)
    df["Transfers"] = pd.to_numeric(df.get("Transfers"), errors="coerce").fillna(0.0)
    df["SourcePersonID"] = pd.to_numeric(df.get("SourcePersonID"), errors="coerce")

    allowed_events_cf: Optional[set] = None
    allowed_bodies_cf: Optional[set] = None
    scenario_event_token: Optional[str] = None
    scenario_body_token: Optional[str] = None
    scenario_event_sources: Optional[set] = None
    scenario_body_sources: Optional[set] = None
    if isinstance(scenario_dict, dict):
        event_raw = str(scenario_dict.get("event", "") or "").strip()
        event_cf = event_raw.casefold()
        scenario_event_token = None
        scenario_event_sources = set()
        if event_cf:
            if event_cf == "customelection":
                allowed_events_cf = {
                    "assemblyelection",
                    "devolvedelection",
                    "europeanelection",
                }
                scenario_event_token = "RegionalElection"
                scenario_event_sources.update(
                    {
                        _canonical_event(label) or str(label)
                        for label in allowed_events_cf
                    }
                )
            else:
                canonical_event = _canonical_event(event_raw)
                if canonical_event:
                    scenario_event_sources.add(canonical_event)
                    scenario_event_token = _canonical_event_for_model(canonical_event)
                    if scenario_event_token == "RegionalElection":
                        allowed_events_cf = {
                            "assemblyelection",
                            "devolvedelection",
                            "europeanelection",
                        }
                        scenario_event_sources.update(
                            {
                                _canonical_event(label) or str(label)
                                for label in allowed_events_cf
                            }
                        )
                    else:
                        allowed_events_cf = {canonical_event.casefold()}
        body_raw = str(scenario_dict.get("elected_body", "") or "").strip()
        scenario_body_token = None
        scenario_body_sources = set()
        body = body_raw.casefold()
        if body:
            if body == "custombody":
                allowed_bodies_cf = {
                    "northern ireland assembly",
                    "northern ireland constitutional convention",
                    "european parliament",
                }
                scenario_body_token = "RegionalBody"
                scenario_body_sources.update(
                    {
                        _canonical_body(label) or str(label)
                        for label in allowed_bodies_cf
                    }
                )
            else:
                canonical_body = _canonical_body(body_raw)
                scenario_body_sources.add(canonical_body)
                scenario_body_token = _canonical_body_for_model(canonical_body)
                if scenario_body_token == "RegionalBody":
                    allowed_bodies_cf = {
                        "northern ireland assembly",
                        "northern ireland constitutional convention",
                        "european parliament",
                    }
                    scenario_body_sources.update(
                        {
                            _canonical_body(label) or str(label)
                            for label in allowed_bodies_cf
                        }
                    )
                else:
                    allowed_bodies_cf = {canonical_body.casefold()}

    df = df[df["Transfers"] > 0]
    df = df[df["TransferParty"].astype(str).str.strip() != ""]
    df = df[
        df["TransferPartyRelation"].str.casefold().isin(
            {"different party", "same party", "nontransferable"}
        )
    ]

    full_df = df.copy()

    if allowed_events_cf:
        events_cf = df["Event"].map(_canonical_event).astype(str).str.casefold()
        df = df[events_cf.isin(allowed_events_cf)]
    if allowed_bodies_cf:
        df = df[df["ElectedBody"].str.casefold().isin(allowed_bodies_cf)]

    pooled_meta: Dict[str, Dict[str, Any]] = {}
    if allowed_events_cf or allowed_bodies_cf:
        df, pooled_meta = _augment_sparse_donors(
            df,
            full_df,
            allowed_events_cf=allowed_events_cf,
            allowed_bodies_cf=allowed_bodies_cf,
            canonical_event=scenario_event_token,
            canonical_body=scenario_body_token,
        )
        if pooled_meta and (scenario_event_token or scenario_body_token):
            scenario_details = pooled_meta.setdefault("__scenario__", {})
            if scenario_event_token:
                scenario_details["event"] = scenario_event_token
            if scenario_body_token:
                scenario_details["body"] = scenario_body_token
            if scenario_event_sources:
                scenario_details["event_sources"] = sorted(scenario_event_sources)
            if scenario_body_sources:
                scenario_details["body_sources"] = sorted(scenario_body_sources)

    if df.empty:
        return pd.DataFrame()

    def _party_still_in(party: str, remaining: Iterable[str]) -> int:
        party_clean = _clean_party(party)
        return int(any(_clean_party(p) == party_clean for p in remaining))

    records: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        donor_party = _clean_party(row["TransferParty"])
        relation = row["TransferPartyRelation"].casefold()
        dest_party = _clean_party(row["Party"]) if relation != "nontransferable" else "__NT__"
        if not dest_party:
            dest_party = "__NT__"

        survivors_ids = _split_list(row.get("RemainingCandidateIDsDesc"))
        survivors_parties = [_clean_party(p) for p in _split_list(row.get("RemainingCandidatePartiesInIDOrder"))]

        source_pid = row.get("SourcePersonID")
        source_pid_val = int(source_pid) if pd.notna(source_pid) else -1

        etype_token = (
            scenario_event_token
            if scenario_event_token
            else _canonical_event_for_model(row["Event"])
        )
        body_token = (
            scenario_body_token
            if scenario_body_token
            else _canonical_body_for_model(row["ElectedBody"])
        )

        records.append(
            {
                "DateStr": str(row["DateStr"]),
                "Constituency": str(row["Constituency"]),
                "SourceParty": donor_party,
                "SourcePersonID": source_pid_val,
                "DestParty": dest_party,
                "Weight": float(row["Transfers"]),
                "EType": str(etype_token),
                "Body": str(body_token),
                "Count": int(row["Count"]),
                "SourceStillIn": 0,
                "DestStillIn": 0 if dest_party == "__NT__" else 1,
                "SourcePartyStillIn": _party_still_in(donor_party, survivors_parties),
                "DestPartyStillIn":
                    0 if dest_party == "__NT__" else _party_still_in(dest_party, survivors_parties),
                "NumRemainingCands": len(survivors_ids),
                "NumRemainingParties": len({p for p in survivors_parties if p}),
                "don_first_share": np.nan,
                "don_transfer_share": np.nan,
                "rec_first_share": np.nan,
                "rec_transfer_share": np.nan,
                "is_elimination": int(float(row.get("EliminatedThisRound", 0)) > 0),
                "is_surplus": int(float(row.get("ElectedThisRound", 0)) > 0),
                "pooled_source": str(row.get("PooledSource", "") or ""),
                "pooled_source_event": str(row.get("PooledSourceEvent", "") or ""),
            }
        )

    records_df = pd.DataFrame.from_records(records)
    if records_df.empty:
        return records_df

    stage_thresholds: Dict[Tuple[str, str], float] = {}
    for (etype, body), sub in records_df.groupby(["EType", "Body"], dropna=False):
        vals = sub["Count"].astype(float).to_numpy()
        w = sub["Weight"].astype(float).to_numpy()
        thr = _weighted_median(vals, w)
        stage_thresholds[(str(etype), str(body))] = thr

    def _stage(row: pd.Series) -> str:
        key = (str(row["EType"]), str(row["Body"]))
        thr = stage_thresholds.get(key)
        if thr is None:
            return "early"
        try:
            return "early" if float(row["Count"]) <= float(thr) else "late"
        except Exception:
            return "early"

    records_df["stage"] = records_df.apply(_stage, axis=1)

    def _collect(keys: List[str]) -> Dict[Any, Tuple[Dict[str, float], float]]:
        out: Dict[Any, Tuple[Dict[str, float], float]] = {}
        for combo, sub in records_df.groupby(keys, dropna=False):
            if not isinstance(combo, tuple):
                combo = (combo,)
            counts = (
                sub.groupby("DestParty", dropna=False)["Weight"].sum().astype(float)
            )
            counts_map = {
                str(k): float(v)
                for k, v in counts.items()
                if float(v) > 0
            }
            total = float(sum(counts_map.values()))
            if total <= 0:
                continue
            key_parts = tuple(str(k) for k in combo)
            key_obj: Any
            if len(key_parts) == 1:
                key_obj = key_parts[0]
            else:
                key_obj = key_parts
            out[key_obj] = (counts_map, total)
        return out

    contexts = {
        "type_body_stage_donor": _collect(["EType", "Body", "stage", "SourceParty"]),
        "type_body_donor": _collect(["EType", "Body", "SourceParty"]),
        "body_stage_donor": _collect(["Body", "stage", "SourceParty"]),
        "body_donor": _collect(["Body", "SourceParty"]),
        "type_stage_donor": _collect(["EType", "stage", "SourceParty"]),
        "type_donor": _collect(["EType", "SourceParty"]),
        "stage_donor": _collect(["stage", "SourceParty"]),
        "donor": _collect(["SourceParty"]),
        "type_body": _collect(["EType", "Body"]),
        "body": _collect(["Body"]),
        "type": _collect(["EType"]),
        "stage": _collect(["stage"]),
    }

    base_counts_series = (
        records_df.groupby("DestParty", dropna=False)["Weight"].sum().astype(float)
    )
    base_counts = {str(k): float(v) for k, v in base_counts_series.items() if float(v) > 0}
    contexts["global"] = (base_counts, float(sum(base_counts.values())))

    def _collapse_donor(
        src: Dict[Any, Tuple[Dict[str, float], float]],
        donor_at_end: bool = True,
    ) -> Dict[Tuple[str, ...], Dict[str, Dict[str, float]]]:
        result: Dict[Tuple[str, ...], Dict[str, Dict[str, float]]] = {}
        for key, (counts_map, _) in src.items():
            if isinstance(key, tuple):
                if donor_at_end and key:
                    ctx_key = key[:-1]
                    donor = key[-1]
                else:
                    ctx_key = key
                    donor = None
            else:
                if donor_at_end:
                    ctx_key = tuple()
                    donor = str(key)
                else:
                    ctx_key = (str(key),)
                    donor = None
            ctx = result.setdefault(tuple(ctx_key), {})
            if donor is None:
                ctx.setdefault("__GLOBAL__", counts_map)
            else:
                ctx[str(donor)] = counts_map
        return result

    counts_tbs = _collapse_donor(contexts["type_body_stage_donor"], donor_at_end=True)
    counts_tb = _collapse_donor(contexts["type_body_donor"], donor_at_end=True)
    counts_type = _collapse_donor(contexts["type_donor"], donor_at_end=True)
    counts_stage = _collapse_donor(contexts["stage_donor"], donor_at_end=True)
    counts_party: Dict[str, Dict[str, float]] = {}
    for donor_key, (counts, total) in contexts["donor"].items():
        if total <= 0:
            continue
        donor = donor_key if isinstance(donor_key, str) else str(donor_key)
        counts_party[donor] = {
            str(dest): float(val) for dest, val in counts.items() if float(val) > 0
        }
    counts_global = base_counts

    party_prior = {}
    for donor, row in counts_party.items():
        total = float(sum(row.values()))
        if total > 0:
            party_prior[donor] = {dest: val / total for dest, val in row.items()}

    donor_strength = {
        donor: float(sum(row.values()))
        for donor, row in counts_party.items()
    }
    strengths = [val for val in donor_strength.values() if val > 0]
    model_strength = float(np.median(np.asarray(strengths))) if strengths else 1.0

    nt_counts = {donor: row.get("__NT__", 0.0) for donor, row in counts_party.items()}
    nt_totals = {donor: float(sum(row.values())) for donor, row in counts_party.items()}
    nt_rate_by_party = {
        donor: (nt_counts.get(donor, 0.0) / total if total > 0 else 0.0)
        for donor, total in nt_totals.items()
    }
    total_nt = float(sum(val for val in base_counts.values()))
    nt_rate_global = 0.0
    if total_nt > 0:
        nt_rate_global = float(base_counts.get("__NT__", 0.0)) / total_nt

    cat_cols = ["donor_party", "recipient_party", "constituency", "body", "etype"]
    cat_fit_df = pd.DataFrame(
        {
            "donor_party": records_df["SourceParty"].astype(str),
            "recipient_party": records_df["DestParty"].astype(str),
            "constituency": records_df["Constituency"].astype(str),
            "body": records_df["Body"].astype(str),
            "etype": records_df["EType"].astype(str),
        }
    )
    num_cols = [
        "count",
        "is_elimination",
        "is_surplus",
        "don_first_share",
        "don_transfer_share",
        "rec_first_share",
        "rec_transfer_share",
    ]

    fallback_info = {
        "base_counts": base_counts,
        "contexts": contexts,
        "stage_thresholds": stage_thresholds,
        "counts_type_body_stage": counts_tbs,
        "counts_type_body": counts_tb,
        "counts_type": counts_type,
        "counts_stage": counts_stage,
        "counts_party": counts_party,
        "counts_global": counts_global,
        "party_prior": party_prior,
        "donor_strength": donor_strength,
        "model_strength": model_strength,
        "nt_rate_by_party": nt_rate_by_party,
        "nt_rate_global": nt_rate_global,
        "cat_cols": cat_cols,
        "num_cols": num_cols,
        "cat_fit_df": cat_fit_df,
        "classes": sorted(base_counts.keys()),
        "pooled_sources": pooled_meta,
        "canonical_event": scenario_event_token or "",
        "canonical_body": scenario_body_token or "",
    }

    records_df.attrs["fallback_info"] = fallback_info
    return records_df


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    if values.size == 0:
        return 0.0
    order = np.argsort(values)
    vals_sorted = values[order]
    w_sorted = weights[order]
    cum = np.cumsum(w_sorted)
    cutoff = float(w_sorted.sum()) / 2.0
    idx = int(np.searchsorted(cum, cutoff, side="left"))
    idx = min(max(idx, 0), len(vals_sorted) - 1)
    return float(vals_sorted[idx])


def _split_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, float) and pd.isna(value):
        return []
    return [part.strip() for part in str(value).split(",") if part.strip()]


def build_training_from_ml_tables(
    er_df: pd.DataFrame, ml: Dict[str, pd.DataFrame], scenario_dict: Optional[Dict[str, Any]] = None
) -> pd.DataFrame:
    required = ("EventEdges", "CandidateSnapshots")
    if not all(k in ml for k in required):
        if "Transfers" in ml:
            return _build_from_transfer_sheet(er_df, ml["Transfers"], scenario_dict=scenario_dict)
        return pd.DataFrame()

    ee = ml["EventEdges"].copy()
    cs = ml["CandidateSnapshots"].copy()
    er = er_df.copy()
    if not er.empty:
        pcol = _party_col(er)
        er[pcol] = er[pcol].astype(str).apply(_clean_party)

    if not ee.empty:
        sg = ml.get("SourceGroups", pd.DataFrame()) if isinstance(ml, dict) else pd.DataFrame()
        lc = ml.get("LocalCompositions", pd.DataFrame()) if isinstance(ml, dict) else pd.DataFrame()

        def _norm_group_id(value: Any) -> Optional[str]:
            if value is None or (isinstance(value, float) and pd.isna(value)):
                return None
            try:
                # Many IDs are floats from Excel; normalise to int-like strings
                if isinstance(value, str) and value.strip() == "":
                    return None
                return str(int(float(value)))
            except Exception:
                return str(value)

        def _build_group_shares(
            sg_df: pd.DataFrame, lc_df: pd.DataFrame
        ) -> Dict[str, Dict[int, float]]:
            sg_local = sg_df.copy()
            if "GroupID" in sg_local.columns:
                sg_local["GroupID"] = pd.to_numeric(sg_local["GroupID"], errors="coerce")
            if "CandidateID" in sg_local.columns:
                sg_local["CandidateID"] = pd.to_numeric(sg_local["CandidateID"], errors="coerce")

            direct: Dict[str, int] = {}
            members_json: Dict[str, List[int]] = {}
            for _, row in sg_local.iterrows():
                gid = _norm_group_id(row.get("GroupID"))
                if not gid:
                    continue
                cand = row.get("CandidateID")
                if pd.notna(cand):
                    try:
                        direct[gid] = int(float(cand))
                        continue
                    except Exception:
                        pass
                raw = row.get("MemberCandidateIDsJSON")
                parsed: List[int] = []
                if isinstance(raw, str) and raw.strip():
                    try:
                        items = json.loads(raw)
                    except Exception:
                        items = []
                    for item in items:
                        try:
                            parsed.append(int(float(item)))
                        except Exception:
                            continue
                if parsed:
                    members_json[gid] = parsed

            lc_local = lc_df.copy()
            if not lc_local.empty and "ParentGroupID" in lc_local.columns:
                lc_local["ParentGroupID"] = pd.to_numeric(
                    lc_local["ParentGroupID"], errors="coerce"
                )
            if not lc_local.empty and "ChildGroupID" in lc_local.columns:
                lc_local["ChildGroupID"] = pd.to_numeric(
                    lc_local["ChildGroupID"], errors="coerce"
                )
            comp: Dict[str, Dict[str, float]] = {}
            if not lc_local.empty:
                for _, row in lc_local.iterrows():
                    parent = _norm_group_id(row.get("ParentGroupID"))
                    child = _norm_group_id(row.get("ChildGroupID"))
                    if not parent or not child:
                        continue
                    try:
                        share = float(row.get("ChildShare", 0.0))
                    except Exception:
                        share = 0.0
                    if share <= 0:
                        continue
                    comp.setdefault(parent, {})[child] = comp.setdefault(parent, {}).get(child, 0.0) + share

            cache: Dict[str, Dict[int, float]] = {}

            def _resolve(gid: str, stack: Optional[set] = None) -> Dict[int, float]:
                if gid in cache:
                    return cache[gid]
                if stack is None:
                    stack = set()
                if gid in stack:
                    cache[gid] = {}
                    return cache[gid]
                stack.add(gid)

                if gid in direct:
                    cache[gid] = {direct[gid]: 1.0}
                    stack.remove(gid)
                    return cache[gid]

                agg: Dict[int, float] = {}
                children = comp.get(gid, {})
                if children:
                    for child_gid, share in children.items():
                        child_dist = _resolve(child_gid, stack)
                        if not child_dist:
                            continue
                        for pid, frac in child_dist.items():
                            agg[pid] = agg.get(pid, 0.0) + float(share) * float(frac)
                if agg:
                    total = float(sum(v for v in agg.values() if np.isfinite(v)))
                    if total > 0:
                        cache[gid] = {pid: float(val) / total for pid, val in agg.items() if val > 0}
                        stack.remove(gid)
                        return cache[gid]

                members = members_json.get(gid, [])
                if members:
                    n = len(members)
                    if n > 0:
                        share = 1.0 / float(n)
                        cache[gid] = {pid: share for pid in members}
                        stack.remove(gid)
                        return cache[gid]

                cache[gid] = {}
                stack.remove(gid)
                return cache[gid]

            for gid in set(list(direct.keys()) + list(members_json.keys()) + list(comp.keys())):
                _resolve(gid)
            return cache

        if "SourceGroupID" in ee.columns and not sg.empty and "SourcePersonID" not in ee.columns:
            group_shares = _build_group_shares(sg, lc)

            expanded: List[Dict[str, Any]] = []
            ee_local = ee.copy()
            if "SourceGroupID" in ee_local.columns:
                ee_local["SourceGroupID"] = pd.to_numeric(ee_local["SourceGroupID"], errors="coerce")
            for _, row in ee_local.iterrows():
                gid = _norm_group_id(row.get("SourceGroupID"))
                members = group_shares.get(gid or "", {}) if gid else {}
                try:
                    edge_val = float(row.get("EdgeVotes", float("nan")))
                except Exception:
                    edge_val = float("nan")
                if members:
                    for member, share in members.items():
                        new_row = row.to_dict()
                        new_row["SourcePersonID"] = member
                        if pd.notna(edge_val):
                            new_row["EdgeVotes"] = float(edge_val) * float(share)
                        expanded.append(new_row)
                else:
                    new_row = row.to_dict()
                    new_row["SourcePersonID"] = pd.NA
                    expanded.append(new_row)
            ee = pd.DataFrame.from_records(expanded) if expanded else ee

        if "SourcePersonID" not in ee.columns:
            source_col = None
            for cand_col in ("FromCandidateID", "SourceCandidateID"):
                if cand_col in ee.columns:
                    source_col = cand_col
                    break
            if source_col is not None:
                ee["SourcePersonID"] = pd.to_numeric(ee[source_col], errors="coerce")
            else:
                ee["SourcePersonID"] = pd.Series(pd.NA, index=ee.index, dtype="float64")

        if "DestPersonID" not in ee.columns:
            dest_col = None
            for cand_col in ("ToCandidateID", "DestCandidateID"):
                if cand_col in ee.columns:
                    dest_col = cand_col
                    break
            if dest_col is not None:
                ee["DestPersonID"] = pd.to_numeric(ee[dest_col], errors="coerce")
            else:
                ee["DestPersonID"] = pd.Series(pd.NA, index=ee.index, dtype="float64")

        ee["SourcePersonID"] = pd.to_numeric(ee["SourcePersonID"], errors="coerce").astype("Int64")
        ee["DestPersonID"] = pd.to_numeric(ee["DestPersonID"], errors="coerce").astype("Int64")

    allowed_events: Optional[set] = None
    allowed_bodies: Optional[set] = None
    if isinstance(scenario_dict, dict):
        event = str(scenario_dict.get("event", "") or "").strip()
        body = str(scenario_dict.get("elected_body", "") or "").strip()
        ev_cf = event.casefold()
        if ev_cf:
            if ev_cf == "customelection":
                allowed_events = {"devolvedelection", "europeanelection"}
            else:
                allowed_events = {ev_cf}
        body_cf = body.casefold()
        if body_cf:
            if body_cf == "custombody":
                allowed_bodies = {
                    "northern ireland assembly",
                    "northern ireland constitutional convention",
                    "european parliament",
                }
            else:
                allowed_bodies = {body_cf}

    pcol = "Party Name" if "Party Name" in er.columns else ("Party" if "Party" in er.columns else None)
    if pcol is None:
        er["Party"] = ""
        pcol = "Party"
    er = er[er.get("ResultType", "").astype(str).str.contains("cand", case=False, na=False)].copy()
    er["PersonID"] = pd.to_numeric(er["PersonID"], errors="coerce").astype("Int64")
    fpcol = "Votes1" if "Votes1" in er.columns else ("Votes" if "Votes" in er.columns else None)
    if fpcol is None:
        er["Votes1"] = 0.0
        fpcol = "Votes1"
    er[fpcol] = pd.to_numeric(er[fpcol], errors="coerce").fillna(0.0)
    part_map = er.set_index(["DateStr", "Constituency", "PersonID"])[pcol].astype(str).to_dict()
    fp_map = er.set_index(["DateStr", "Constituency", "PersonID"])[fpcol].astype(float).to_dict()

    ee["DateStr"] = ee["ElectionKey"].str.split("|").str[0]
    ee["EType"] = ee["ElectionKey"].str.split("|").str[1]
    ee["Constituency"] = ee["ElectionKey"].str.split("|").str[2]

    body_lookup_map: Dict[Tuple[str, str], str] = {}
    if "ElectedBody" in er_df.columns:
        body_lookup_map = (
            er_df[["DateStr", "Constituency", "ElectedBody"]]
            .dropna(subset=["DateStr", "Constituency"])
            .drop_duplicates()
            .set_index(["DateStr", "Constituency"])["ElectedBody"].astype(str).to_dict()
        )
    ee["BodyKey"] = ee.apply(
        lambda r: body_lookup_map.get((str(r["DateStr"]), str(r["Constituency"])), ""), axis=1
    )

    if allowed_events:
        ee = ee[ee["EType"].astype(str).str.casefold().isin(allowed_events)]
    if allowed_bodies:
        ee = ee[ee["BodyKey"].astype(str).str.casefold().isin(allowed_bodies)]

    ee["SourceParty"] = ee.apply(
        lambda r: part_map.get((str(r["DateStr"]), str(r["Constituency"]), r["SourcePersonID"]), ""), axis=1
    )
    ee["DestParty"] = ee.apply(
        lambda r: part_map.get((str(r["DateStr"]), str(r["Constituency"]), r["DestPersonID"]), ""), axis=1
    )
    ee.loc[ee["DestPersonID"] == -1, "DestParty"] = "__NT__"

    snap = cs.copy()
    for c in ["ElectionKey", "Count", "CandidateID", "TotalVotes", "IncomingVotesThisCount"]:
        if c not in snap.columns:
            snap[c] = 0
    snap["CandidateID"] = pd.to_numeric(snap["CandidateID"], errors="coerce").astype("Int64")
    snap["Count"] = pd.to_numeric(snap["Count"], errors="coerce").fillna(0).astype(int)

    def still_in(election_key: str, count: int, person_id: pd.Int64Dtype) -> int:
        s = snap[
            (snap["ElectionKey"] == election_key)
            & (snap["Count"] >= count)
            & (snap["CandidateID"] == person_id)
        ]
        return int(not s.empty and float(s.tail(1)["TotalVotes"].iloc[0]) > 0.0)

    rows: List[Dict[str, Any]] = []
    for _, r in ee.iterrows():
        ek = str(r["ElectionKey"])
        cnt = int(r.get("FromCount", r.get("ToCount", r.get("Count", 0))) or 0)
        date = str(r["DateStr"])
        cons = str(r["Constituency"])
        spid = r["SourcePersonID"]
        dpid = r["DestPersonID"]

        sparty = str(r["SourceParty"])
        dparty = str(r["DestParty"])

        src_still = still_in(ek, cnt, spid)
        dst_still = still_in(ek, cnt, dpid)

        s_after = snap[(snap["ElectionKey"] == ek) & (snap["Count"] == cnt)]
        num_cands = s_after["CandidateID"].nunique()
        totals_map: Dict[int, float] = {}
        if not s_after.empty and "TotalVotes" in s_after.columns:
            tmp = s_after.copy()
            tmp["CandidateID"] = pd.to_numeric(tmp["CandidateID"], errors="coerce")
            tmp = tmp.dropna(subset=["CandidateID"])
            totals_map = tmp.set_index("CandidateID")["TotalVotes"].astype(float).to_dict()
        if "PartyAtEvent" in s_after.columns:
            num_parties = s_after["PartyAtEvent"].astype(str).nunique()
        else:
            num_parties = max(
                1,
                er[(er["DateStr"] == date) & (er["Constituency"] == cons)]["Party"].astype(str).nunique(),
            )

        donor_first = float(fp_map.get((date, cons, spid), 0.0)) if pd.notna(spid) else 0.0
        donor_total = (
            float(totals_map.get(int(spid) if pd.notna(spid) else -1, donor_first))
            if pd.notna(spid)
            else donor_first
        )
        base_d = donor_total if donor_total > 0 else donor_first
        if base_d > 0:
            don_first_share = float(np.clip(donor_first / base_d, 0.0, 1.0))
        else:
            don_first_share = 0.0
        recip_first = float(fp_map.get((date, cons, dpid), 0.0)) if pd.notna(dpid) else 0.0
        recip_total = (
            float(totals_map.get(int(dpid) if pd.notna(dpid) else -1, recip_first))
            if pd.notna(dpid)
            else recip_first
        )
        base_r = recip_total if recip_total > 0 else recip_first
        if base_r > 0:
            rec_first_share = float(np.clip(recip_first / base_r, 0.0, 1.0))
        else:
            rec_first_share = 0.0

        rows.append(
            {
                "DateStr": date,
                "Constituency": cons,
                "SourceParty": sparty,
                "SourcePersonID": int(spid) if pd.notna(spid) else -1,
                "SourceStillIn": src_still,
                "DestStillIn": dst_still,
                "SourcePartyStillIn": 1,
                "DestPartyStillIn": 1 if dparty != "__NT__" else 0,
                "NumRemainingCands": int(num_cands) if pd.notna(num_cands) else 0,
                "NumRemainingParties": int(num_parties) if pd.notna(num_parties) else 0,
                "DestParty": dparty,
                "Weight": float(r.get("EdgeVotes", 1.0) or 1.0),
                "EType": str(r.get("EType", "")),
                "Body": str(r.get("BodyKey", "")),
                "don_first_share": don_first_share,
                "don_transfer_share": float(max(0.0, 1.0 - don_first_share)),
                "rec_first_share": rec_first_share,
                "rec_transfer_share": float(max(0.0, 1.0 - rec_first_share)),
            }
        )

    return pd.DataFrame.from_records(rows)
