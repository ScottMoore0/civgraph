"""Pair construction helpers for transfer modelling."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

from collections import defaultdict

import numpy as np
import pandas as pd

from .base import (
    _DEF_KEY_BODY,
    _DEF_KEY_CONS,
    _DEF_KEY_DATE,
    _clean_party,
    _infer_type_from_body,
    _party_col,
)
from .ml_tables import _canonical_body_for_model, _canonical_event_for_model
from .party_space import PartySpace

__all__ = ["_build_pairs_stateful", "_compute_nt_rate_by_party"]


def _split_transfer_field(value: Any) -> List[str]:
    """Split a transfer metadata cell into trimmed string parts."""
    if value is None:
        return []
    if isinstance(value, float) and np.isnan(value):  # type: ignore[attr-defined]
        return []
    parts = [p.strip() for p in str(value).split(",")]
    return [p for p in parts if p]


def _parse_transfer_sources(row: pd.Series) -> List[Dict[str, Optional[str]]]:
    """Return structured donor descriptors from TransferSubject/Name/Party columns."""
    subjects = _split_transfer_field(row.get("TransferSubject"))
    names = _split_transfer_field(row.get("TransferName"))
    parties = [_clean_party(p) for p in _split_transfer_field(row.get("TransferParty"))]

    n = max(len(subjects), len(names), len(parties))
    sources: List[Dict[str, Optional[str]]] = []
    for i in range(n):
        entry: Dict[str, Optional[str]] = {
            "raw_id": subjects[i] if i < len(subjects) else None,
            "name": names[i].lower() if i < len(names) else None,
            "party": parties[i] if i < len(parties) else None,
        }
        raw_id = entry.get("raw_id")
        if raw_id is not None:
            try:
                entry["pid"] = int(float(raw_id))
            except (TypeError, ValueError):
                entry["pid"] = None
        else:
            entry["pid"] = None
        sources.append(entry)
    return sources


def _resolve_source_pid(
    entry: Dict[str, Optional[str]],
    donor_meta: Dict[int, Dict[str, Optional[str]]],
) -> Optional[int]:
    """Resolve a donor ID using raw id, name and party hints."""
    pid = entry.get("pid")
    if isinstance(pid, int) and pid in donor_meta:
        return pid

    name = (entry.get("name") or "").strip().lower()
    party = _clean_party(entry.get("party") or "") if entry.get("party") else ""

    candidates: List[int] = []
    if name:
        candidates = [
            dp
            for dp, meta in donor_meta.items()
            if (meta.get("name") or "").strip().lower() == name
        ]
        if len(candidates) == 1:
            return candidates[0]

    if party:
        party_matches = [
            dp for dp, meta in donor_meta.items() if _clean_party(meta.get("party") or "") == party
        ]
        if len(party_matches) == 1:
            return party_matches[0]

    return None


def _resolve_row_sources(
    row: pd.Series, donor_meta: Dict[int, Dict[str, Optional[str]]]
) -> List[int]:
    """Resolve the donor IDs referenced in a positive transfer row."""
    resolved: List[int] = []
    for entry in _parse_transfer_sources(row):
        pid = _resolve_source_pid(entry, donor_meta)
        if pid is not None:
            resolved.append(pid)
    return resolved


def _share_for_donor(
    donor_pid: int,
    source_pids: Iterable[int],
    donor_weights: Dict[int, float],
) -> float:
    """Return the share of a positive row attributable to ``donor_pid``."""
    sources = [pid for pid in source_pids if pid is not None]
    if donor_pid not in sources:
        return 0.0

    valid_weights = [(pid, donor_weights.get(pid, 0.0)) for pid in sources]
    positive_weights = [(pid, w) for pid, w in valid_weights if w > 0]

    if positive_weights:
        total = float(sum(w for _, w in positive_weights))
        donor_weight = next((w for pid, w in positive_weights if pid == donor_pid), 0.0)
        if donor_weight <= 0:
            donor_weight = 1.0
            total += donor_weight
        return float(donor_weight) / float(total) if total > 0 else 0.0

    count = len(sources)
    if count <= 0:
        return 0.0
    return 1.0 / float(count)


def _build_pairs_stateful(er_df: pd.DataFrame, tr_df: pd.DataFrame, progress_callback=None) -> Tuple[pd.DataFrame, PartySpace]:
    """Construct donor→recipient pairs with dynamic features using provenance and survivor presence."""
    if tr_df is None or tr_df.empty or er_df is None or er_df.empty:
        return pd.DataFrame(), PartySpace([])

    # ER candidate slice with PersonID and Party
    er = er_df.copy()
    if "PersonID" not in er.columns:
        return pd.DataFrame(), PartySpace([])
    er["PersonID"] = pd.to_numeric(er["PersonID"], errors="coerce")
    er = er[er["PersonID"].notna()].copy()
    er["PersonID"] = er["PersonID"].astype(int)
    pcol = _party_col(er)
    er[pcol] = er[pcol].astype(str).apply(_clean_party)
    er = er[er[pcol].astype(str).str.strip() != ""]
    er[_DEF_KEY_DATE] = er[_DEF_KEY_DATE].astype(str)
    er[_DEF_KEY_CONS] = er[_DEF_KEY_CONS].astype(str)
    er[_DEF_KEY_BODY] = er[_DEF_KEY_BODY].astype(str)
    if "ResultType" in er.columns:
        er_cand = er[
            er["ResultType"].astype(str).str.contains("cand", case=False, na=False)
        ].copy()
    else:
        er_cand = er.copy()

    pspace = PartySpace.from_er(er_cand)

    tr = tr_df.copy()
    for c in (_DEF_KEY_DATE, _DEF_KEY_CONS, _DEF_KEY_BODY):
        if c not in tr.columns:
            tr[c] = ""
        tr[c] = tr[c].astype(str)
    for c in ("Party", "TransferParty", "TransferName", "TransferSubject"):
        if c in tr.columns:
            tr[c] = tr[c].astype(str)
    if "Party" in tr.columns:
        tr["Party"] = tr["Party"].astype(str).apply(_clean_party)
    if "TransferParty" in tr.columns:
        tr["TransferParty"] = tr["TransferParty"].astype(str).apply(_clean_party)
    tr["PersonID"] = pd.to_numeric(tr.get("PersonID"), errors="coerce")
    tr = tr[tr["PersonID"].notna()].copy()
    tr["PersonID"] = tr["PersonID"].astype(int)
    tr["Count"] = pd.to_numeric(tr.get("Count"), errors="coerce").fillna(0).astype(int)
    tr["Transfers"] = pd.to_numeric(tr.get("Transfers"), errors="coerce").fillna(0.0)

    rows: List[Dict[str, Any]] = []
    donor_history: Dict[int, Dict[str, float]] = defaultdict(dict)
    party_history: Dict[str, Dict[str, float]] = defaultdict(dict)

    # ========================================
    # CRITICAL FIX: Pre-compute groups to avoid double computation
    # This eliminates the 4-6 minute hang
    # ========================================
    election_groups = list(tr.groupby(
        [_DEF_KEY_DATE, _DEF_KEY_CONS, _DEF_KEY_BODY], dropna=False
    ))
    n_elections = len(election_groups)
    
    if progress_callback and n_elections > 0:
        progress_callback(f"Processing {n_elections} elections for model training...")

    # Use enumerate to get idx variable
    for idx, ((date, cons, body), gkey) in enumerate(election_groups):
        # Show first 3 elections immediately for debugging, then every 5
        if progress_callback and n_elections > 0:
            if idx < 3 or (idx + 1) % 5 == 0:
                progress_callback(f"    Processing election {idx+1}/{n_elections}: {date}/{cons}")
        
        # Special debug for first election to see if we're hanging early
        if idx == 0 and progress_callback:
            progress_callback(f"      Debug: Starting first election data processing...")
        
        body_str = str(body)
        body_token = _canonical_body_for_model(body_str) or body_str
        inferred_type = _infer_type_from_body(body_str)
        etype_token = _canonical_event_for_model(inferred_type) or inferred_type
        
        if idx == 0 and progress_callback:
            progress_callback(f"        Debug: Getting candidate data for {date}/{cons}...")
        
        er_key = er_cand[
            (er_cand[_DEF_KEY_DATE] == str(date))
            & (er_cand[_DEF_KEY_CONS] == str(cons))
            & (er_cand[_DEF_KEY_BODY] == str(body))
        ].copy()
        if er_key.empty:
            if idx == 0 and progress_callback:
                progress_callback(f"        Debug: No candidate data found, skipping...")
            continue
            
        if idx == 0 and progress_callback:
            progress_callback(f"        Debug: Found {len(er_key)} candidates")
            progress_callback(f"        Debug: Processing candidate data...")
        
        cand_ids = er_key["PersonID"].to_numpy()
        parties = er_key[pcol].astype(str).apply(_clean_party).to_numpy()
        idx_of = {int(pid): i for i, pid in enumerate(cand_ids)}
        C = len(cand_ids)
        Pk = len(pspace.top) + 1

        # FPVs
        if "Votes1" in er_key.columns:
            fpcol = "Votes1"
        else:
            fpcol = "Votes" if "Votes" in er_key.columns else None
        
        if idx == 0 and progress_callback:
            progress_callback(f"        Debug: Using FPV column: {fpcol}")
            progress_callback(f"        Debug: Converting {C} first preference votes...")
            
        first = (
            er_key[fpcol].astype(float).fillna(0.0).to_numpy()
            if fpcol
            else np.zeros(C, dtype=float)
        )
        
        if idx == 0 and progress_callback:
            progress_callback(f"        Debug: First prefs extracted, shape: {first.shape}")
            progress_callback(f"        Debug: Initializing tallies and provenance...")

        tallies = first.copy()
        prov = np.zeros((C, Pk), dtype=float)
        for i in range(C):
            prov[i, :] = pspace.vec(parties[i], tallies[i], Pk)
        alive = np.ones(C, dtype=bool)

        # Count unique counts efficiently using pandas
        n_counts = gkey['Count'].nunique()
        if idx == 0 and progress_callback and n_counts > 0:
            progress_callback(f"        Debug: Processing {n_counts} counts...")

        for cnt, gg in gkey.sort_values("Count").groupby("Count"):
            donors_df = gg[gg["Transfers"] < 0]
            recips_df_all = gg[gg["Transfers"] > 0]
            if donors_df.empty or recips_df_all.empty:
                continue
            total_pos = float(recips_df_all["Transfers"].sum())
            if total_pos <= 0:
                continue
            # survivor presence (by party) before applying this count
            surv_has = {p: 0 for p in pspace.top}
            surv_count = {p: 0 for p in pspace.top}
            total_survivors = 0
            for i in range(C):
                if alive[i]:
                    pi = _clean_party(str(parties[i]))
                    total_survivors += 1
                    if pi in pspace.index:
                        surv_has[pi] = 1
                        surv_count[pi] += 1
            total_survivors = max(1, total_survivors)

            # Pairs (per donor)
            source_cols: List[str] = []
            if not recips_df_all.empty:
                for col in ("SourcePersonID", "FromPersonID"):
                    if col not in recips_df_all.columns:
                        continue
                    # Convert to numeric so we can reliably test for usable IDs later on.
                    cleaned = pd.to_numeric(recips_df_all[col], errors="coerce")
                    recips_df_all[col] = cleaned
                    if np.isfinite(cleaned).any():
                        source_cols.append(col)
            has_source = bool(source_cols)
            donor_meta: Dict[int, Dict[str, Optional[str]]] = {}
            donor_weights: Dict[int, float] = {}
            for _, dd in donors_df.iterrows():
                try:
                    pid = int(dd["PersonID"])
                except (TypeError, ValueError):
                    continue
                donor_meta[pid] = {
                    "name": str(dd.get("Name", "")).strip().lower(),
                    "party": _clean_party(str(dd.get("Party", ""))),
                }
                donor_weights[pid] = donor_weights.get(pid, 0.0) + float(abs(dd.get("Transfers", 0.0)))
            for pid, weight in list(donor_weights.items()):
                if weight <= 0:
                    di = idx_of.get(pid)
                    fallback = float(tallies[di]) if di is not None else 0.0
                    donor_weights[pid] = fallback if fallback > 0 else 1.0
            parsed_recips = [
                (rr, _resolve_row_sources(rr, donor_meta))
                for _, rr in recips_df_all.iterrows()
            ]
            resolved_single_sources = [
                tuple(pid for pid in sources if pid in donor_weights)
                for _, sources in parsed_recips
            ]
            resolved_single_sources = [src for src in resolved_single_sources if src]
            has_precise_sources = bool(resolved_single_sources) and all(
                len(src) == 1 for src in resolved_single_sources
            )
            donor_ids_unique = sorted(
                {int(pid) for pid in donors_df["PersonID"].tolist() if pd.notna(pid)}
            )

            donor_party_hints: List[str] = []
            for pid in donor_ids_unique:
                hint = donor_meta.get(pid, {}).get("party") or ""
                if not hint:
                    di = idx_of.get(pid)
                    if di is not None:
                        hint = _clean_party(str(parties[di]))
                hint = _clean_party(str(hint)) if hint else ""
                if hint:
                    donor_party_hints.append(hint)
            multi_party_bundle = len({p for p in donor_party_hints if p}) > 1

            composite_mode = len(donor_ids_unique) > 1 and (
                (not has_source and not has_precise_sources)
                or (multi_party_bundle and not has_precise_sources)
            )
            if composite_mode:
                combo_key = tuple(sorted(int(pid) for pid in donor_ids_unique))
                donor_parties = []
                neg_lookup: Dict[int, float] = {}
                for pid, neg_val in donors_df[["PersonID", "Transfers"]].to_numpy():
                    try:
                        pid_int = int(pid)
                    except (TypeError, ValueError):
                        continue
                    neg_lookup[pid_int] = float(-neg_val)
                donor_total_out = float(sum(v for v in neg_lookup.values() if v > 0))
                if donor_total_out <= 0:
                    donor_total_out = float(total_pos)
                donor_total_out = max(donor_total_out, 1.0)
                donor_total_tally = 0.0
                donor_first_total = 0.0
                comp_src = np.zeros((Pk,), dtype=float)
                src_weight = 0.0
                for pid in donor_ids_unique:
                    di = idx_of.get(pid)
                    if di is None:
                        continue
                    donor_total_tally += float(tallies[di])
                    donor_first_total += float(first[di])
                    party_hint = _clean_party(str(donor_meta.get(pid, {}).get("party", parties[di])))
                    if party_hint:
                        donor_parties.append(party_hint)
                    weight_src = neg_lookup.get(pid, 0.0)
                    if weight_src <= 0:
                        weight_src = float(tallies[di])
                    if weight_src <= 0:
                        weight_src = 1.0
                    comp_src += weight_src * prov[di, :]
                    src_weight += weight_src
                if src_weight > 0:
                    comp_src = comp_src / float(src_weight)
                else:
                    comp_src = np.zeros((Pk,), dtype=float)
                    comp_src[-1] = 1.0
                unique_parties = sorted({p for p in donor_parties if p})
                donor_party_combo = "+".join(unique_parties) if unique_parties else "Mixed"
                donor_party_combo = f"combo:{donor_party_combo}"
                base_d = donor_total_out if donor_total_out > 0 else donor_total_tally
                if base_d <= 0:
                    base_d = donor_first_total
                if base_d > 0:
                    don_first_share = float(np.clip(donor_first_total / base_d, 0.0, 1.0))
                else:
                    don_first_share = 0.0
                don_transfer_share = float(max(0.0, 1.0 - don_first_share))
                elim_flags = []
                for pid in donor_ids_unique:
                    di = idx_of.get(pid)
                    if di is None:
                        continue
                    elim_flags.append(
                        abs(float(donors_df.loc[donors_df["PersonID"].astype(int) == int(pid), "Transfers"].sum()))
                        >= tallies[di] - 1e-6
                    )
                is_elim = 1 if elim_flags and all(elim_flags) else 0
                is_surplus = 1 - is_elim

                nt_amt = max(donor_total_out - float(total_pos), 0.0)

                for rr, _ in parsed_recips:
                    rid = int(rr["PersonID"])
                    r_idx = idx_of.get(rid, -1)
                    if r_idx < 0:
                        continue
                    recip_party = str(parties[r_idx])
                    recip_party_clean = _clean_party(str(rr.get("Party", recip_party)))
                    portion = float(rr["Transfers"])
                    if portion <= 0:
                        continue
                    y_share = float(np.clip(portion / donor_total_out, 0.0, 1.0))
                    row = {
                        "date": str(date),
                        "constituency": str(cons),
                        "body": str(body_token),
                        "etype": str(etype_token),
                        "count": int(cnt),
                        "donor_pid": f"combo:{'+'.join(str(pid) for pid in combo_key)}",
                        "recipient_pid": rid,
                        "donor_party": donor_party_combo,
                        "recipient_party": recip_party_clean,
                        "y_share": y_share,
                        "weight": float(donor_total_out),
                        "is_elimination": int(is_elim),
                        "is_surplus": int(is_surplus),
                        "don_first_share": don_first_share,
                        "don_transfer_share": don_transfer_share,
                    }
                    recip_total = float(tallies[r_idx]) if r_idx >= 0 else 0.0
                    recip_first = float(first[r_idx]) if r_idx >= 0 else 0.0
                    base_r = recip_total if recip_total > 0 else recip_first
                    if base_r > 0:
                        rec_first_share = float(np.clip(recip_first / base_r, 0.0, 1.0))
                    else:
                        rec_first_share = 0.0
                    row["rec_first_share"] = rec_first_share
                    row["rec_transfer_share"] = float(max(0.0, 1.0 - rec_first_share))
                    for j, p in enumerate(pspace.top):
                        row[f"don_src::{p}"] = float(comp_src[j])
                    row["don_src::OTHER"] = float(comp_src[-1])
                    for p in pspace.top:
                        row[f"surv_has::{p}"] = int(surv_has.get(p, 0))
                        row[f"surv_count::{p}"] = float(min(3, surv_count.get(p, 0)))
                        row[f"surv_share::{p}"] = float(surv_count.get(p, 0)) / float(total_survivors)
                        try:
                            total_alive_tally = (
                                float(tallies[alive].sum()) if isinstance(tallies, np.ndarray) else 0.0
                            )
                            total_alive_tally = total_alive_tally if total_alive_tally > 0 else 1.0
                            idxs = [
                                ii
                                for ii in range(C)
                                if alive[ii] and _clean_party(str(parties[ii])) == p
                            ]
                            top_val = max((float(tallies[ii]) for ii in idxs), default=0.0)
                            row[f"surv_top_share::{p}"] = float(top_val) / float(total_alive_tally)
                        except Exception:
                            row[f"surv_top_share::{p}"] = 0.0
                    rows.append(row)

                if nt_amt > 0:
                    row_nt = {
                        "date": str(date),
                        "constituency": str(cons),
                        "body": str(body_token),
                        "etype": str(etype_token),
                        "count": int(cnt),
                        "donor_pid": f"combo:{'+'.join(str(pid) for pid in combo_key)}",
                        "recipient_pid": -1,
                        "donor_party": donor_party_combo,
                        "recipient_party": "NonTransferable",
                        "y_share": float(np.clip(nt_amt / donor_total_out, 0.0, 1.0)),
                        "weight": float(donor_total_out),
                        "is_elimination": int(is_elim),
                        "is_surplus": int(is_surplus),
                        "don_first_share": don_first_share,
                        "don_transfer_share": don_transfer_share,
                        "rec_first_share": 0.0,
                        "rec_transfer_share": 0.0,
                    }
                    for j, p in enumerate(pspace.top):
                        row_nt[f"don_src::{p}"] = float(comp_src[j])
                    row_nt["don_src::OTHER"] = float(comp_src[-1])
                    for p in pspace.top:
                        row_nt[f"surv_has::{p}"] = int(surv_has.get(p, 0))
                        row_nt[f"surv_count::{p}"] = float(min(3, surv_count.get(p, 0)))
                        row_nt[f"surv_share::{p}"] = float(surv_count.get(p, 0)) / float(total_survivors)
                        try:
                            total_alive_tally = (
                                float(tallies[alive].sum()) if isinstance(tallies, np.ndarray) else 0.0
                            )
                            total_alive_tally = total_alive_tally if total_alive_tally > 0 else 1.0
                            idxs = [
                                ii
                                for ii in range(C)
                                if alive[ii] and _clean_party(str(parties[ii])) == p
                            ]
                            top_val = max((float(tallies[ii]) for ii in idxs), default=0.0)
                            row_nt[f"surv_top_share::{p}"] = float(top_val) / float(total_alive_tally)
                        except Exception:
                            row_nt[f"surv_top_share::{p}"] = 0.0
                    rows.append(row_nt)
            else:
                inferred_allocations: Dict[int, List[Tuple[pd.Series, float]]] = {}
                if not has_source and donor_ids_unique and not has_precise_sources:
                    for pid in donor_ids_unique:
                        inferred_allocations[pid] = []
                    for rr, _ in parsed_recips:
                        recip_party = _clean_party(str(rr.get("Party", "")))
                        total_transfer = float(rr["Transfers"])
                        weighted_scores: List[Tuple[int, float]] = []
                        for pid in donor_ids_unique:
                            weight_base = float(donor_weights.get(pid, 0.0))
                            if weight_base <= 0:
                                continue
                            party_hint = _clean_party(str(donor_meta.get(pid, {}).get("party", "")))
                            donor_hist = donor_history.get(pid)
                            score_prior = 0.0
                            if donor_hist:
                                total_hist = float(sum(donor_hist.values()))
                                if total_hist > 0:
                                    score_prior = float(donor_hist.get(recip_party, 0.0)) / float(total_hist)
                            if score_prior <= 0 and party_hint:
                                party_hist = party_history.get(party_hint)
                                if party_hist:
                                    total_party = float(sum(party_hist.values()))
                                    if total_party > 0:
                                        score_prior = float(party_hist.get(recip_party, 0.0)) / float(total_party)
                            if score_prior <= 0 and party_hint and party_hint == recip_party:
                                score_prior = 1.0
                            if score_prior > 0:
                                weighted_scores.append((pid, weight_base * score_prior))
                        if not weighted_scores:
                            if len(donor_ids_unique) == 1:
                                pid = donor_ids_unique[0]
                                inferred_allocations[pid].append((rr, total_transfer))
                            # otherwise drop this ambiguous recipient row
                            continue
                        total_score = float(sum(score for _, score in weighted_scores))
                        if total_score <= 0:
                            continue
                        for pid, score_val in weighted_scores:
                            share = float(score_val) / float(total_score)
                            inferred_allocations[pid].append((rr, total_transfer * share))

                for donor_pid in donor_ids_unique:
                        di = idx_of.get(int(donor_pid), None)
                        if di is None:
                            continue
                        donor_party = str(parties[di])
                        v = prov[di, :].astype(float)
                        vsum = float(v.sum()) or 1.0
                        don_src = v / vsum
                        if has_source:
                            src_col = source_cols[0]
                            donor_mask = (
                                pd.to_numeric(recips_df_all[src_col], errors="coerce").fillna(-1).astype(int)
                                == int(donor_pid)
                            )
                            recips_df = recips_df_all[donor_mask]
                            allocations = [
                                (rr, float(rr["Transfers"])) for _, rr in recips_df.iterrows()
                            ]
                            total_pos_d = float(sum(portion for _, portion in allocations))
                        else:
                            if inferred_allocations:
                                allocations = inferred_allocations.get(int(donor_pid), [])
                            else:
                                allocations = []
                                for rr, sources in parsed_recips:
                                    share = _share_for_donor(int(donor_pid), sources, donor_weights)
                                    if share <= 0:
                                        continue
                                    portion = float(rr["Transfers"]) * float(share)
                                    if portion <= 0:
                                        continue
                                    allocations.append((rr, portion))
                                if not allocations:
                                    if len(donor_ids_unique) != 1:
                                        continue
                                    allocations = [
                                        (rr, float(rr["Transfers"]))
                                        for rr, _ in parsed_recips
                                    ]
                            total_pos_d = float(sum(portion for _, portion in allocations))
                        if total_pos_d <= 0:
                            continue
                        is_elim = (
                            1
                            if abs(
                                float(
                                    donors_df.loc[
                                        donors_df["PersonID"].astype(int) == int(donor_pid),
                                        "Transfers",
                                    ].sum()
                                )
                            )
                            >= tallies[di] - 1e-6
                            else 0
                        )
                        is_surplus = 1 - is_elim
                        for rr, portion in allocations:
                            rid = int(rr["PersonID"])
                            r_idx = idx_of.get(rid, -1)
                            if r_idx < 0:
                                continue
                            recip_party = str(parties[r_idx])
                            recip_party_clean = _clean_party(str(rr.get("Party", recip_party)))
                            if has_source or len(donor_ids_unique) == 1:
                                donor_hist = donor_history.setdefault(int(donor_pid), {})
                                donor_hist[recip_party_clean] = donor_hist.get(
                                    recip_party_clean, 0.0
                                ) + float(portion)
                                party_hint = _clean_party(
                                    str(donor_meta.get(int(donor_pid), {}).get("party", donor_party))
                                )
                                if party_hint:
                                    party_hist = party_history.setdefault(party_hint, {})
                                    party_hist[recip_party_clean] = party_hist.get(
                                        recip_party_clean, 0.0
                                    ) + float(portion)
                            y_share = float(portion) / total_pos_d
                            row = {
                                "date": str(date),
                                "constituency": str(cons),
                        "body": str(body_token),
                        "etype": str(etype_token),
                                "count": int(cnt),
                                "donor_pid": int(donor_pid),
                                "recipient_pid": rid,
                                "donor_party": _clean_party(donor_party),
                                "recipient_party": recip_party_clean,
                                "y_share": float(np.clip(y_share, 0.0, 1.0)),
                                "weight": float(total_pos_d),
                                "is_elimination": int(is_elim),
                                "is_surplus": int(is_surplus),
                            }
                            donor_total = float(tallies[di]) if di is not None else 0.0
                            donor_first = float(first[di]) if di is not None else 0.0
                            base_d = donor_total if donor_total > 0 else donor_first
                            if base_d > 0:
                                don_first_share = float(
                                    np.clip(donor_first / base_d, 0.0, 1.0)
                                )
                            else:
                                don_first_share = 0.0
                            row["don_first_share"] = don_first_share
                            row["don_transfer_share"] = float(
                                max(0.0, 1.0 - don_first_share)
                            )
                            recip_total = float(tallies[r_idx]) if r_idx >= 0 else 0.0
                            recip_first = float(first[r_idx]) if r_idx >= 0 else 0.0
                            base_r = recip_total if recip_total > 0 else recip_first
                            if base_r > 0:
                                rec_first_share = float(
                                    np.clip(recip_first / base_r, 0.0, 1.0)
                                )
                            else:
                                rec_first_share = 0.0
                            row["rec_first_share"] = rec_first_share
                            row["rec_transfer_share"] = float(
                                max(0.0, 1.0 - rec_first_share)
                            )
                            for j, p in enumerate(pspace.top):
                                row[f"don_src::{p}"] = float(don_src[j])
                            row["don_src::OTHER"] = float(don_src[-1])
                            for p in pspace.top:
                                row[f"surv_has::{p}"] = int(surv_has.get(p, 0))
                                row[f"surv_count::{p}"] = float(
                                    min(3, surv_count.get(p, 0))
                                )
                                row[f"surv_share::{p}"] = float(
                                    surv_count.get(p, 0)
                                ) / float(total_survivors)
                            try:
                                total_alive_tally = (
                                    float(tallies[alive].sum())
                                    if isinstance(tallies, np.ndarray)
                                    else 0.0
                                )
                                total_alive_tally = (
                                    total_alive_tally if total_alive_tally > 0 else 1.0
                                )
                                for p in pspace.top:
                                    idxs = [
                                        ii
                                        for ii in range(C)
                                        if alive[ii] and _clean_party(str(parties[ii])) == p
                                    ]
                                    top_val = max(
                                        (float(tallies[ii]) for ii in idxs), default=0.0
                                    )
                                    row[f"surv_top_share::{p}"] = float(top_val) / float(
                                        total_alive_tally
                                    )
                            except Exception:
                                for p in pspace.top:
                                    row[f"surv_top_share::{p}"] = 0.0
                            rows.append(row)
                # --- Add NonTransferable as an explicit recipient if donor_out > donor_pos ---
                try:
                    donor_out = float(
                        -donors_df.loc[
                            donors_df["PersonID"].astype(int) == int(donor_pid), "Transfers"
                        ].sum()
                    )
                    donor_pos = float(total_pos_d)
                    nt_amt = max(donor_out - donor_pos, 0.0)
                    if donor_out > 0 and nt_amt > 0:
                        nt_share = float(nt_amt) / float(donor_out)
                        row_nt = {
                            "date": str(date),
                            "constituency": str(cons),
                            "body": str(body_token),
                            "etype": str(etype_token),
                            "count": int(cnt),
                            "donor_pid": int(donor_pid),
                            "recipient_pid": -1,
                            "donor_party": _clean_party(donor_party),
                            "recipient_party": "NonTransferable",
                            "y_share": float(np.clip(nt_share, 0.0, 1.0)),
                            "weight": float(donor_out),  # weight by donor's outflow
                            "is_elimination": int(is_elim),
                            "is_surplus": int(is_surplus),
                        }
                        donor_total = float(tallies[di]) if di is not None else 0.0
                        donor_first = float(first[di]) if di is not None else 0.0
                        base_d = donor_total if donor_total > 0 else donor_first
                        if base_d > 0:
                            don_first_share = float(np.clip(donor_first / base_d, 0.0, 1.0))
                        else:
                            don_first_share = 0.0
                        row_nt["don_first_share"] = don_first_share
                        row_nt["don_transfer_share"] = float(max(0.0, 1.0 - don_first_share))
                        row_nt["rec_first_share"] = 0.0
                        row_nt["rec_transfer_share"] = 0.0
                        for j, p in enumerate(pspace.top):
                            row_nt[f"don_src::{p}"] = float(don_src[j])
                        row_nt["don_src::OTHER"] = float(don_src[-1])
                        for p in pspace.top:
                            row_nt[f"surv_has::{p}"] = int(surv_has.get(p, 0))
                            row_nt[f"surv_count::{p}"] = float(min(3, surv_count.get(p, 0)))
                            row_nt[f"surv_share::{p}"] = float(surv_count.get(p, 0)) / float(total_survivors)
                            try:
                                total_alive_tally = (
                                    float(tallies[alive].sum())
                                    if isinstance(tallies, np.ndarray)
                                    else 0.0
                                )
                                total_alive_tally = total_alive_tally if total_alive_tally > 0 else 1.0
                                idxs = [
                                    ii
                                    for ii in range(C)
                                    if alive[ii] and _clean_party(str(parties[ii])) == p
                                ]
                                top_val = max((float(tallies[ii]) for ii in idxs), default=0.0)
                                row_nt[f"surv_top_share::{p}"] = float(top_val) / float(total_alive_tally)
                            except Exception:
                                row_nt[f"surv_top_share::{p}"] = 0.0
                        rows.append(row_nt)
                except Exception:
                    pass

            # Apply transfers to update state (aggregate composition)
            donors_list = donors_df[["PersonID", "Transfers"]].to_numpy()
            comp_out = np.zeros((Pk,), dtype=float)
            total_out = 0.0
            for dpid, neg in donors_list:
                di = idx_of.get(int(dpid), None)
                if di is None:
                    continue
                m = float(-neg)
                if m <= 0:
                    continue
                ps = float(prov[di, :].sum()) or 1.0
                comp_out += m * (prov[di, :] / ps)
                total_out += m
            if total_out > 0:
                # Use all positive recipients in this count to update state (not just the last donor's slice)
                for rpid, pos in recips_df_all[["PersonID", "Transfers"]].to_numpy():
                    ri = idx_of.get(int(rpid), None)
                    if ri is None:
                        continue
                    frac = float(pos) / float(total_pos)
                    tallies[ri] += float(pos)
                    prov[ri, :] += frac * comp_out
            # Eliminate donors whose negative equals their tally
            for dpid, neg in donors_list:
                di = idx_of.get(int(dpid), None)
                if di is None:
                    continue
                if abs(float(neg)) >= tallies[di] - 1e-6:
                    alive[di] = False
                    tallies[di] = 0.0
                    prov[di, :] = 0.0

    return pd.DataFrame(rows), pspace


def _compute_nt_rate_by_party(er_df: pd.DataFrame, tr_df: pd.DataFrame) -> Tuple[Dict[str, float], float]:
    """Estimate NonTransferable rate per donor PARTY from raw Transfers."""
    if tr_df is None or tr_df.empty or er_df is None or er_df.empty:
        return {}, 0.0

    er = er_df.copy()
    if "PersonID" not in er.columns:
        return {}, 0.0
    er["PersonID"] = pd.to_numeric(er["PersonID"], errors="coerce")
    er = er[er["PersonID"].notna()].copy()
    er["PersonID"] = er["PersonID"].astype(int)

    pcol = _party_col(er)
    er[pcol] = er[pcol].astype(str)

    def _keycols(df):
        df = df.copy()
        if _DEF_KEY_DATE not in df.columns:
            df[_DEF_KEY_DATE] = df.get("DateStr", "")
        if _DEF_KEY_CONS not in df.columns:
            df[_DEF_KEY_CONS] = df.get("Constituency", "")
        if _DEF_KEY_BODY not in df.columns:
            df[_DEF_KEY_BODY] = df.get("ElectedBody", "")
        df[_DEF_KEY_DATE] = df[_DEF_KEY_DATE].astype(str)
        df[_DEF_KEY_CONS] = df[_DEF_KEY_CONS].astype(str)
        df[_DEF_KEY_BODY] = df[_DEF_KEY_BODY].astype(str)
        return df

    er = _keycols(er)
    tr = _keycols(tr_df)

    party_map = er.set_index([
        _DEF_KEY_DATE,
        _DEF_KEY_CONS,
        _DEF_KEY_BODY,
        "PersonID",
    ])[pcol].to_dict()

    tr = tr.copy()
    tr["PersonID"] = pd.to_numeric(tr.get("PersonID"), errors="coerce")
    tr = tr[tr["PersonID"].notna()].copy()
    tr["PersonID"] = tr["PersonID"].astype(int)
    tr["Count"] = pd.to_numeric(tr.get("Count"), errors="coerce").fillna(0).astype(int)
    tr["Transfers"] = pd.to_numeric(tr.get("Transfers"), errors="coerce").fillna(0.0)

    nt_by_party_num: Dict[str, float] = {}
    nt_by_party_den: Dict[str, float] = {}

    src_col = (
        "SourcePersonID"
        if "SourcePersonID" in tr.columns
        else ("FromPersonID" if "FromPersonID" in tr.columns else None)
    )

    for (date, cons, body), gkey in tr.groupby(
        [_DEF_KEY_DATE, _DEF_KEY_CONS, _DEF_KEY_BODY], dropna=False
    ):
        for cnt, gg in gkey.sort_values("Count").groupby("Count"):
            donors_df = gg[gg["Transfers"] < 0]
            recips_df = gg[gg["Transfers"] > 0]
            if donors_df.empty:
                continue

            donors = donors_df["PersonID"].unique().tolist()
            donor_meta: Dict[int, Dict[str, Optional[str]]] = {}
            donor_weights: Dict[int, float] = {}
            for donor_pid in donors:
                donor_rows = donors_df[donors_df["PersonID"] == donor_pid]
                try:
                    pid_int = int(donor_pid)
                except (TypeError, ValueError):
                    continue
                name_val = ""
                party_val = ""
                if "Name" in donor_rows.columns and not donor_rows["Name"].empty:
                    name_val = str(donor_rows["Name"].iloc[0])
                if "Party" in donor_rows.columns and not donor_rows["Party"].empty:
                    party_val = str(donor_rows["Party"].iloc[0])
                donor_meta[pid_int] = {
                    "name": name_val.strip().lower(),
                    "party": _clean_party(party_val),
                }
                donor_weights[pid_int] = float(abs(donor_rows["Transfers"].sum()))
            for pid, weight in list(donor_weights.items()):
                if weight <= 0:
                    donor_weights[pid] = 1.0

            parsed_recips = [
                (rr, _resolve_row_sources(rr, donor_meta))
                for _, rr in recips_df.iterrows()
            ]

            resolved_single_sources = [
                tuple(pid for pid in sources if pid in donor_weights)
                for _, sources in parsed_recips
            ]
            resolved_single_sources = [src for src in resolved_single_sources if src]
            has_precise_sources = bool(resolved_single_sources) and all(
                len(src) == 1 for src in resolved_single_sources
            )
            donor_parties = []
            for pid in donor_weights:
                meta_party = donor_meta.get(pid, {}).get("party") or ""
                meta_party = _clean_party(meta_party) if meta_party else ""
                if not meta_party:
                    continue
                donor_parties.append(meta_party)
            multi_party_bundle = len({p for p in donor_parties if p}) > 1

            if len(donors) > 1 and multi_party_bundle and not has_precise_sources:
                # Without per-recipient attribution this bundle would smear
                # cross-bloc flows across every donor; skip it when estimating
                # per-party exhaustion so we don't fabricate behaviour.
                continue

            for donor_pid in donors:
                try:
                    donor_pid_int = int(donor_pid)
                except (TypeError, ValueError):
                    continue
                outflow = float(abs(donors_df[donors_df["PersonID"] == donor_pid]["Transfers"].sum()))
                if outflow <= 0:
                    continue

                if src_col and src_col in recips_df.columns:
                    pos_d = float(
                        recips_df[recips_df[src_col].astype(int) == int(donor_pid)]["Transfers"].sum()
                    )
                else:
                    allocations = [
                        float(rr["Transfers"]) * _share_for_donor(donor_pid_int, sources, donor_weights)
                        for rr, sources in parsed_recips
                    ]
                    allocations = [val for val in allocations if val > 0]
                    if not allocations:
                        if len(donors) != 1:
                            continue
                        pos_d = float(recips_df["Transfers"].sum())
                    else:
                        pos_d = float(sum(allocations))

                exhausted = max(outflow - pos_d, 0.0)

                donor_party = _clean_party(
                    str(party_map.get((str(date), str(cons), str(body), int(donor_pid)), ""))
                )
                if donor_party == "":
                    donor_party = "OTHER"

                nt_by_party_num[donor_party] = nt_by_party_num.get(donor_party, 0.0) + exhausted
                nt_by_party_den[donor_party] = nt_by_party_den.get(donor_party, 0.0) + outflow

    rates: Dict[str, float] = {}
    num_all = 0.0
    den_all = 0.0
    for p, den in nt_by_party_den.items():
        num = nt_by_party_num.get(p, 0.0)
        if den > 0:
            r = float(num) / float(den)
            rates[p] = max(0.0, min(0.5, r))
            num_all += num
            den_all += den
    global_rate = (float(num_all) / float(den_all)) if den_all > 0 else 0.0
    global_rate = max(0.0, min(0.5, global_rate))
    return rates, global_rate
