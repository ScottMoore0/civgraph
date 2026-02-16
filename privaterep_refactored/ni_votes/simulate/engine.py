"""
Patched fast engine for NI Votes

Key improvements:
- Fast path for single-seat (IRV): O(C) per round with NumPy.
- On-demand transfer predictions with caching (no full CxC matrix).
- No pandas in the hot loop.
- Optional approximate multi-seat STV (surplus+elimination) using the same
  on-demand predictor; designed to be simple and fast.

Public API (kept stable):
    run_scenario(er_df, tr_df, scenario_dict) -> dict
"""

from typing import Dict, Any, List, Tuple, Optional
import numpy as np

try:  # pandas is an optional dependency in a few entry points
    import pandas as pd
except Exception:  # pragma: no cover - fallback when pandas unavailable
    pd = None  # type: ignore

# Transfer model
try:
    from ..features.transfers import get_transfer_model, build_feature_context
except Exception:
    from ni_votes.features.transfers import get_transfer_model, build_feature_context  # type: ignore

# NonTransferable pseudo-candidate
NONTRANS_ID = -1
NONTRANS_NAME = "NonTransferable"
NONTRANS_PARTY = None


# Display helpers
def _display_party(party: str) -> str:
    try:
        s = str(party or "")
        if "#" in s:
            s = s.split("#", 1)[0]
        return s.strip()
    except Exception:
        return str(party)


def _display_name(name: str) -> str:
    try:
        s = str(name or "")
        if "#" in s:
            s = s.split("#", 1)[0]
        return s.strip()
    except Exception:
        return str(name)


# Shared formatting helpers -------------------------------------------------

def _safe_int(value: Any) -> Optional[int]:
    """Best-effort conversion to int; returns None on failure."""

    if value is None:
        return None
    try:
        if isinstance(value, str):
            if not value.strip():
                return None
            return int(float(value))
        if isinstance(value, (int, np.integer)):
            return int(value)
        if isinstance(value, (float, np.floating)):
            if not np.isfinite(value):
                return None
            return int(value)
        return int(value)
    except Exception:
        return None


# ----------------------- Caching + utilities -----------------------

_TRANSFER_CACHE: Dict[Tuple[int, Tuple[int, ...]], np.ndarray] = {}


def _winner_over_quota(tallies: np.ndarray, quota: float) -> Optional[int]:
    idx = int(np.argmax(tallies))
    return idx if tallies[idx] >= quota else None


def _signature(survivors: np.ndarray) -> Tuple[int, ...]:
    return tuple(np.nonzero(survivors)[0].tolist())


def _predict_transfers_on_demand(
    elim_idx: int,
    survivors_mask: np.ndarray,
    model,
    feat_ctx: Dict[str, Any],
) -> np.ndarray:
    # Build a cache key that respects dynamic context (count + donor provenance)
    key_parts: List[Any] = [elim_idx, _signature(survivors_mask)]
    prov = feat_ctx.get("prov")
    try:
        import zlib

        if isinstance(prov, np.ndarray) and elim_idx < getattr(prov, "shape", (0,))[0]:
            key_parts.append(int(feat_ctx.get("count", 0)))
            try:
                key_parts.append(
                    zlib.crc32(prov[elim_idx].astype(np.float32).tobytes())
                )
            except Exception:
                key_parts.append(0)
    except Exception:
        pass
    sig = tuple(key_parts)
    cached = _TRANSFER_CACHE.get(sig)
    if cached is not None:
        # Debug cache hit
        try:
            if feat_ctx.get("debug_mode") and feat_ctx.get("sse_job"):
                from ..web.routes import _push

                _push(
                    feat_ctx.get("sse_job"),
                    {
                        "type": "log",
                        "msg": f"ML: cache hit for donor={elim_idx} survivors={len(_signature(survivors_mask))} count={feat_ctx.get('count',0)}",
                    },
                )
        except Exception:
            pass
        return np.asarray(cached, dtype=float).copy()

    surv_idx = np.nonzero(survivors_mask)[0]
    if surv_idx.size > 0:
        # IMPORTANT: expect_proba may sum <= 1.0 (leftover is NT).
        probs_surv = np.asarray(
            model.expect_proba(elim_idx, surv_idx, feat_ctx), dtype=float
        )

        # Clip to [0,1], and DO NOT normalise up to 1.
        # Only bring down if someone accidentally exceeds 1 due to a model bug.
        if not np.all(np.isfinite(probs_surv)):
            probs_surv = np.nan_to_num(probs_surv, nan=0.0, posinf=0.0, neginf=0.0)

        probs_surv = np.clip(probs_surv, 0.0, 1.0)
        s = float(probs_surv.sum())

        if s > 1.0 + 1e-9:
            # Defensive: scale down to sum <= 1 if it overshoots
            probs_surv = probs_surv / s

        result = probs_surv

        # Debug SSE log
        try:
            if feat_ctx.get("debug_mode") and feat_ctx.get("sse_job"):
                from ..web.routes import _push  # lazy import to avoid cycles

                donor_name = None
                names = feat_ctx.get("names", [])
                if isinstance(names, list) and elim_idx < len(names):
                    donor_name = _display_name(names[elim_idx])
                parties = feat_ctx.get("party", [])
                donor_party = (
                    parties[elim_idx]
                    if isinstance(parties, (list, np.ndarray))
                    and elim_idx < len(parties)
                    else ""
                )
                recips = []
                for j, p in zip(surv_idx.tolist(), result.tolist()):
                    nm = (
                        _display_name(names[j])
                        if isinstance(names, list) and j < len(names)
                        else ""
                    )
                    rp = (
                        parties[j]
                        if isinstance(parties, (list, np.ndarray)) and j < len(parties)
                        else ""
                    )
                    recips.append({"idx": j, "name": nm, "party": rp, "p": p})
                dbg = getattr(model, "_last_debug", {}) or {}
                ent = dbg.get("entropy")
                lam = dbg.get("lambda")
                prior = dbg.get("prior")
                sim = dbg.get("similarity")
                parts = []
                if ent is not None:
                    parts.append(f"entropy={ent:.3f}")
                if lam is not None:
                    parts.append(f"lambda={lam:.2f}")
                if prior:
                    parts.append(f"prior={prior}")
                if sim is not None:
                    parts.append(f"sim={sim:.3f}")
                dbg_txt = (" (" + ", ".join(parts) + ")") if parts else ""
                _push(
                    feat_ctx.get("sse_job"),
                    {
                        "type": "log",
                        "msg": f"ML: donor={donor_name or elim_idx} ({donor_party}) → survivors={len(surv_idx)} probs={result.tolist()}"
                        + dbg_txt,
                    },
                )
        except Exception:
            pass
    else:
        result = np.zeros((0,), dtype=float)

    result_arr = np.asarray(result, dtype=float)
    _TRANSFER_CACHE[sig] = result_arr.copy()
    return result_arr


# ----------------------- Debug helper -----------------------


