"""Utilities for generating an adjusted Transfers worksheet.

This module converts combination transfer rows (where several donor
 candidates are bundled together) into a set of notional single-donor
 rows. The resulting table can be written to a dedicated workbook that
 leaves the original data untouched.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import math

import pandas as pd

__all__ = ["build_adjusted_transfers", "write_adjusted_transfers"]


NON_TRANSFERABLE_KEY = "__NON_TRANSFERABLE__"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _as_float(value: Any) -> float:
    """Best-effort conversion to ``float`` (NaN-safe)."""

    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        try:
            if isinstance(value, float) and math.isnan(value):
                return 0.0
        except Exception:  # pragma: no cover - platform specific
            pass
        return float(value)
    try:
        s = str(value).strip()
        if not s:
            return 0.0
        s = s.replace(",", "")
        return float(s)
    except Exception:
        return 0.0


def _split(value: Any) -> List[str]:
    """Split a comma-delimited cell into cleaned parts."""

    if value is None:
        return []
    try:
        if isinstance(value, float) and math.isnan(value):  # type: ignore[attr-defined]
            return []
    except Exception:  # pragma: no cover - platform specific
        pass
    return [p.strip() for p in str(value).split(",") if p.strip()]


def _normalise_pid(value: Any) -> Optional[str]:
    """Return a 5-digit zero-padded string identifier (or ``None``)."""

    if value is None:
        return None
    try:
        if isinstance(value, float) and math.isnan(value):  # type: ignore[attr-defined]
            return None
    except Exception:  # pragma: no cover - platform specific
        pass

    token = str(value).strip()
    if not token:
        return None

    try:
        pid = int(float(token))
    except Exception:
        digits = "".join(ch for ch in token if ch.isdigit())
        if not digits:
            return None
        pid = int(digits)

    pid = max(pid, 0)
    return f"{pid:05d}"


def _clean_party(value: Any) -> str:
    if value is None:
        return ""
    try:
        if isinstance(value, float) and math.isnan(value):  # type: ignore[attr-defined]
            return ""
    except Exception:  # pragma: no cover - platform specific
        pass
    return str(value).strip()


def _dest_key(person_id: Optional[str]) -> str:
    """Return the lookup key for a recipient (including NonTransferable)."""

    return person_id or NON_TRANSFERABLE_KEY


def _party_dest_key(party: str) -> str:
    """Normalise destination parties (treat blanks as non-transferable)."""

    return party or NON_TRANSFERABLE_KEY


@dataclass
class _DonorShare:
    donor_id: str
    name: str
    party: str
    votes_at_elimination: float
    share_hint: float
    notional: float


# ---------------------------------------------------------------------------
# Share estimation
# ---------------------------------------------------------------------------


def _estimate_share(
    *,
    donor_pid: str,
    donor_party: str,
    dest_key: str,
    dest_party: str,
    donor_totals: Dict[str, float],
    donor_to_dest: Dict[Tuple[str, str], float],
    donor_to_party: Dict[Tuple[str, str], float],
    party_totals: Dict[str, float],
    party_to_party: Dict[Tuple[str, str], float],
    global_total: float,
    global_to_dest: Dict[str, float],
) -> float:
    """Estimate the fraction of the donor's outflow that reaches ``dest_key``.

    The calculation blends donor-level observations with party-level priors and
    an overall baseline so that combinations inherit historically observed
    behaviour while still falling back to data-driven smoothing when no direct
    evidence exists.
    """

    donor_total = donor_totals.get(donor_pid, 0.0)
    dest_votes = donor_to_dest.get((donor_pid, dest_key), 0.0)
    donor_party_votes = donor_to_party.get((donor_pid, dest_party), 0.0) if dest_party else 0.0

    numerator = 0.0
    denom = 0.0

    if donor_total > 0:
        numerator += dest_votes
        denom += donor_total

    donor_party_weight = 3.0
    if donor_total > 0 and dest_party:
        donor_party_prob = donor_party_votes / donor_total if donor_total > 0 else 0.0
        numerator += donor_party_weight * donor_party_prob
        denom += donor_party_weight

    dest_party_key = _party_dest_key(dest_party)

    party_weight = 5.0
    if donor_party:
        party_total = party_totals.get(donor_party, 0.0)
        if party_total > 0:
            party_pair_votes = party_to_party.get((donor_party, dest_party_key), 0.0)
            party_prob = party_pair_votes / party_total if party_total > 0 else 0.0
            numerator += party_weight * party_prob
            denom += party_weight

    global_weight = 1.0
    if global_total > 0:
        global_prob = global_to_dest.get(dest_key, 0.0) / global_total
        numerator += global_weight * global_prob
        denom += global_weight

    if denom <= 0:
        return 0.0

    share = numerator / denom
    if share < 0:
        return 0.0
    if share > 1:
        return 1.0
    return share


# ---------------------------------------------------------------------------
# Core transformer
# ---------------------------------------------------------------------------


def build_adjusted_transfers(transfers: pd.DataFrame) -> pd.DataFrame:
    """Return a new ``DataFrame`` with combination rows decomposed.

    Parameters
    ----------
    transfers:
        Raw Transfers worksheet loaded as a DataFrame.
    """

    if transfers is None or transfers.empty:
        return pd.DataFrame(columns=list(transfers.columns) if transfers is not None else [])

    df = transfers.copy()

    base_columns = list(df.columns)
    donor_pct_col = "DonorTransferPct"
    if donor_pct_col not in base_columns:
        base_columns.append(donor_pct_col)

    source_col = "SourcePersonID"
    if source_col not in base_columns:
        base_columns.append(source_col)

    donor_total_col = "DonorTransferTotal"
    if donor_total_col not in base_columns:
        base_columns.append(donor_total_col)

    group_cols = [c for c in ("Date", "Event", "Constituency", "ElectedBody", "Count") if c in df.columns]
    donor_group_info: Dict[Tuple[Any, ...], Dict[str, Dict[str, Any]]] = defaultdict(dict)
    group_templates: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
    overall_donor_votes: Dict[str, float] = {}
    donor_party_map: Dict[str, str] = {}
    donor_negative_lookup: Dict[Tuple[Tuple[Any, ...], str], float] = {}
    combo_total_lookup: Dict[Tuple[Tuple[Any, ...], str], float] = {}
    nt_votes_lookup: Dict[Tuple[Any, ...], float] = {}

    # Aggregates derived from single-donor rows
    donor_totals: Dict[str, float] = defaultdict(float)
    donor_to_dest: Dict[Tuple[str, str], float] = defaultdict(float)
    donor_to_party: Dict[Tuple[str, str], float] = defaultdict(float)
    party_totals: Dict[str, float] = defaultdict(float)
    party_to_party: Dict[Tuple[str, str], float] = defaultdict(float)
    global_total: float = 0.0
    global_to_dest: Dict[str, float] = defaultdict(float)

    # Pass 1: gather donor metadata and historic single-donor flows
    def _donor_total_for(
        group_key: Tuple[Any, ...],
        donor_pid: Optional[str],
        *,
        fallback_row: Optional[Dict[str, Any]] = None,
    ) -> Optional[float]:
        """Return the best available total transfer amount for a donor in a group."""

        if not donor_pid:
            return None

        denom = donor_negative_lookup.get((group_key, donor_pid))
        if denom and denom > 0:
            return float(denom)

        donor_info = donor_group_info.get(group_key, {}).get(donor_pid, {})
        votes_val = _as_float(donor_info.get("votes"))
        if votes_val > 0:
            return votes_val

        overall = overall_donor_votes.get(donor_pid)
        if overall and overall > 0:
            return float(overall)

        if fallback_row is not None:
            votes_hint = _as_float(fallback_row.get("Votes"))
            if votes_hint > 0:
                return votes_hint

        return None

    for _, row in df.iterrows():
        transfers_val = _as_float(row.get("Transfers"))
        group_key = tuple(row.get(c) for c in group_cols) if group_cols else tuple()

        person_pid = _normalise_pid(row.get("PersonID"))
        party_val = _clean_party(row.get("Party"))

        if transfers_val < 0 and person_pid:
            info = donor_group_info[group_key].setdefault(person_pid, {})
            votes_val = _as_float(row.get("Votes"))
            if votes_val <= 0:
                votes_val = abs(transfers_val)
            info["votes"] = votes_val
            if votes_val > 0:
                prev_hint = nt_votes_lookup.get(group_key, 0.0)
                if votes_val > prev_hint:
                    nt_votes_lookup[group_key] = votes_val
            if row.get("Name"):
                info.setdefault("name", row.get("Name"))
            if party_val:
                info["party"] = party_val
                donor_party_map.setdefault(person_pid, party_val)
            overall_donor_votes[person_pid] = votes_val
            donor_negative_lookup[(group_key, person_pid)] = abs(transfers_val)

        subjects = [_normalise_pid(s) for s in _split(row.get("TransferSubject"))]
        names = _split(row.get("TransferName"))
        parties = [_clean_party(p) for p in _split(row.get("TransferParty"))]

        # Track donor-party hints from metadata (even for bundles)
        for idx, donor_pid in enumerate(subjects):
            if donor_pid:
                donor_party = parties[idx] if idx < len(parties) else ""
                donor_party = donor_party or donor_party_map.get(donor_pid, "")
                if donor_party:
                    donor_party_map.setdefault(donor_pid, donor_party)

                info = donor_group_info[group_key].setdefault(donor_pid, {})
                if idx < len(names) and names[idx]:
                    info.setdefault("name", names[idx])
                if donor_party:
                    info.setdefault("party", donor_party)
                if not info.get("votes"):
                    vote_hint = _as_float(row.get("Votes"))
                    if vote_hint > 0:
                        info["votes"] = vote_hint
                        overall_donor_votes.setdefault(donor_pid, vote_hint)
                        prev_hint = nt_votes_lookup.get(group_key, 0.0)
                        if vote_hint > prev_hint:
                            nt_votes_lookup[group_key] = vote_hint

        if transfers_val <= 0:
            continue

        if len(subjects) == 1 and subjects[0]:
            donor_pid = subjects[0]
            donor_totals[donor_pid] += transfers_val
            dest_pid = _normalise_pid(row.get("PersonID"))
            dest_key = _dest_key(dest_pid)
            donor_to_dest[(donor_pid, dest_key)] += transfers_val

            dest_party = _clean_party(row.get("Party"))
            dest_party_key = _party_dest_key(dest_party)
            if dest_party:
                donor_to_party[(donor_pid, dest_party)] += transfers_val

            donor_party = parties[0] if parties else donor_party_map.get(donor_pid, "")
            donor_party = donor_party or donor_party_map.get(donor_pid, "")
            if donor_party:
                donor_party_map.setdefault(donor_pid, donor_party)
                party_totals[donor_party] += transfers_val
                party_to_party[(donor_party, dest_party_key)] += transfers_val

            global_total += transfers_val
            global_to_dest[dest_key] += transfers_val

    # Pass 2: build adjusted rows
    out_rows: List[Dict[str, Any]] = []
    assigned_totals: Dict[Tuple[Tuple[Any, ...], str], float] = defaultdict(float)
    recipient_assigned: Dict[Tuple[Tuple[Any, ...], str], float] = defaultdict(float)
    pending_nt_rows: Dict[Tuple[Tuple[Any, ...], str], Dict[str, Any]] = {}
    pending_nt_meta: Dict[Tuple[Tuple[Any, ...], str], Dict[str, Any]] = {}

    def _ensure_template(base_row: Dict[str, Any], key: Tuple[Any, ...]) -> Dict[str, Any]:
        template = group_templates.get(key)
        if template is None:
            template = {col: base_row.get(col) for col in base_columns}
            # Reset recipient-specific fields so the template can be reused
            template["PersonID"] = None
            template["Name"] = ""
            template["Party"] = ""
            template["TransferSubject"] = ""
            template["TransferName"] = ""
            template["TransferParty"] = ""
            template["TransferPct"] = None
            template[donor_pct_col] = None
            template[donor_total_col] = None
            group_templates[key] = template
        return template

    for _, row in df.iterrows():
        base = row.to_dict()
        transfers_val = _as_float(base.get("Transfers"))
        subjects = [_normalise_pid(s) for s in _split(base.get("TransferSubject"))]
        names = _split(base.get("TransferName"))
        parties = [_clean_party(p) for p in _split(base.get("TransferParty"))]

        subjects = [s for s in subjects if s]

        if len(subjects) <= 1:
            group_key = tuple(base.get(c) for c in group_cols) if group_cols else tuple()
            donor_pid = subjects[0] if subjects else None
            if not donor_pid and transfers_val < 0:
                donor_pid = _normalise_pid(base.get("PersonID"))

            denom = _donor_total_for(group_key, donor_pid, fallback_row=base)
            if denom and denom > 0:
                denom_abs = abs(denom)
                base[donor_pct_col] = (abs(transfers_val) / denom_abs) * 100.0
                base[donor_total_col] = -denom_abs
            else:
                base[donor_pct_col] = None
                base[donor_total_col] = denom

            dest_pid = _normalise_pid(base.get("PersonID"))
            dest_key = _dest_key(dest_pid)

            if donor_pid:
                if not base.get("TransferSubject"):
                    base["TransferSubject"] = donor_pid
                    if not base.get("TransferName"):
                        base["TransferName"] = base.get("Name", "")
                    if not base.get("TransferParty"):
                        base["TransferParty"] = base.get("Party", "")
                base[source_col] = donor_pid
                combo_lookup_key = (group_key, donor_pid)
                if denom and denom > 0:
                    combo_total_lookup.setdefault(combo_lookup_key, abs(denom))
                if transfers_val > 0:
                    if dest_key == NON_TRANSFERABLE_KEY:
                        if base.get("ResultType") in (None, ""):
                            base["ResultType"] = "NonTransferable"
                        if "TransferPartyRelation" in base and not base.get("TransferPartyRelation"):
                            base["TransferPartyRelation"] = "NonTransferable"
                        nt_before = nt_votes_lookup.get(group_key)
                        if (nt_before is None or nt_before <= 0) and donor_pid:
                            nt_before = _donor_total_for(group_key, donor_pid, fallback_row=base)
                        if nt_before is None or nt_before <= 0:
                            nt_before = _as_float(base.get("Votes"))
                        if nt_before is None or nt_before <= 0:
                            nt_before = 0.0
                        if nt_before > 0:
                            prev_hint = nt_votes_lookup.get(group_key, 0.0)
                            if nt_before > prev_hint:
                                nt_votes_lookup[group_key] = nt_before
                        base["Votes"] = nt_before
                        if base.get("TransferPct") in (None, ""):
                            base["TransferPct"] = 100.0
                        pending_nt_rows[combo_lookup_key] = base
                        pending_nt_meta[combo_lookup_key] = {
                            "combo_denom": combo_total_lookup.get(combo_lookup_key)
                        }
                    else:
                        assigned_totals[combo_lookup_key] += transfers_val
                        recipient_assigned[combo_lookup_key] += transfers_val
            else:
                existing = _normalise_pid(base.get(source_col) or base.get("PersonID"))
                base[source_col] = existing
            out_rows.append(base)
            continue

        group_key = tuple(base.get(c) for c in group_cols) if group_cols else tuple()
        _ensure_template(base, group_key)
        dest_pid = _normalise_pid(base.get("PersonID"))
        dest_key = _dest_key(dest_pid)
        dest_party = _clean_party(base.get("Party"))

        nt_votes_before: Optional[float] = None
        if dest_key == NON_TRANSFERABLE_KEY:
            nt_votes_before = nt_votes_lookup.get(group_key)
            if nt_votes_before is None:
                nt_votes_before = _as_float(base.get("Votes"))
                nt_votes_lookup[group_key] = nt_votes_before

        donor_bundle: List[_DonorShare] = []
        combo_total = 0.0
        for donor_pid in subjects:
            denom = _donor_total_for(group_key, donor_pid, fallback_row=base)
            if denom and denom > 0:
                combo_total += abs(denom)

        for idx, donor_pid in enumerate(subjects):
            donor_info = donor_group_info.get(group_key, {}).get(donor_pid, {})
            donor_votes = donor_info.get("votes")
            if donor_votes is None:
                donor_votes = overall_donor_votes.get(donor_pid, 0.0)
            donor_votes = float(donor_votes or 0.0)

            donor_name = names[idx] if idx < len(names) else ""
            if not donor_name:
                donor_name = donor_info.get("name", "")
            donor_party = parties[idx] if idx < len(parties) else ""
            if not donor_party:
                donor_party = donor_info.get("party") or donor_party_map.get(donor_pid, "")

            share = _estimate_share(
                donor_pid=donor_pid,
                donor_party=donor_party,
                dest_key=dest_key,
                dest_party=dest_party,
                donor_totals=donor_totals,
                donor_to_dest=donor_to_dest,
                donor_to_party=donor_to_party,
                party_totals=party_totals,
                party_to_party=party_to_party,
                global_total=global_total,
                global_to_dest=global_to_dest,
            )

            notional = donor_votes * share if share > 0 and donor_votes > 0 else 0.0
            donor_bundle.append(
                _DonorShare(
                    donor_id=donor_pid,
                    name=donor_name,
                    party=donor_party,
                    votes_at_elimination=donor_votes,
                    share_hint=share,
                    notional=notional,
                )
            )

        total_notional = sum(max(d.notional, 0.0) for d in donor_bundle)
        if total_notional <= 0:
            vote_sum = sum(max(d.votes_at_elimination, 0.0) for d in donor_bundle)
            if vote_sum > 0:
                for d in donor_bundle:
                    d.notional = max(d.votes_at_elimination, 0.0)
                total_notional = vote_sum
        if total_notional <= 0:
            for d in donor_bundle:
                d.notional = 1.0
            total_notional = float(len(donor_bundle) or 1)

        actual_total = transfers_val
        scale = (actual_total / total_notional) if total_notional > 0 else 0.0

        transfer_pct = _as_float(base.get("TransferPct")) if base.get("TransferPct") not in (None, "") else None

        for donor in donor_bundle:
            amount = donor.notional * scale if scale > 0 else 0.0
            row_out = dict(base)
            row_out["TransferSubject"] = donor.donor_id
            row_out["TransferName"] = donor.name
            row_out["TransferParty"] = donor.party
            row_out["Transfers"] = amount
            row_out[source_col] = donor.donor_id

            if not row_out.get("TransferName"):
                fallback_name = donor_group_info.get(group_key, {}).get(donor.donor_id, {}).get("name", "")
                row_out["TransferName"] = fallback_name
            if not row_out.get("TransferParty"):
                fallback_party = donor_group_info.get(group_key, {}).get(donor.donor_id, {}).get("party", "")
                row_out["TransferParty"] = fallback_party or donor_party_map.get(donor.donor_id, "")

            denom = _donor_total_for(group_key, donor.donor_id, fallback_row=base)
            denom_abs = abs(denom) if denom and denom > 0 else None
            if denom_abs is not None and denom_abs > 0:
                row_out[donor_pct_col] = (abs(amount) / denom_abs) * 100.0
                row_out[donor_total_col] = -denom_abs
            else:
                row_out[donor_pct_col] = None
                row_out[donor_total_col] = denom

            combo_denom: Optional[float] = None
            if combo_total > 0:
                combo_total_lookup[(group_key, donor.donor_id)] = combo_total
                combo_denom = combo_total
            elif denom_abs is not None and denom_abs > 0:
                combo_total_lookup[(group_key, donor.donor_id)] = denom_abs
                combo_denom = denom_abs
            else:
                combo_denom = combo_total_lookup.get((group_key, donor.donor_id))

            if dest_key != NON_TRANSFERABLE_KEY and combo_denom and combo_denom > 0:
                row_out["TransferPct"] = (abs(amount) / combo_denom) * 100.0

            out_rows.append(row_out)

            key = (group_key, donor.donor_id)
            if dest_key == NON_TRANSFERABLE_KEY:
                votes_hint = nt_votes_lookup.get(group_key)
                if (votes_hint is None or votes_hint <= 0) and donor.donor_id:
                    votes_hint = _donor_total_for(group_key, donor.donor_id, fallback_row=row_out)
                if votes_hint is None or votes_hint <= 0:
                    votes_hint = _as_float(row_out.get("Votes"))
                if votes_hint is None or votes_hint <= 0:
                    votes_hint = 0.0
                if votes_hint > 0:
                    prev_hint = nt_votes_lookup.get(group_key, 0.0)
                    if votes_hint > prev_hint:
                        nt_votes_lookup[group_key] = votes_hint
                row_out["Votes"] = votes_hint
                pending_nt_rows[key] = row_out
                pending_nt_meta[key] = {"combo_denom": combo_denom}
            else:
                assigned_totals[key] += amount
                recipient_assigned[key] += amount

            if donor_negative_lookup.get((group_key, donor.donor_id)) is None:
                vote_hint = donor.votes_at_elimination
                if vote_hint <= 0:
                    vote_hint = overall_donor_votes.get(donor.donor_id, 0.0)
                if vote_hint <= 0:
                    vote_hint = _as_float(base.get("Votes"))

                if vote_hint > 0:
                    neg_row = dict(base)
                    neg_row["PersonID"] = int(donor.donor_id)
                    neg_row["Name"] = donor.name or donor_group_info.get(group_key, {}).get(donor.donor_id, {}).get("name", "")
                    neg_row["Party"] = donor.party or donor_party_map.get(donor.donor_id, "")
                    neg_row["Votes"] = vote_hint
                    neg_row["Transfers"] = -vote_hint
                    neg_row["TransferSubject"] = donor.donor_id
                    neg_row["TransferName"] = donor.name
                    neg_row["TransferParty"] = donor.party
                    neg_row["TransferPct"] = None
                    neg_row[donor_pct_col] = 100.0
                    neg_row[donor_total_col] = -abs(vote_hint)
                    neg_row[source_col] = donor.donor_id
                    out_rows.append(neg_row)
                    donor_negative_lookup[(group_key, donor.donor_id)] = vote_hint
                    overall_donor_votes[donor.donor_id] = vote_hint

            if dest_key == NON_TRANSFERABLE_KEY:
                nt_before = nt_votes_before if nt_votes_before is not None else _as_float(base.get("Votes"))
                row_out["Votes"] = nt_before
                nt_votes_lookup[group_key] = nt_before

            if dest_key != NON_TRANSFERABLE_KEY and row_out.get("TransferPct") is None and transfer_pct is not None:
                row_out["TransferPct"] = transfer_pct

    # Pass 3: ensure residual non-transferable allocations are recorded per donor
    nt_targets: Dict[Tuple[Tuple[Any, ...], str], float] = {}
    for (group_key, donor_pid), donor_total in donor_negative_lookup.items():
        if donor_total is None or donor_total <= 0:
            continue
        donor_total_abs = abs(donor_total)
        recipient_sum = recipient_assigned.get((group_key, donor_pid), 0.0)
        nt_amount = donor_total_abs - recipient_sum
        if nt_amount < 0:
            nt_amount = 0.0
        nt_targets[(group_key, donor_pid)] = nt_amount

    for key, row_out in pending_nt_rows.items():
        nt_amount = nt_targets.get(key, 0.0)
        row_out["Transfers"] = nt_amount
        combo_denom = pending_nt_meta.get(key, {}).get("combo_denom")
        if combo_denom and combo_denom > 0:
            row_out["TransferPct"] = (abs(nt_amount) / combo_denom) * 100.0
        votes_hint = nt_votes_lookup.get(key[0])
        if (votes_hint is None or votes_hint <= 0) and key[1]:
            votes_hint = _donor_total_for(key[0], key[1], fallback_row=row_out)
        if votes_hint is None or votes_hint <= 0:
            votes_hint = _as_float(row_out.get("Votes"))
        if votes_hint is None or votes_hint <= 0:
            votes_hint = 0.0
        row_out["Votes"] = votes_hint
        assigned_totals[key] += nt_amount

    tolerance = 1e-6
    for (group_key, donor_pid), donor_total in donor_negative_lookup.items():
        if donor_total is None or donor_total <= 0:
            continue
        donor_total_abs = abs(donor_total)
        assigned = assigned_totals.get((group_key, donor_pid), 0.0)
        residual = donor_total_abs - assigned
        if residual <= tolerance:
            continue

        template = group_templates.get(group_key)
        if template is None:
            template = {col: None for col in base_columns}
            for idx, col in enumerate(group_cols):
                if idx < len(group_key):
                    template[col] = group_key[idx]
        donor_info = donor_group_info.get(group_key, {}).get(donor_pid, {})
        donor_name = donor_info.get("name", "")
        donor_party = donor_info.get("party", donor_party_map.get(donor_pid, ""))

        nt_row = dict(template)
        nt_row["ResultType"] = template.get("ResultType") or "NonTransferable"
        if "TransferPartyRelation" in nt_row:
            nt_row["TransferPartyRelation"] = "NonTransferable"
        nt_row["PersonID"] = None
        nt_row["Name"] = ""
        nt_row["Party"] = ""
        nt_amount = nt_targets.get((group_key, donor_pid), residual)
        nt_row["Transfers"] = nt_amount
        votes_hint = nt_votes_lookup.get(group_key)
        if (votes_hint is None or votes_hint <= 0) and donor_pid:
            votes_hint = _donor_total_for(group_key, donor_pid, fallback_row=template)
        if votes_hint is None or votes_hint <= 0:
            votes_hint = _as_float(template.get("Votes"))
        if votes_hint is None or votes_hint <= 0:
            votes_hint = 0.0
        nt_row["Votes"] = votes_hint
        nt_row["TransferSubject"] = donor_pid
        nt_row["TransferName"] = donor_name
        nt_row["TransferParty"] = donor_party
        combo_denom = combo_total_lookup.get((group_key, donor_pid), donor_total_abs)
        if combo_denom and combo_denom > 0:
            nt_row["TransferPct"] = (abs(nt_amount) / combo_denom) * 100.0
        else:
            nt_row["TransferPct"] = None
        nt_row[source_col] = donor_pid
        nt_row[donor_pct_col] = (abs(nt_amount) / donor_total_abs) * 100.0 if donor_total_abs > 0 else None
        nt_row[donor_total_col] = -donor_total_abs
        assigned_totals[(group_key, donor_pid)] += nt_amount
        out_rows.append(nt_row)

    return pd.DataFrame(out_rows, columns=base_columns)


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------


def write_adjusted_transfers(adjusted: pd.DataFrame, path: Path | str) -> Path:
    """Write the adjusted transfers to a workbook and return the path."""

    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    if adjusted is None:
        adjusted = pd.DataFrame()

    try:
        with pd.ExcelWriter(dest, engine="xlsxwriter") as writer:  # type: ignore[call-arg]
            adjusted.to_excel(writer, sheet_name="AdjustedTransfers", index=False)
    except Exception:
        with pd.ExcelWriter(dest) as writer:  # pragma: no cover - fallback path
            adjusted.to_excel(writer, sheet_name="AdjustedTransfers", index=False)

    return dest