def _record_debug(
    feat_ctx: Dict[str, Any],
    model: Any,
    donor_idx: int,
    surv_idx: np.ndarray,
    surv_probs: np.ndarray,
    p_nt: float,
    *,
    names: Optional[List[str]] = None,
    parties: Optional[List[str]] = None,
) -> None:
    try:
        series = feat_ctx.setdefault("_debug_series", [])
    except Exception:
        return

    survivor_indices = [int(x) for x in np.asarray(surv_idx, dtype=int).tolist()]
    entry: Dict[str, Any] = {
        "donor_index": int(donor_idx),
        "survivor_indices": survivor_indices,
        "probabilities": [float(x) for x in np.asarray(surv_probs, dtype=float).tolist()],
        "p_nt": float(p_nt),
        "count_number": int(feat_ctx.get("count", 0) or 0),
        "event_type": "surplus"
        if int(feat_ctx.get("is_surplus", 0) or 0)
        else ("elimination" if int(feat_ctx.get("is_elimination", 0) or 0) else "other"),
    }

    if names is not None and 0 <= donor_idx < len(names):
        entry["donor_name"] = _display_name(names[donor_idx])
    if parties is not None and 0 <= donor_idx < len(parties):
        entry["donor_party"] = _display_party(parties[donor_idx])
    if names is not None and parties is not None and survivor_indices:
        surv_info: List[Dict[str, Any]] = []
        for idx in survivor_indices:
            info: Dict[str, Any] = {"index": idx}
            if 0 <= idx < len(names):
                info["name"] = _display_name(names[idx])
            if 0 <= idx < len(parties):
                info["party"] = _display_party(parties[idx])
            surv_info.append(info)
        entry["survivors"] = surv_info

    dbg = getattr(model, "_last_debug", None)
    if isinstance(dbg, dict):
        def _convert(value: Any) -> Any:
            if isinstance(value, np.ndarray):
                return value.astype(float).tolist()
            if isinstance(value, (np.floating, np.integer)):
                return float(value)
            if isinstance(value, list):
                return [_convert(v) for v in value]
            if isinstance(value, dict):
                return {k: _convert(v) for k, v in value.items()}
            return value

        entry["model_debug"] = {k: _convert(v) for k, v in dbg.items()}

    series.append(entry)


# ----------------------- Mass conservation helper -----------------------


def _enforce_mass_conservation(
    tallies: np.ndarray,
    total_before: float,
    nt_increment: float,
) -> None:
    """Rescale ``tallies`` so that votes + non-transferables stay at ``total_before``."""

    target = max(total_before - nt_increment, 0.0)
    actual = float(np.asarray(tallies, dtype=float).sum())

    if target <= 0.0:
        if actual > 0.0:
            tallies[:] = 0.0
        return

    if actual <= 0.0:
        return

    if abs(actual - target) <= 1e-9 * max(1.0, target):
        return

    scale = target / actual
    tallies *= scale


# ----------------------- Output formatting -----------------------


def _format_output(
    counts: List[Tuple[str, np.ndarray]],
    names: List[str],
    parties: List[str],
    first_prefs: np.ndarray,
    seats: int,
    quota: float,
    meta: Dict[str, Any],
) -> Dict[str, Any]:
    C = len(names)
    valid = float(first_prefs.sum()) if first_prefs.size else 0.0
    base = first_prefs.astype(float)
    columns = ["Candidate", "Party", "1st Pref %", "1st Pref"]
    count_meta: List[Dict[str, Any]] = []
    debug_series = list(meta.get("debug_series") or [])
    debug_by_count: Dict[int, List[Dict[str, Any]]] = {}
    for entry in debug_series:
        try:
            count_no = int(entry.get("count_number", 0) or 0)
        except Exception:
            continue
        if count_no <= 0:
            continue
        debug_by_count.setdefault(count_no, []).append(entry)
    prev_vec = base.copy()
    for i, (label, totals) in enumerate(counts, start=1):
        arr = np.asarray(totals, dtype=float)
        columns += [f"Count {i} — {label}", f"Δ{i}"]
        count_entry = {
            "label": label,
            "totals": arr.tolist(),
            "deltas": (arr - prev_vec).tolist(),
        }
        if i in debug_by_count:
            count_entry["debug"] = debug_by_count[i]
        count_meta.append(count_entry)
        prev_vec = arr
    nt_series = list(meta.get("_nt_series") or [])

    # Elected mask — UI will bold on this (keep text plain here)
    # Derive elected mask
    elected_mask = [False] * C
    try:
        if quota is not None and isinstance(counts, list) and len(counts) > 0:
            # Step 1: Mark all candidates who reached/exceeded quota at any point
            for i in range(C):
                for _, t in counts:
                    if float(t[i]) >= float(quota) - 1e-6:
                        elected_mask[i] = True
                        break
            
            # Step 2: For multi-seat elections, fill remaining seats if needed
            # This handles candidates elected under quota on final count
            if seats > 1:
                # Count how many seats are already filled (candidates who reached quota)
                seats_filled = sum(elected_mask)
                remaining_seats = seats - seats_filled
                
                if remaining_seats > 0:
                    # Get final vote totals from last count
                    last_count = counts[-1][1] if counts else first_prefs
                    
                    # Create list of candidates not yet elected with their final votes
                    unelected = []
                    for i in range(C):
                        if not elected_mask[i] and i < len(last_count):
                            unelected.append((i, float(last_count[i])))
                    
                    # Sort by final vote count (descending)
                    unelected.sort(key=lambda x: x[1], reverse=True)
                    
                    # Fill remaining seats with top vote-getters
                    for i in range(min(remaining_seats, len(unelected))):
                        idx, votes = unelected[i]
                        elected_mask[idx] = True
            
            # Step 3: For single-seat elections (IRV), if no one reached quota, leader wins
            elif seats == 1 and not any(elected_mask):
                # Treat the final leader as elected (IRV completion)
                last_t = counts[-1][1] if counts else first_prefs
                if len(last_t) == C:
                    elected_mask[int(np.argmax(last_t))] = True
    except Exception as e:
        # If anything goes wrong, fall back to simple logic
        print(f"DEBUG: Error in elected_mask generation: {e}")
        pass

    rows = []
    for i in range(C):
        pct = (base[i] / valid * 100.0) if valid > 0 else 0.0
        display_name = _display_name(names[i]) if i < len(names) else ""
        party_display = _display_party(parties[i] if i < len(parties) else "")
        row = [display_name, party_display, f"{pct:.2f}%", f"{int(round(base[i])):,}"]
        prev = base[i]
        for _, t in counts:
            cur = float(t[i])
            d = cur - prev
            row += [f"{int(round(cur)):,}", f"{'+' if d >= 0 else ''}{d:.2f}"]
            prev = cur
        rows.append(row)

    # NonTransferable row: prefer engine-recorded increments; fall back to residuals
    nt_row = ["NonTransferable", "", "", "0"]
    prev_nt = 0.0
    if nt_series and isinstance(nt_series, (list, tuple)):
        cum = 0.0
        for i, _ in enumerate(counts):
            inc = float(nt_series[i]) if i < len(nt_series) else 0.0
            cum += inc
            d = cum - prev_nt
            nt_row += [
                f"{int(round(cum)):,}",
                f"{'+' if d >= 0 else ''}{int(round(d)):,}",
            ]
            prev_nt = cum
    else:
        for _, t in counts:
            total_t = float(np.asarray(t, dtype=float).sum()) if t is not None else 0.0
            cur_nt = max(valid - total_t, 0.0)
            d = cur_nt - prev_nt
            nt_row += [
                f"{int(round(cur_nt)):,}",
                f"{'+' if d >= 0 else ''}{int(round(d)):,}",
            ]
            prev_nt = cur_nt
    rows.append(nt_row)

    summary = {
        "Constituency": meta.get("constituency") or "",
        "Seats": seats,
        "Quota": int(round(quota)) if quota is not None else None,
        "Electorate": meta.get("electorate"),
        "Turnout": meta.get("turnout"),
        "Spoiled": meta.get("spoiled"),
        "Valid": int(round(valid)) if valid else None,
    }

    return {
        "columns": columns,
        "rows": rows,
        "summary": summary,
        "quota": summary["Quota"],
        "valid": summary["Valid"],
        "elected_mask": elected_mask,  # UI uses this to bold winners
        "counts_meta": count_meta,
        "nt_series": nt_series,
        "first_prefs": base.tolist(),
        "debug_series": debug_series,
    }


# Viewer-style payload helpers ----------------------------------------------

def _scenario_party_totals(
    candidates: List[Dict[str, Any]],
    valid_votes: Optional[float],
    seats: int,
    meta_totals: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    totals: Dict[str, Dict[str, Any]] = {}
    total_first_pref = 0.0
    total_candidates = 0
    total_elected = 0

    for cand in candidates:
        party_label = _display_party(cand.get("party")) or "Independent"
        entry = totals.setdefault(
            party_label,
            {"party": party_label, "candidates": 0, "elected": 0, "first_pref": 0.0},
        )
        first_pref_val = cand.get("first_pref")
        try:
            pref = float(first_pref_val) if first_pref_val is not None else 0.0
        except Exception:
            pref = 0.0
        entry["first_pref"] += pref
        entry["candidates"] += 1
        if cand.get("is_elected"):
            entry["elected"] += 1
            total_elected += 1
        total_first_pref += pref
        total_candidates += 1

    valid_total = None
    try:
        if valid_votes is not None:
            valid_total = float(valid_votes)
    except Exception:
        valid_total = None
    if valid_total is None:
        valid_total = total_first_pref

    seats_total = None
    try:
        seats_total = int(seats) if seats is not None else None
    except Exception:
        seats_total = None
    if seats_total is None and total_elected > 0:
        seats_total = total_elected

    electorate_total = None
    spoiled_total = None
    turnout_total = None
    did_not_vote_total = None
    if isinstance(meta_totals, dict):
        try:
            electorate_total = (
                float(meta_totals.get("Electorate"))
                if meta_totals.get("Electorate") is not None
                else None
            )
        except Exception:
            electorate_total = None
        try:
            spoiled_total = (
                float(meta_totals.get("Spoiled"))
                if meta_totals.get("Spoiled") is not None
                else None
            )
        except Exception:
            spoiled_total = None
        try:
            turnout_total = (
                float(meta_totals.get("Turnout"))
                if meta_totals.get("Turnout") is not None
                else None
            )
        except Exception:
            turnout_total = None
        try:
            did_not_vote_total = (
                float(meta_totals.get("DidNotVote"))
                if meta_totals.get("DidNotVote") is not None
                else None
            )
        except Exception:
            did_not_vote_total = None

    if turnout_total is None and spoiled_total is not None and valid_total is not None:
        try:
            turnout_total = float(valid_total) + float(spoiled_total)
        except Exception:
            turnout_total = None
    if did_not_vote_total is None and turnout_total is not None and electorate_total is not None:
        try:
            candidate = float(electorate_total) - float(turnout_total)
            if candidate >= 0:
                did_not_vote_total = candidate
        except Exception:
            did_not_vote_total = None

    rows: List[Dict[str, Any]] = []
    for party_label, entry in totals.items():
        first_pref_val = entry["first_pref"]
        pct = None
        try:
            if valid_total and valid_total > 0:
                pct = (first_pref_val / valid_total) * 100.0
        except Exception:
            pct = None
        rows.append(
            {
                "party": party_label,
                "candidates": entry["candidates"],
                "elected": entry["elected"],
                "first_pref": first_pref_val,
                "first_pref_pct": pct,
            }
        )

    rows.sort(key=lambda r: (-r["first_pref"], r["party"].casefold()))

    summary = {
        "total_candidates": total_candidates,
        "total_elected": total_elected,
        "total_first_pref": total_first_pref,
        "valid_total": valid_total,
        "spoiled_total": spoiled_total,
        "turnout_total": turnout_total,
        "electorate_total": electorate_total,
        "did_not_vote_total": did_not_vote_total,
        "seats_total": seats_total,
    }

    return {
        "rows": rows,
        "summary": summary,
        "elected_mask": elected_mask  # CRITICAL: Add elected mask for cross-validation
    }


def _build_viewer_payload(
    result: Dict[str, Any],
    scenario_dict: Dict[str, Any],
    names: List[str],
    parties: List[str],
    ids: List[str],
    first_prefs: np.ndarray,
    seats: int,
) -> Dict[str, Any]:
    counts_meta = result.get("counts_meta") or []
    summary = result.get("summary") or {}
    quota = summary.get("Quota") or result.get("quota")
    valid = summary.get("Valid") or result.get("valid")
    if valid is None and isinstance(first_prefs, np.ndarray):
        total = float(first_prefs.sum()) if first_prefs.size else 0.0
        valid = total if total > 0 else None

    electorate = summary.get("Electorate") or scenario_dict.get("electorate")
    turnout = summary.get("Turnout") or scenario_dict.get("turnout")
    spoiled = summary.get("Spoiled") or scenario_dict.get("spoiled")

    counts: List[int] = [1]
    for idx in range(len(counts_meta)):
        counts.append(idx + 2)

    valid_total_float = None
    try:
        if valid is not None:
            valid_total_float = float(valid)
    except Exception:
        valid_total_float = None

    first_array = (
        first_prefs.astype(float).tolist()
        if isinstance(first_prefs, np.ndarray)
        else [float(x) for x in first_prefs]
    )
    elected_mask = result.get("elected_mask") or []

    candidates: List[Dict[str, Any]] = []
    for idx, name in enumerate(names):
        party = parties[idx] if idx < len(parties) else ""
        first_val = 0.0
        if idx < len(first_array):
            try:
                first_val = float(first_array[idx])
            except Exception:
                first_val = 0.0
        votes_by_count: List[Optional[float]] = [first_val]
        last_active_index = 0
        for count_idx, meta_entry in enumerate(counts_meta, start=1):
            totals = meta_entry.get("totals") or []
            try:
                val = float(totals[idx]) if idx < len(totals) else votes_by_count[-1]
            except Exception:
                val = votes_by_count[-1]
            votes_by_count.append(val)
            if val is not None:
                if abs(val) > 1e-9 or count_idx == len(counts_meta):
                    last_active_index = count_idx
        is_elected = bool(elected_mask[idx]) if idx < len(elected_mask) else False
        elected_count = None
        effective_quota = None
        try:
            if quota is not None:
                effective_quota = float(quota)
        except Exception:
            effective_quota = None
        if is_elected and effective_quota is not None:
            for count_idx, value in enumerate(votes_by_count[1:], start=1):
                if value is not None and value >= effective_quota - 1e-6:
                    elected_count = counts[count_idx]
                    break
        status = "Elected" if is_elected else "Excluded"
        if last_active_index == 0 and not is_elected:
            status = "Not elected"
        cand_entry = {
            "rank": idx + 1,
            "person_id": _safe_int(ids[idx]) if idx < len(ids) else None,
            "name": _display_name(name),
            "party": _display_party(party),
            "party_display": _display_party(party),
            "first_pref": first_val,
            "first_pref_pct_value": (
                (first_val / valid_total_float) * 100.0
                if valid_total_float and valid_total_float > 0
                else None
            ),
            "votes_by_count": votes_by_count,
            "is_elected": is_elected,
            "status": status,
            "elected_count": elected_count,
            "last_active_count": counts[last_active_index]
            if last_active_index < len(counts)
            else counts[-1],
            "last_active_index": last_active_index,
            "eliminated_count": None
            if is_elected
            else (
                counts[last_active_index]
                if last_active_index > 0 and last_active_index < len(counts)
                else None
            ),
            "force_zero_counts": [],
        }
        candidates.append(cand_entry)

    did_not_vote = None
    if electorate is not None and turnout is not None:
        try:
            did_not_vote = float(electorate) - float(turnout)
            if did_not_vote < 0:
                did_not_vote = None
        except Exception:
            did_not_vote = None

    meta_totals = {
        "Electorate": electorate,
        "Turnout": turnout,
        "Spoiled": spoiled,
        "Valid": valid,
        "DidNotVote": did_not_vote,
    }
    party_totals = _scenario_party_totals(
        candidates,
        valid_total_float,
        seats,
        meta_totals=meta_totals,
    )

    nt_series = result.get("nt_series") or []
    nt_timeline: List[float] = [0.0]
    cumulative = 0.0
    for inc in nt_series:
        try:
            cumulative += float(inc)
        except Exception:
            continue
        nt_timeline.append(cumulative)
    while len(nt_timeline) < len(counts):
        nt_timeline.append(cumulative)
    if len(nt_timeline) > len(counts):
        nt_timeline = nt_timeline[: len(counts)]

    def _candidate_ref(index: int) -> Dict[str, Any]:
        name = _display_name(names[index]) if index < len(names) else ""
        party = _display_party(parties[index] if index < len(parties) else "")
        return {
            "person_id": _safe_int(ids[index]) if index < len(ids) else None,
            "name": name,
            "party": party,
            "label": name,
            "source_label": name,
            "source_party": party,
        }

    def _recipient_entry(index: int, votes: float) -> Dict[str, Any]:
        name = _display_name(names[index]) if index < len(names) else ""
        party = _display_party(parties[index] if index < len(parties) else "")
        return {
            "dest_type": "candidate",
            "type": "candidate",
            "person_id": _safe_int(ids[index]) if index < len(ids) else None,
            "votes": votes,
            "name": name,
            "party": party,
            "breakdown": [],
        }

    transfer_frames: List[Dict[str, Any]] = []
    transfer_events: List[Dict[str, Any]] = []
    authoritative_events: List[Dict[str, Any]] = []

    nt_series_raw = result.get("nt_series") or []

    for idx, meta_entry in enumerate(counts_meta, start=1):
        deltas_raw = meta_entry.get("deltas") or []
        totals = meta_entry.get("totals") or []
        label = meta_entry.get("label")
        frame_entries: List[Dict[str, Any]] = []
        deltas: List[Optional[float]] = []
        for cand_idx, name in enumerate(names):
            delta_val = None
            total_val = None
            try:
                if cand_idx < len(deltas_raw):
                    delta_val = float(deltas_raw[cand_idx])
            except Exception:
                delta_val = None
            deltas.append(delta_val)
            try:
                if cand_idx < len(totals):
                    total_val = float(totals[cand_idx])
            except Exception:
                total_val = None
            frame_entries.append(
                {
                    "name": _display_name(name),
                    "party": _display_party(parties[cand_idx] if cand_idx < len(parties) else ""),
                    "delta": delta_val,
                    "total": total_val,
                }
            )
        count_number = counts[idx] if idx < len(counts) else idx + 1
        transfer_frames.append(
            {
                "count": count_number,
                "raw_count": idx,
                "label": label,
                "entries": frame_entries,
            }
        )

        nt_increment = None
        if idx - 1 < len(nt_series_raw):
            try:
                nt_val = float(nt_series_raw[idx - 1])
                if abs(nt_val) > 1e-9:
                    nt_increment = nt_val
            except Exception:
                nt_increment = None

        debug_entries = meta_entry.get("debug") or []
        bucket_events: List[Dict[str, Any]] = []

        def _build_event_from_donor(
            donor_index: int, event_type: Optional[str], label_text: Optional[str]
        ) -> None:
            if donor_index is None or donor_index < 0 or donor_index >= len(names):
                return
            donor_delta = deltas[donor_index]
            try:
                transfer_total = float(donor_delta) if donor_delta is not None else 0.0
            except Exception:
                transfer_total = 0.0
            if transfer_total < 0:
                transfer_total = -transfer_total
            else:
                # If the donor delta is not negative, fall back to zero to avoid bogus totals.
                transfer_total = 0.0

            donor_ref = _candidate_ref(donor_index)
            donors = [dict(donor_ref)]
            if transfer_total > 0:
                donors[0]["loss"] = transfer_total
                donors[0]["contribution"] = transfer_total

            segments: List[Dict[str, Any]] = []
            for cand_idx, delta_val in enumerate(deltas):
                if cand_idx == donor_index:
                    continue
                try:
                    dv = float(delta_val)
                except Exception:
                    continue
                if dv > 1e-9:
                    segments.append(_recipient_entry(cand_idx, dv))

            if nt_increment is not None:
                segments.append(
                    {
                        "dest_type": "non_transferable",
                        "type": "non_transferable",
                        "person_id": None,
                        "votes": nt_increment,
                        "name": "Non-transferable",
                        "party": "",
                        "breakdown": [],
                    }
                )

            classification = (event_type or "").strip().lower()
            simple_event = {
                "count": count_number,
                "raw_count": idx,
                "label": label_text or label,
                "event_type": classification or "",
                "source_label": donors[0].get("name", ""),
                "source_candidates": donors,
                "segments": segments,
                "non_transferable": nt_increment,
                "total_transferred": transfer_total if transfer_total else None,
            }
            transfer_events.append(simple_event)

            authoritative_event = {
                "count": count_number,
                "raw_count": idx,
                "event_type": classification or "",
                "source_label": donors[0].get("name", ""),
                "total_transferred": transfer_total if transfer_total else None,
                "non_transferable": nt_increment,
                "source_candidates": donors,
                "segments": segments,
                "source": {
                    "label": donors[0].get("name", ""),
                    "party": donors[0].get("party", ""),
                    "components": donors,
                    "total_transferred": transfer_total if transfer_total else None,
                    "classification": classification or "",
                    "is_surplus": classification == "surplus",
                    "is_exclusion": classification in {"elimination", "exclusion"},
                },
                "destinations": [dict(segment) for segment in segments],
            }
            bucket_events.append(authoritative_event)

        for dbg in debug_entries:
            donor_index = None
            event_type = ""
            if isinstance(dbg, dict):
                donor_index = dbg.get("donor_index")
                event_type = dbg.get("event_type") or ""
            try:
                donor_index = int(donor_index) if donor_index is not None else None
            except Exception:
                donor_index = None
            _build_event_from_donor(donor_index, str(event_type).lower(), label)

        if not bucket_events and any((delta or 0) < -1e-9 for delta in deltas if delta is not None):
            inferred_type = "elimination"
            label_lower = (label or "").lower()
            if "surplus" in label_lower:
                inferred_type = "surplus"
            for donor_index, delta_val in enumerate(deltas):
                if delta_val is None or delta_val >= -1e-9:
                    continue
                _build_event_from_donor(donor_index, inferred_type, label)

        if bucket_events:
            authoritative_events.append({
                "count": count_number,
                "events": bucket_events,
            })

    candidate_summary = {
        "constituency": summary.get("Constituency") or scenario_dict.get("constituency"),
        "seats": seats,
        "valid": valid,
        "quota": quota,
        "turnout": turnout,
        "spoiled": spoiled,
        "electorate": electorate,
        "did_not_vote": did_not_vote,
    }

    return {
        "counts": counts,
        "candidates": candidates,
        "valid": valid,
        "candidate_summary": candidate_summary,
        "party_totals": party_totals,
        "non_transferable_by_count": nt_timeline,
        "transfer_sources": {},
        "transfer_animation_events": transfer_frames,
        "transfer_events": transfer_events,
        "authoritative_transfer_events": authoritative_events,
        "has_previous_candidates": False,
        "is_forum_election": False,
    }


# ----------------------- IRV (single seat) -----------------------


def _run_irv_fast(
    first_prefs: np.ndarray,
    quota: float,
    names: List[str],
    ids: List[str],
    parties: List[str],
    model,
    feat_ctx: Dict[str, Any],
    *,
    sequential_elimination: bool = False,
) -> List[Tuple[str, np.ndarray]]:
    C = first_prefs.shape[0]
    tallies = first_prefs.astype(float).copy()
    alive = np.ones(C, dtype=bool)
    counts: List[Tuple[str, np.ndarray]] = []

    prov = feat_ctx.get("prov")

    while alive.sum() > 1:
        alive_idx = np.nonzero(alive)[0]
        alive_tallies = tallies[alive]

        # If only two remain, halt the simulation and declare the leader the winner.
        if alive_idx.size == 2:
            break

        order = alive_idx[np.argsort(alive_tallies)]
        elim_group: List[int]
        if sequential_elimination or order.size <= 1:
            elim_group = [int(order[0])]
        else:
            elim_group = []
            sorted_vals = alive_tallies[np.argsort(alive_tallies)]
            for k in range(2, len(order) + 1):
                prefix = float(sorted_vals[:k].sum())
                next_val = float(sorted_vals[k]) if k < len(order) else float("inf")
                if prefix + 1e-9 < next_val:
                    elim_group = order[:k].tolist()
                else:
                    break
            if not elim_group:
                elim_group = [int(order[0])]
            # Never eliminate down to fewer than two survivors in a single step
            survivors_after = alive.sum() - len(elim_group)
            if survivors_after < 2 and len(elim_group) > 1:
                trim = min(len(elim_group) - 1, 2 - max(survivors_after, 0))
                if trim > 0:
                    elim_group = elim_group[:-trim] or [int(order[0])]

        survivors = alive.copy()
        for idx in elim_group:
            survivors[idx] = False

        # ▶ NT slot for this count
        _ = feat_ctx.setdefault("_nt_series", [])
        if len(feat_ctx["_nt_series"]) < len(counts) + 1:
            feat_ctx["_nt_series"].append(0.0)
        nt_slot = len(feat_ctx["_nt_series"]) - 1

        feat_ctx["is_elimination"] = 1
        feat_ctx["is_surplus"] = 0
        feat_ctx["count"] = int(feat_ctx.get("count", 0)) + 1

        current_tallies = tallies.copy()
        group_labels: List[str] = []

        for elim in elim_group:
            total_before = float(current_tallies.sum())
            feat_ctx["alive"] = survivors.copy()
            feat_ctx["tallies"] = current_tallies.copy()
            surv_idx = np.nonzero(survivors)[0]
            try:
                probs, p_nt = model.expect_proba_with_nt(elim, surv_idx, feat_ctx)
            except Exception:
                probs = _predict_transfers_on_demand(
                    elim, survivors, model, feat_ctx
                )
                try:
                    if bool(feat_ctx.get("ignore_priors")):
                        p_nt = 0.0
                    else:
                        p_nt = float(model.exhaust_rate(elim, feat_ctx))
                    p_nt = max(0.0, min(0.95, p_nt))
                except Exception:
                    p_nt = 0.02
                s = float(probs.sum())
                if s > 0:
                    probs *= (1.0 - p_nt) / s
                else:
                    k = float(survivors.sum())
                    probs[:] = (1.0 - p_nt) / max(1.0, k)

            final_surv_probs = np.asarray(probs, dtype=float)
            _record_debug(
                feat_ctx,
                model,
                elim,
                surv_idx,
                final_surv_probs,
                p_nt,
                names=names,
                parties=parties,
            )

            probs_full = np.zeros(C, dtype=float)
            probs_full[surv_idx] = probs
            probs = probs_full

            transfer_mass = current_tallies[elim]
            current_tallies[elim] = 0.0
            current_tallies += transfer_mass * probs
            nt_inc = float(transfer_mass * p_nt)
            feat_ctx["_nt_series"][nt_slot] += nt_inc
            _enforce_mass_conservation(current_tallies, total_before, nt_inc)

            if isinstance(prov, np.ndarray) and prov.shape[0] == C:
                v = prov[elim, :].astype(float)
                vs = float(v.sum()) or 1.0
                for j in range(C):
                    if survivors[j] and probs[j] > 0.0:
                        prov[j, :] += (transfer_mass * float(probs[j])) * (v / vs)
                prov[elim, :] = 0.0

            group_labels.append(
                f"{_display_name(names[elim])} ({_display_party(parties[elim])})"
            )

        tallies = current_tallies
        for elim in elim_group:
            alive[elim] = False

        label = "elimination of " + ", ".join(group_labels)
        if len(elim_group) > 1:
            label += " (Rule 44H)"
        counts.append((label, tallies.copy()))

        win = _winner_over_quota(tallies, quota)
        if win is not None and alive.sum() <= 2:
            break

    return counts


# ----------------------- Approximate multi-seat STV -----------------------


def _run_stv_multi(
    first_prefs: np.ndarray,
    seats: int,
    quota: float,
    names: List[str],
    ids: List[str],
    parties: List[str],
    model,
    feat_ctx: Dict[str, Any],
    *,
    sequential_elimination: bool = False,
) -> List[Tuple[str, np.ndarray]]:
    C = first_prefs.shape[0]
    tallies = first_prefs.astype(float).copy()
    alive = np.ones(C, dtype=bool)
    elected = np.zeros(C, dtype=bool)
    counts: List[Tuple[str, np.ndarray]] = []
    
    # Maximum iteration safeguard - prevent infinite loops
    MAX_TOTAL_ITERATIONS = 5000
    total_iterations = 0

    # provenance matrix
    prov = feat_ctx.get("prov")

    def _electables():
        idx = np.where((alive) & (~elected) & (tallies >= quota))[0]
        return idx.tolist()

    def _continuing():
        idx = np.where((alive) & (~elected))[0]
        return idx.tolist()

    while (elected.sum() < seats) and (alive.sum() > 0):
        # ===== GLOBAL SAFEGUARD: Prevent infinite loops =====
        total_iterations += 1
        if total_iterations > MAX_TOTAL_ITERATIONS:
            # Emergency break - election is taking too many iterations
            break
            
        # ===== PHASE 1: Transfer ALL surpluses until none remain =====
        # Check if election is already complete before processing
        if elected.sum() >= seats:
            break
            
        surplus_processed = False
        surplus_loop_count = 0
        MAX_SURPLUS_ITERATIONS = 1000  # Prevent infinite loops
        while True:
            surplus_loop_count += 1
            if surplus_loop_count > MAX_SURPLUS_ITERATIONS:
                # Emergency break - election may be in inconsistent state
                break
                
            # Check if election completed during surplus processing
            if elected.sum() >= seats:
                break
                
            electables = _electables()
            if not electables:
                break
                
            made_progress = False
            surplus_transferred_this_iteration = False
            for cand in electables:
                # Check before electing each candidate
                if elected.sum() >= seats:
                    break
                    
                # Mark as elected and remove from alive pool immediately
                elected[cand] = True
                alive[cand] = False  # FIX FOR ISSUE 1: Elected candidates should not receive transfers
                made_progress = True
                
                # CRITICAL: Do NOT transfer surplus if election is now complete
                if elected.sum() >= seats:
                    # Election complete - fix at quota and stop
                    tallies[cand] = quota
                    break
                
                surplus = max(tallies[cand] - quota, 0.0)
                if surplus > 0:
                    total_before = float(tallies.sum())
                    # CRITICAL: Explicitly exclude BOTH eliminated AND elected candidates
                    # Using just 'alive' is not enough - elected candidates are technically "alive"
                    # but should NEVER receive transfers under any circumstances
                    survivors = alive.copy() & ~elected  # Active AND not elected
                    
                    # dynamic context for surplus
                    feat_ctx["alive"] = survivors.copy()
                    feat_ctx["is_elimination"] = 0
                    feat_ctx["is_surplus"] = 1
                    feat_ctx["count"] = int(feat_ctx.get("count", 0)) + 1
                    # provide current tallies for runtime magnitude features
                    feat_ctx["tallies"] = tallies.copy()
                    # Get survivor probs and NT share directly from the model if available
                    # ensure NT slot for this count
                    _ = feat_ctx.setdefault("_nt_series", [])
                    if len(feat_ctx["_nt_series"]) < len(counts) + 1:
                        feat_ctx["_nt_series"].append(0.0)

                    # joint survivor + NT prediction (cand is the donor of surplus)
                    surv_idx = np.nonzero(survivors)[0]
                    try:
                        probs, p_nt = model.expect_proba_with_nt(
                            cand, surv_idx, feat_ctx
                        )
                    except Exception:
                        # Fallback: old path
                        probs = _predict_transfers_on_demand(
                            cand, survivors, model, feat_ctx
                        )
                        try:
                            if bool(feat_ctx.get("ignore_priors")):
                                p_nt = 0.0
                            else:
                                p_nt = float(model.exhaust_rate(cand, feat_ctx))
                            p_nt = max(0.0, min(0.95, p_nt))
                        except Exception:
                            p_nt = 0.02
                        s = float(probs.sum())
                        if s > 0:
                            probs *= (1.0 - p_nt) / s
                        else:
                            k = float(survivors.sum())
                            probs[:] = (1.0 - p_nt) / max(1.0, k)

                    final_surv_probs = np.asarray(probs, dtype=float)
                    _record_debug(
                        feat_ctx,
                        model,
                        cand,
                        surv_idx,
                        final_surv_probs,
                        p_nt,
                        names=names,
                        parties=parties,
                    )

                    probs_full = np.zeros(C, dtype=float)
                    probs_full[surv_idx] = probs
                    probs = probs_full

                    # provenance update for surplus (unchanged)
                    if isinstance(prov, np.ndarray) and prov.shape[0] == C:
                        v = prov[cand, :].astype(float)
                        vs = float(v.sum()) or 1.0
                        for j in range(C):
                            if survivors[j] and probs[j] > 0.0:
                                prov[j, :] += (surplus * float(probs[j])) * (v / vs)
                        if tallies[cand] > 0:
                            scale = float(quota) / float(tallies[cand])
                            prov[cand, :] *= scale

                    tallies[cand] = quota
                    tallies += surplus * probs
                    nt_inc = float(surplus * p_nt)
                    feat_ctx["_nt_series"][-1] += nt_inc
                    _enforce_mass_conservation(tallies, total_before, nt_inc)
                    
                    # ensure a slot for this count if needed
                    if len(feat_ctx["_nt_series"]) < len(counts) + 1:
                        feat_ctx["_nt_series"].append(0.0)
                    counts.append(
                        (
                            f"surplus of {_display_name(names[cand])} ({_display_party(parties[cand])})",
                            tallies.copy(),
                        )
                    )
                    
                    surplus_processed = True
            
            if not made_progress:
                break
        
        # Check if election is complete after surplus phase
        if elected.sum() >= seats:
            break
            
        # ===== PHASE 2: Check Rule 44J (early election) =====
        # Safety check: if seats already filled, stop immediately
        if elected.sum() >= seats:
            break
            
        continuing = _continuing()
        seats_remaining = seats - elected.sum()
        
        # Rule 44J(1): If continuing candidates == vacancies remaining
        if len(continuing) == seats_remaining:
            for cand in continuing:
                elected[cand] = True
                alive[cand] = False
            break
        
        # Rule 44J(2): If one vacancy and leader cannot be overtaken
        if seats_remaining == 1 and len(continuing) > 1:
            continuing_tallies = tallies[continuing]
            leader_idx = continuing_tallies.argmax()
            leader_votes = continuing_tallies[leader_idx]
            
            # Sum of all other candidates plus any untransferred surplus
            other_votes_total = continuing_tallies.sum() - leader_votes
            untransferred = float(feat_ctx.get("_pending_surplus", 0.0) or 0.0)
            
            if leader_votes >= other_votes_total + untransferred:
                # Elect the leader immediately
                leader_cand = continuing[leader_idx]
                elected[leader_cand] = True
                alive[leader_cand] = False
                break
        
        # Safety check after Rule 44J
        if elected.sum() >= seats:
            break

        # ===== PHASE 3: Elimination (only if no surpluses and Rule 44J doesn't apply) =====
        # Note: We only reach here if surplus phase and Rule 44J checks completed without filling all seats
        
        # CRITICAL: Check if seats already filled BEFORE any eliminations
        if elected.sum() >= seats:
            break
            
        # Get continuing candidates (alive but not elected)
        continuing = np.where((alive) & (~elected))[0]
        
        if continuing.size > 0:
            # Define order in the outer scope so it's available for all branches
            order = continuing[np.argsort(tallies[continuing])]
            
            # Simple sequential elimination (one-by-one) if requested
            if sequential_elimination:
                elim_group = [int(order[0])]
            else:
                # Rule 44H: Batch elimination when possible
                elim_group: List[int] = []
                if order.size > 1:
                    tall_sorted = tallies[order]
                    untransferred = float(feat_ctx.get("_pending_surplus", 0.0) or 0.0)
                    for k in range(2, len(order) + 1):
                        prefix = float(tall_sorted[:k].sum()) + untransferred
                        next_val = float(tall_sorted[k]) if k < len(order) else float("inf")
                        if prefix + 1e-9 < next_val:
                            elim_group = order[:k].tolist()
                        else:
                            break
                if not elim_group:
                    elim_group = [int(order[0])]
            
            # Limit eliminations to ensure we don't eliminate too many
            seats_remaining = seats - elected.sum()
            continuing_remaining = len(continuing) - len(elim_group)
            if continuing_remaining < seats_remaining:
                # Need to preserve enough candidates to fill remaining seats
                preserve = max(0, seats_remaining - 1)  # Keep at least seats_remaining candidates
                if len(elim_group) > len(continuing) - preserve:
                    if preserve > 0:
                        elim_group = elim_group[:len(continuing) - preserve]
                    else:
                        # Edge case: only eliminate the bottom candidate
                        elim_group = [int(order[0])]
            
            # CRITICAL: Check if election is complete BEFORE performing eliminations
            if elected.sum() >= seats:
                break
                
            # CRITICAL: Explicitly exclude BOTH eliminated AND elected candidates
            # Elected candidates should NEVER receive transfers, even if they
            # were accidentally left in the alive pool
            survivors = alive.copy() & ~elected  # Active AND not elected
            for idx in elim_group:
                survivors[idx] = False

            _ = feat_ctx.setdefault("_nt_series", [])
            if len(feat_ctx["_nt_series"]) < len(counts) + 1:
                feat_ctx["_nt_series"].append(0.0)
            nt_slot = len(feat_ctx["_nt_series"]) - 1

            feat_ctx["is_elimination"] = 1
            feat_ctx["is_surplus"] = 0
            feat_ctx["count"] = int(feat_ctx.get("count", 0)) + 1

            current_tallies = tallies.copy()
            group_labels: List[str] = []

            for elim in elim_group:
                total_before = float(current_tallies.sum())
                feat_ctx["alive"] = survivors.copy()
                feat_ctx["tallies"] = current_tallies.copy()
                surv_idx = np.nonzero(survivors)[0]
                try:
                    probs, p_nt = model.expect_proba_with_nt(elim, surv_idx, feat_ctx)
                except Exception:
                    probs = _predict_transfers_on_demand(
                        elim, survivors, model, feat_ctx
                    )
                    try:
                        if bool(feat_ctx.get("ignore_priors")):
                            p_nt = 0.0
                        else:
                            p_nt = float(model.exhaust_rate(elim, feat_ctx))
                        p_nt = max(0.0, min(0.95, p_nt))
                    except Exception:
                        p_nt = 0.02
                    s = float(probs.sum())
                    if s > 0:
                        probs *= (1.0 - p_nt) / s
                    else:
                        k = float(survivors.sum())
                        probs[:] = (1.0 - p_nt) / max(1.0, k)

                final_surv_probs = np.asarray(probs, dtype=float)
                _record_debug(
                    feat_ctx,
                    model,
                    elim,
                    surv_idx,
                    final_surv_probs,
                    p_nt,
                    names=names,
                    parties=parties,
                )

                probs_full = np.zeros(C, dtype=float)
                probs_full[surv_idx] = probs
                probs = probs_full

                transfer_mass = current_tallies[elim]
                current_tallies[elim] = 0.0
                current_tallies += transfer_mass * probs
                nt_inc = float(transfer_mass * p_nt)
                feat_ctx["_nt_series"][nt_slot] += nt_inc
                _enforce_mass_conservation(current_tallies, total_before, nt_inc)

                if isinstance(prov, np.ndarray) and prov.shape[0] == C:
                    v = prov[elim, :].astype(float)
                    vs = float(v.sum()) or 1.0
                    for j in range(C):
                        if survivors[j] and probs[j] > 0.0:
                            prov[j, :] += (transfer_mass * float(probs[j])) * (v / vs)
                    prov[elim, :] = 0.0

                group_labels.append(
                    f"{_display_name(names[elim])} ({_display_party(parties[elim])})"
                )

            tallies = current_tallies
            for elim in elim_group:
                alive[elim] = False

            # CRITICAL: Check if election is complete AFTER eliminations (but before recording)
            if elected.sum() >= seats:
                break

            label = "elimination of " + ", ".join(group_labels)
            if len(elim_group) > 1:
                label += " (Rule 44H)"
            counts.append((label, tallies.copy()))

    # CRITICAL FIX: Ensure final elected state is captured
    # The simulation may exit without recording the final state where all
    # elected candidates are at/above quota. This is essential for correct
    # elected_mask generation in _format_output().
    
    # Capture final state if election completed
    if elected.sum() >= seats:
        # Ensure elected candidates are at exactly quota (not above)
        # This is the standard STV practice - fix elected candidates at quota
        for i in range(C):
            if elected[i] and tallies[i] > quota:
                # Transfer excess above quota to non-transferable
                excess = tallies[i] - quota
                tallies[i] = quota
                # Add to NT (non-transferable) - simplified here
                # In full STV, this would be distributed, but for our
                # purposes we just need the final elected state
        
        # Add final state to ensure elected_mask generation works
        final_label = "election complete - candidates at or above quota"
        counts.append((final_label, tallies.copy()))
    
    return counts


# ----------------------- Public entrypoint -----------------------


def run_scenario(er_df, tr_df, scenario_dict: Dict[str, Any]) -> Dict[str, Any]:
    names: List[str] = list(scenario_dict.get("names", []))
    parties: List[str] = list(scenario_dict.get("parties", []))
    ids: List[str] = [
        str(x) if x is not None else ""
        for x in scenario_dict.get("person_ids", [""] * len(names))
    ]
    first = np.asarray(scenario_dict.get("first_prefs", [0] * len(names)), dtype=float)
    seats = int(scenario_dict.get("seats") or 1)

    valid = float(first.sum())
    if valid <= 0:
        return {
            "columns": [],
            "rows": [],
            "summary": {"Error": "All first-preference totals are zero."},
            "quota": None,
            "valid": 0,
            "elected_mask": []  # Add empty elected mask for consistency
        }

    quota = valid / 2.0 + 1.0 if seats == 1 else np.floor(valid / (seats + 1)) + 1.0

    # Use pre-built model if available (from cross-validation)
    if isinstance(scenario_dict, dict) and "_prebuilt_model" in scenario_dict:
        model = scenario_dict["_prebuilt_model"]
    else:
        model = get_transfer_model(
            er_df, tr_df, scenario_dict=scenario_dict, refit_if_changed=True
        )
    feat_ctx = build_feature_context(er_df, tr_df, scenario_dict)

    # initialise provenance matrix if model exposes party space
    pspace = getattr(model, "pspace", None)
    if pspace and hasattr(pspace, "top") and len(pspace.top) > 0:
        Pk = len(pspace.top) + 1
        prov = np.zeros((len(names), Pk), dtype=float)
        # use cleaned parties from feat_ctx for mapping
        part_for_model = list(feat_ctx.get("party", []))
        idx_map = {p: i for i, p in enumerate(pspace.top)}
        for i in range(len(names)):
            amt = float(first[i]) if i < first.size else 0.0
            p = part_for_model[i] if i < len(part_for_model) else ""
            j = idx_map.get(p, -1)
            if j >= 0:
                prov[i, j] = amt
            else:
                prov[i, -1] = amt
        feat_ctx["prov"] = prov
    else:
        feat_ctx["prov"] = None

    feat_ctx["initial_first"] = first.copy()
    seq_elim = bool(scenario_dict.get("sequential_elimination", False))
    if seats == 1:
        counts = _run_irv_fast(
            first,
            quota,
            names,
            ids,
            parties,
            model,
            feat_ctx,
            sequential_elimination=seq_elim,
        )
    else:
        # DEBUG: Add safeguard for multi-seat elections
        print(f"DEBUG: Running multi-seat STV for {scenario_dict.get('constituency', 'Unknown')} with {seats} seats, {len(names)} candidates")
        counts = _run_stv_multi(
            first,
            seats,
            quota,
            names,
            ids,
            parties,
            model,
            feat_ctx,
            sequential_elimination=seq_elim,
        )

    result = _format_output(
        counts=counts,
        names=names,
        parties=parties,
        first_prefs=first,
        seats=seats,
        quota=quota,
        meta={
            "constituency": scenario_dict.get("constituency"),
            "electorate": scenario_dict.get("electorate"),
            "turnout": scenario_dict.get("turnout"),
            "spoiled": scenario_dict.get("spoiled"),
            "_nt_series": feat_ctx.get("_nt_series", []),
            "debug_series": feat_ctx.get("_debug_series", []),
        },
    )
    
    # Add uncertainty analysis if the model supports it
    try:
        # Check if we have access to Monte Carlo uncertainty analysis
        from ..features.transfers.dirichlet import MonteCarloSimulator
        
        # Run Monte Carlo simulation for uncertainty analysis
        mc_simulator = MonteCarloSimulator(model, n_simulations=100)
        uncertainty_result = mc_simulator.simulate_election(
            first_prefs=first,
            seats=seats,
            quota=quota,
            names=names,
            parties=parties,
            scenario_dict=scenario_dict
        )
        
        if uncertainty_result:
            result["uncertainty_analysis"] = uncertainty_result
    except Exception:
        # If uncertainty analysis fails, continue without it
        pass

    if not result.get("counts_meta"):
        fallback = _reconstruct_counts_from_transfers(
            tr_df,
            scenario_dict or {},
            names,
            parties,
            first,
        )
        if fallback is not None:
            fb_counts, fb_nt = fallback
            result = _format_output(
                counts=fb_counts,
                names=names,
                parties=parties,
                first_prefs=first,
                seats=seats,
                quota=quota,
                meta={
                    "constituency": scenario_dict.get("constituency"),
                    "electorate": scenario_dict.get("electorate"),
                    "turnout": scenario_dict.get("turnout"),
                    "spoiled": scenario_dict.get("spoiled"),
                    "_nt_series": fb_nt,
                    "debug_series": feat_ctx.get("_debug_series", []),
                    "_counts_source": "historic_transfers",
                },
            )
            result["counts_source"] = "historic_transfers"

    try:
        viewer_payload = _build_viewer_payload(
            result,
            scenario_dict,
            names,
            parties,
            ids,
            first,
            seats,
        )
    except Exception:
        viewer_payload = None
    if isinstance(viewer_payload, dict):
        result["viewer_payload"] = viewer_payload

    return result


_NAME_LOOKUP_COLS: Tuple[str, ...] = (
    "Name usually known by",
    "Name",
    "Candidate",
    "CandidateName",
    "Candidate Name",
)


def _casefold(s: Optional[str]) -> str:
    return str(s or "").strip().casefold()


def _reconstruct_counts_from_transfers(
    tr_df: Any,
    scenario: Dict[str, Any],
    names: List[str],
    parties: List[str],
    first_prefs: np.ndarray,
) -> Optional[Tuple[List[Tuple[str, np.ndarray]], List[float]]]:
    """Attempt to rebuild per-count totals directly from the Transfers sheet."""

    if pd is None or not isinstance(tr_df, pd.DataFrame) or tr_df.empty:
        return None

    df = tr_df.copy()
    if "Count" not in df.columns or "Transfers" not in df.columns:
        return None

    try:
        df["Count"] = pd.to_numeric(df["Count"], errors="coerce").astype("Int64")
        df = df[df["Count"].notna()]
        df["Transfers"] = pd.to_numeric(df["Transfers"], errors="coerce").fillna(0.0)
    except Exception:
        return None

    if df.empty:
        return None

    date = scenario.get("date") or scenario.get("DateStr")
    cons = scenario.get("constituency")
    body = scenario.get("elected_body") or scenario.get("ElectedBody")

    def _match_column(col: str, value: Optional[str]) -> None:
        nonlocal df
        if value and col in df.columns:
            try:
                key = _casefold(value)
                if key:
                    df = df[df[col].astype(str).str.strip().str.casefold() == key]
            except Exception:
                pass

    if date and "DateStr" in df.columns:
        try:
            ds = str(date).strip()
            if ds:
                df = df[df["DateStr"].astype(str).str.startswith(ds)]
        except Exception:
            pass
    _match_column("Constituency", cons)
    _match_column("ElectedBody", body)

    if df.empty:
        return None

    counts_values = df["Count"].dropna().unique()
    if len(counts_values) == 0:
        return None

    pid_map: Dict[int, int] = {}
    for idx, pid in enumerate(scenario.get("person_ids", [])):
        try:
            pid_map[int(pid)] = idx
        except Exception:
            continue

    name_map: Dict[str, int] = {}
    for idx, name in enumerate(names):
        key = _display_name(name).casefold()
        if key:
            name_map[key] = idx

    party_map: Dict[Tuple[str, str], int] = {}
    for idx, (name, party) in enumerate(zip(names, parties)):
        party_map[
            (
                _display_name(name).casefold(),
                _display_party(party).casefold(),
            )
        ] = idx

    def _find_index(row: pd.Series) -> Optional[int]:
        pid = row.get("PersonID")
        if pd.notna(pid):
            try:
                idx = pid_map.get(int(pid))
                if idx is not None:
                    return idx
            except Exception:
                pass
        # Try names
        for col in _NAME_LOOKUP_COLS:
            if col in row and pd.notna(row[col]):
                key = _display_name(str(row[col])).casefold()
                if key in name_map:
                    return name_map[key]
        # Try name + party pairing
        party_val = _display_party(row.get("Party Name") or row.get("Party"))
        for col in _NAME_LOOKUP_COLS:
            if col in row and pd.notna(row[col]):
                key = (
                    _display_name(str(row[col])).casefold(),
                    party_val.casefold(),
                )
                if key in party_map:
                    return party_map[key]
        return None

    tallies = first_prefs.astype(float).copy()
    counts: List[Tuple[str, np.ndarray]] = []
    nt_series: List[float] = []

    for cnt in sorted(int(c) for c in counts_values if pd.notna(c)):
        block = df[df["Count"] == cnt]
        if block.empty:
            continue
        delta = np.zeros_like(tallies)
        donors: List[int] = []
        recipients: List[int] = []
        pos_sum = 0.0
        neg_sum = 0.0
        nt_delta = 0.0

        for _, row in block.iterrows():
            value = float(row.get("Transfers", 0.0) or 0.0)
            idx = _find_index(row)
            if idx is None:
                label = " ".join(
                    [
                        str(row.get(col, ""))
                        for col in ("ResultType", "Party", "Party Name", "Name")
                    ]
                ).casefold()
                if "non" in label and "transfer" in label and value > 0:
                    nt_delta += value
                    continue
                if value > 0:
                    pos_sum += value
                elif value < 0:
                    neg_sum += -value
                continue

            delta[idx] += value
            if value < 0:
                donors.append(idx)
                neg_sum += -value
            elif value > 0:
                recipients.append(idx)
                pos_sum += value

        if nt_delta <= 0.0 and neg_sum > pos_sum:
            nt_delta += max(0.0, neg_sum - pos_sum)

        tallies = tallies + delta
        donors_sorted = sorted(set(donors))
        recipients_sorted = sorted(set(recipients))
        if donors_sorted:
            donor_txt = ", ".join(
                f"{_display_name(names[i])} ({_display_party(parties[i])})"
                for i in donors_sorted
            )
            label = (
                "historic elimination of " + donor_txt
                if len(donors_sorted) > 1
                else "historic transfer of " + donor_txt
            )
        elif recipients_sorted:
            recip_txt = ", ".join(
                f"{_display_name(names[i])} ({_display_party(parties[i])})"
                for i in recipients_sorted
            )
            label = "historic surplus to " + recip_txt
        else:
            label = f"historic count {cnt}"

        counts.append((label, tallies.copy()))
        nt_series.append(nt_delta)

    if not counts:
        return None

    return counts, nt_series
