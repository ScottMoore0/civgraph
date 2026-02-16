"""Utilities for constructing per-party referendum breakdowns."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import numpy as np

from ..features.endorsements import normalize_party_key
from ..utils import is_dnv_label, is_spoiled_label, normalize_option_label

_PARTY_WEIGHT_EPS = 1e-6
_ENDORSEMENT_BOOST = 3.0


def build_party_breakdown(
    *,
    baseline_shares: Mapping[str, float],
    counts: Mapping[str, float],
    output_labels: Sequence[str],
    probabilities: Optional[Mapping[str, float]] = None,
    endorsements: Optional[Mapping[str, str]] = None,
    canonical_endorsements: Optional[Mapping[str, str]] = None,
    electorate: Optional[float] = None,
    model_to_output: Optional[Mapping[str, str]] = None,
    model_options: Optional[Sequence[str]] = None,
    endorsement_profiles: Optional[Mapping[str, Sequence[float]]] = None,
    neutral_profile: Optional[Sequence[float]] = None,
    non_participant_share: Optional[float] = None,
    non_participant_label: str = "Non-voters (baseline)",
    baseline_turnout_share: Optional[float] = None,
    spoiled_share: Optional[float] = None,
    spoiled_label: str = "Spoiled ballots (baseline)",
) -> Dict[str, object]:
    """Allocate projected option counts to parties using baseline shares."""

    working_shares = dict(baseline_shares or {})
    non_participant_share = _safe_float(non_participant_share)
    if non_participant_share is not None and non_participant_share < 0:
        non_participant_share = None
    spoiled_share = _safe_float(spoiled_share)
    if spoiled_share is not None and spoiled_share < 0:
        spoiled_share = None
    turnout_share_value = _safe_float(baseline_turnout_share)
    if turnout_share_value is not None and turnout_share_value < 0:
        turnout_share_value = None
    baseline_np_share = None
    baseline_spoiled_share = None
    if non_participant_label and non_participant_label in working_shares:
        baseline_np_share = _safe_float(working_shares.pop(non_participant_label))
    if spoiled_label and spoiled_label in working_shares:
        baseline_spoiled_share = _safe_float(working_shares.pop(spoiled_label))
    if non_participant_share is None and baseline_np_share is not None:
        non_participant_share = baseline_np_share
    if spoiled_share is None and baseline_spoiled_share is not None:
        spoiled_share = baseline_spoiled_share

    if (
        non_participant_share is not None
        and np.isfinite(non_participant_share)
        and float(non_participant_share) > 0
    ):
        non_participant_share = float(non_participant_share)
    if (
        spoiled_share is not None
        and np.isfinite(spoiled_share)
        and float(spoiled_share) > 0
    ):
        spoiled_share = float(spoiled_share)

    entries = _prepare_entries(
        baseline_shares=working_shares,
        endorsements=endorsements,
        canonical_endorsements=canonical_endorsements,
        electorate=electorate,
        model_to_output=model_to_output,
    )
    if not entries:
        return {}

    option_labels = list(output_labels)
    option_probs = _normalise_option_probabilities(option_labels, probabilities)

    profile_map = _normalise_profile_lookup(endorsement_profiles, model_options)
    neutral_weights = _profile_to_output_distribution(
        neutral_profile, model_options, option_labels, model_to_output
    )
    output_to_model = _invert_mapping(model_to_output, model_options)

    for entry in entries:
        profile_weights = None
        profile_source = None

        if profile_map and entry.model_endorsement:
            key = normalize_option_label(entry.model_endorsement) or entry.model_endorsement
            profile_weights = _resolve_profile_weights(
                key,
                profile_map,
                model_options,
                option_labels,
                model_to_output,
            )
            if profile_weights:
                profile_source = "endorsement_profile"

        if not profile_weights and profile_map and entry.endorsement:
            candidates = output_to_model.get(entry.endorsement, ())
            for candidate in candidates:
                key = normalize_option_label(candidate) or candidate
                profile_weights = _resolve_profile_weights(
                    key,
                    profile_map,
                    model_options,
                    option_labels,
                    model_to_output,
                )
                if profile_weights:
                    profile_source = "endorsement_profile"
                    break

        if not profile_weights and neutral_weights:
            profile_weights = dict(neutral_weights)
            profile_source = "neutral_profile"

        if profile_weights:
            total = sum(max(0.0, float(val)) for val in profile_weights.values())
            if total > 0:
                entry.weights = {
                    label: max(0.0, float(profile_weights.get(label, 0.0))) / total
                    for label in option_labels
                }
                entry.profile_source = profile_source
                continue

        weights = {}
        for label in option_labels:
            weight = option_probs.get(label, 0.0) + _PARTY_WEIGHT_EPS
            if entry.endorsement and _label_matches(entry.endorsement, label):
                weight *= _ENDORSEMENT_BOOST
            weights[label] = weight
        total_weight = sum(weights.values())
        if total_weight <= 0:
            weights = {label: 1.0 for label in option_labels}
            total_weight = float(len(option_labels))
        entry.weights = {label: weight / total_weight for label, weight in weights.items()}
        entry.profile_source = "fallback"

    breakdown_counts: Dict[str, Dict[str, float]] = {}
    for label in option_labels:
        column_total = _safe_float(counts.get(label))
        if column_total is None or column_total <= 0:
            for entry in entries:
                entry.counts[label] = 0.0
            continue

        weighted_shares = []
        weight_sum = 0.0
        for entry in entries:
            w = entry.weights.get(label, 0.0) * entry.baseline_share
            weighted_shares.append(w)
            weight_sum += w

        if weight_sum <= 0:
            weighted_shares = [entry.baseline_share for entry in entries]
            weight_sum = sum(weighted_shares)

        if weight_sum <= 0:
            # Fallback: distribute uniformly
            weighted_shares = [1.0 for _ in entries]
            weight_sum = float(len(entries))

        for entry, weighted in zip(entries, weighted_shares):
            entry.counts[label] = column_total * (weighted / weight_sum if weight_sum > 0 else 0.0)

        breakdown_counts[label] = {
            entry.party_key: entry.counts[label] for entry in entries
        }

    metadata_extras: Dict[str, object] = {}
    if non_participant_share is not None and np.isfinite(non_participant_share):
        metadata_extras["non_participant_share"] = float(non_participant_share)
        metadata_extras["non_participant_label"] = non_participant_label
    if turnout_share_value is not None and np.isfinite(turnout_share_value):
        metadata_extras["baseline_turnout_share"] = float(turnout_share_value)
    if spoiled_share is not None and np.isfinite(spoiled_share):
        metadata_extras["spoiled_share"] = float(spoiled_share)
        metadata_extras["spoiled_label"] = spoiled_label

    pseudo_specs: List[Mapping[str, object]] = []
    if non_participant_share is not None and non_participant_share > 0:
        pseudo_specs.append(
            {
                "name": "Election non-voters",
                "share": non_participant_share,
                "legend": non_participant_label,
                "kind": "non_voters",
            }
        )
    if spoiled_share is not None and spoiled_share > 0:
        pseudo_specs.append(
            {
                "name": "Election spoiled",
                "share": spoiled_share,
                "legend": spoiled_label,
                "kind": "spoiled",
            }
        )

    extras_payload = metadata_extras or None
    return _finalise(
        entries,
        option_labels,
        electorate,
        extras_payload,
        tuple(pseudo_specs) if pseudo_specs else None,
        turnout_share_value,
    )


def merge_party_breakdowns(
    breakdowns: Iterable[Mapping[str, object]],
    *,
    output_labels: Optional[Sequence[str]] = None,
    electorate: Optional[float] = None,
) -> Dict[str, object]:
    """Combine multiple per-party breakdowns into a single aggregate view."""

    breakdown_list = list(breakdowns)
    materialised: List[_PartyEntry] = []
    total_electorate = 0.0
    event_types: List[str] = []
    event_type_seen: Set[str] = set()
    elected_bodies: List[str] = []
    elected_body_seen: Set[str] = set()
    families: List[str] = []
    families_seen: Set[str] = set()
    elections: List[Dict[str, object]] = []
    election_seen: Set[Tuple[Tuple[str, str], ...]] = set()
    basis_total = 0.0
    basis_seen = False
    non_participant_weight = 0.0
    non_participant_value = 0.0
    non_participant_label: Optional[str] = None
    turnout_weight = 0.0
    spoiled_weight = 0.0
    spoiled_value = 0.0
    spoiled_label: Optional[str] = None
    turnout_value = 0.0

    for bd in breakdown_list:
        if not isinstance(bd, Mapping):
            continue
        parties = bd.get("parties")  # type: ignore[index]
        if not parties:
            continue
        meta = bd.get("metadata", {})  # type: ignore[assignment]
        meta_electorate = _safe_float(meta.get("electorate")) if isinstance(meta, Mapping) else None
        if meta_electorate is not None:
            total_electorate += meta_electorate
        if isinstance(meta, Mapping):
            event_type = meta.get("event_type")
            if isinstance(event_type, str):
                clean = event_type.strip()
                if clean:
                    key = clean.casefold()
                    if key not in event_type_seen:
                        event_type_seen.add(key)
                        event_types.append(clean)

            elected_body = meta.get("elected_body")
            if isinstance(elected_body, str):
                clean_body = elected_body.strip()
                if clean_body:
                    key = clean_body.casefold()
                    if key not in elected_body_seen:
                        elected_body_seen.add(key)
                        elected_bodies.append(clean_body)

            fams = meta.get("families")
            if isinstance(fams, (list, tuple, set)):
                for fam in fams:
                    fam_str = str(fam or "").strip()
                    if not fam_str:
                        continue
                    fam_key = fam_str.casefold()
                    if fam_key not in families_seen:
                        families_seen.add(fam_key)
                        families.append(fam_str)

            election_meta = meta.get("elections")
            if isinstance(election_meta, (list, tuple, set)):
                for record in election_meta:
                    if not isinstance(record, Mapping):
                        continue
                    cleaned: Dict[str, object] = {}
                    for key, value in record.items():
                        cleaned[str(key)] = value
                    key_tuple = tuple(sorted((k, repr(cleaned[k])) for k in cleaned))
                    if key_tuple in election_seen:
                        continue
                    election_seen.add(key_tuple)
                    elections.append(cleaned)

            basis_value = _safe_float(meta.get("basis_electorate"))
            if basis_value is not None:
                basis_total += basis_value
                basis_seen = True

            np_share = _safe_float(meta.get("non_participant_share"))
            if np_share is not None:
                weight_basis = meta_electorate if meta_electorate is not None else 1.0
                if weight_basis > 0:
                    non_participant_value += float(np_share) * weight_basis
                    non_participant_weight += weight_basis
            np_label = meta.get("non_participant_label")
            if isinstance(np_label, str) and np_label.strip():
                non_participant_label = np_label.strip()

            turnout_share = _safe_float(meta.get("baseline_turnout_share"))
            if turnout_share is not None:
                weight_basis = meta_electorate if meta_electorate is not None else 1.0
                if weight_basis > 0:
                    turnout_value += float(turnout_share) * weight_basis
                    turnout_weight += weight_basis

            spoiled_share = _safe_float(meta.get("spoiled_share"))
            if spoiled_share is not None:
                weight_basis = meta_electorate if meta_electorate is not None else 1.0
                if weight_basis > 0:
                    spoiled_value += float(spoiled_share) * weight_basis
                    spoiled_weight += weight_basis
            spoil_label_meta = meta.get("spoiled_label")
            if isinstance(spoil_label_meta, str) and spoil_label_meta.strip():
                spoiled_label = spoil_label_meta.strip()
        for party in parties:
            if not isinstance(party, Mapping):
                continue
            entry = _party_from_mapping(party)
            materialised.append(entry)

    if not materialised:
        return {}

    if output_labels is None:
        for bd in breakdown_list:
            if not isinstance(bd, Mapping):
                continue
            meta = bd.get("metadata")
            if isinstance(meta, Mapping):
                labels = meta.get("option_labels")
                if labels:
                    output_labels = list(labels)
                    break
        if output_labels is None:
            first_counts = materialised[0].counts.keys()
            output_labels = list(first_counts)

    combined: Dict[str, _PartyEntry] = {}
    for entry in materialised:
        key = entry.party_key
        if key not in combined:
            combined[key] = _PartyEntry(
                party=entry.party,
                party_key=entry.party_key,
                baseline_share=0.0,
                baseline_electorate=0.0,
                endorsement=entry.endorsement,
            )
        target = combined[key]
        target.party = target.party or entry.party
        if target.endorsement is None and entry.endorsement is not None:
            target.endorsement = entry.endorsement
        target.baseline_share += entry.baseline_share
        if entry.baseline_electorate is not None:
            target.baseline_electorate = (target.baseline_electorate or 0.0) + entry.baseline_electorate
        for label in output_labels:
            target.counts[label] = target.counts.get(label, 0.0) + entry.counts.get(label, 0.0)
        if entry.weights:
            for label, value in entry.weights.items():
                target.weights[label] = target.weights.get(label, 0.0) + value * entry.baseline_share

    agg_entries = list(combined.values())
    agg_electorate = electorate if electorate is not None else (total_electorate if total_electorate > 0 else None)

    metadata_extras: Dict[str, object] = {}
    if event_types:
        metadata_extras["event_type"] = event_types[0] if len(event_types) == 1 else tuple(event_types)
    if elected_bodies:
        metadata_extras["elected_body"] = elected_bodies[0] if len(elected_bodies) == 1 else tuple(elected_bodies)
    if families:
        metadata_extras["families"] = tuple(families)
    if elections:
        metadata_extras["elections"] = elections
    if basis_seen:
        metadata_extras["basis_electorate"] = basis_total
    if non_participant_weight > 0:
        metadata_extras["non_participant_share"] = non_participant_value / non_participant_weight
        if non_participant_label:
            metadata_extras["non_participant_label"] = non_participant_label
    if turnout_weight > 0:
        metadata_extras["baseline_turnout_share"] = turnout_value / turnout_weight
    if spoiled_weight > 0:
        metadata_extras["spoiled_share"] = spoiled_value / spoiled_weight
        if spoiled_label:
            metadata_extras["spoiled_label"] = spoiled_label

    extras_payload = metadata_extras if metadata_extras else None
    pseudo_specs: List[Mapping[str, object]] = []
    if metadata_extras:
        meta_np_share = _safe_float(metadata_extras.get("non_participant_share"))
        if meta_np_share is not None and meta_np_share > 0:
            pseudo_specs.append(
                {
                    "name": "Election non-voters",
                    "share": meta_np_share,
                    "legend": metadata_extras.get("non_participant_label"),
                    "kind": "non_voters",
                }
            )
        meta_spoiled_share = _safe_float(metadata_extras.get("spoiled_share"))
        if meta_spoiled_share is not None and meta_spoiled_share > 0:
            pseudo_specs.append(
                {
                    "name": "Election spoiled",
                    "share": meta_spoiled_share,
                    "legend": metadata_extras.get("spoiled_label"),
                    "kind": "spoiled",
                }
            )
        turnout_share_val = _safe_float(metadata_extras.get("baseline_turnout_share"))
    else:
        turnout_share_val = None

    return _finalise(
        agg_entries,
        list(output_labels),
        agg_electorate,
        extras_payload,
        tuple(pseudo_specs) if pseudo_specs else None,
        turnout_share_val,
    )


@dataclass
class _PartyEntry:
    party: str
    party_key: str
    baseline_share: float
    baseline_electorate: Optional[float] = None
    endorsement: Optional[str] = None
    model_endorsement: Optional[str] = None
    counts: Dict[str, float] = field(default_factory=dict)
    weights: Dict[str, float] = field(default_factory=dict)
    profile_source: Optional[str] = None


def _prepare_entries(
    *,
    baseline_shares: Mapping[str, float],
    endorsements: Optional[Mapping[str, str]],
    canonical_endorsements: Optional[Mapping[str, str]],
    electorate: Optional[float],
    model_to_output: Optional[Mapping[str, str]],
) -> List[_PartyEntry]:
    entries: List[_PartyEntry] = []
    for party, share in (baseline_shares or {}).items():
        share_val = _safe_float(share)
        if share_val is None or share_val <= 0:
            continue
        party_name = str(party).strip()
        party_key = normalize_party_key(party_name) or party_name.casefold()
        model_choice = _resolve_endorsement(
            party_name,
            endorsements or {},
            canonical_endorsements or {},
        )
        output_choice = model_to_output.get(model_choice, model_choice) if model_to_output else model_choice
        base_electorate = None
        elec_val = _safe_float(electorate)
        if elec_val is not None:
            base_electorate = share_val * elec_val
        entries.append(
            _PartyEntry(
                party=party_name,
                party_key=party_key,
                baseline_share=share_val,
                baseline_electorate=base_electorate,
                endorsement=output_choice,
                model_endorsement=model_choice,
            )
        )

    total_share = sum(entry.baseline_share for entry in entries)
    if total_share > 0:
        for entry in entries:
            entry.baseline_share = entry.baseline_share / total_share
    return entries


def _resolve_endorsement(
    party: str,
    endorsements: Mapping[str, str],
    canonical: Mapping[str, str],
) -> Optional[str]:
    direct = endorsements.get(party)
    if direct:
        return direct
    key = normalize_party_key(party)
    if key:
        resolved = canonical.get(key)
        if resolved:
            return resolved
    return None


def _normalise_option_probabilities(
    labels: Sequence[str],
    probabilities: Optional[Mapping[str, float]],
) -> Dict[str, float]:
    option_probs: Dict[str, float] = {}
    total = 0.0
    for label in labels:
        value = _safe_float(probabilities.get(label) if probabilities else None)
        if value is None or value < 0:
            value = 0.0
        option_probs[label] = value
        total += value
    if total <= 0 and labels:
        uniform = 1.0 / float(len(labels))
        option_probs = {label: uniform for label in labels}
    elif total > 0:
        option_probs = {label: val / total for label, val in option_probs.items()}
    return option_probs


def _finalise(
    entries: Sequence[_PartyEntry],
    option_labels: Sequence[str],
    electorate: Optional[float],
    metadata_extras: Optional[Mapping[str, object]] = None,
    pseudo_specs: Optional[Sequence[Mapping[str, object]]] = None,
    turnout_share: Optional[float] = None,
) -> Dict[str, object]:
    if not entries:
        return {}

    turnout_share_val = _safe_float(turnout_share)
    option_totals: Dict[str, float] = {label: 0.0 for label in option_labels}
    parties_payload: List[Dict[str, object]] = []

    total_electorate = _safe_float(electorate)
    if total_electorate is None:
        total_electorate = sum(entry.baseline_electorate or 0.0 for entry in entries)
        if total_electorate <= 0:
            total_electorate = None

    def _build_option_totals_payload(count_map: Mapping[str, float]) -> Dict[str, Dict[str, object]]:
        summary: Dict[str, Dict[str, object]] = {}
        seen_order: List[str] = []
        for label in option_labels:
            normalised_label = normalize_option_label(label) or str(label).strip()
            if not normalised_label:
                continue
            key = _make_option_key(normalised_label)
            if key not in summary:
                summary[key] = {"label": normalised_label, "count": 0.0}
                seen_order.append(key)
            summary[key]["count"] = float(summary[key]["count"]) + float(count_map.get(label, 0.0) or 0.0)

        if not summary:
            return {}

        preferred_order = ["yes", "no", "spoiled", "did_not_vote"]
        ordered_keys: List[str] = []
        for key in preferred_order:
            if key in summary:
                ordered_keys.append(key)
        for key in seen_order:
            if key not in ordered_keys:
                ordered_keys.append(key)

        totals_payload: Dict[str, Dict[str, object]] = {}
        total_basis = total_electorate if total_electorate and total_electorate > 0 else None
        for key in ordered_keys:
            entry_totals = summary[key]
            count_val = float(entry_totals.get("count", 0.0) or 0.0)
            pct_val: Optional[float]
            if total_basis is not None and total_basis > 0:
                pct_val = count_val / total_basis
            else:
                pct_val = None
            totals_payload[key] = {
                "label": entry_totals.get("label"),
                "count": count_val,
                "pct_electorate": pct_val,
            }
        return totals_payload

    share_sum = sum(entry.baseline_share for entry in entries)
    if share_sum <= 0 and total_electorate:
        elec_sum = sum(entry.baseline_electorate or 0.0 for entry in entries)
        if elec_sum > 0:
            for entry in entries:
                if entry.baseline_electorate is not None:
                    entry.baseline_share = entry.baseline_electorate / elec_sum
    elif share_sum > 0 and turnout_share_val is not None and turnout_share_val >= 0:
        scale = turnout_share_val / share_sum if share_sum > 0 else 0.0
        for entry in entries:
            entry.baseline_share = entry.baseline_share * scale
    elif share_sum > 0:
        for entry in entries:
            entry.baseline_share = entry.baseline_share / share_sum

    for entry in entries:
        counts = {label: float(entry.counts.get(label, 0.0) or 0.0) for label in option_labels}
        projected_total = sum(counts.values())
        valid_total = sum(val for label, val in counts.items() if not is_dnv_label(label) and not is_spoiled_label(label))
        dnv_total = sum(val for label, val in counts.items() if is_dnv_label(label))
        spoiled_total = sum(val for label, val in counts.items() if is_spoiled_label(label))
        for label, value in counts.items():
            option_totals[label] = option_totals.get(label, 0.0) + value

        if entry.weights:
            total_weight = sum(max(0.0, float(value)) for value in entry.weights.values())
            if total_weight > 0:
                entry.weights = {
                    label: max(0.0, float(entry.weights.get(label, 0.0))) / total_weight
                    for label in option_labels
                }
            else:
                entry.weights = {}

        option_totals_payload = _build_option_totals_payload(counts)
        party_payload = {
            "party": entry.party,
            "party_key": entry.party_key,
            "baseline_share": entry.baseline_share,
            "baseline_electorate": entry.baseline_electorate,
            "endorsement": entry.endorsement,
            "counts": counts,
            "totals": {
                "projected": projected_total,
                "valid": valid_total,
                "did_not_vote": dnv_total,
                "spoiled": spoiled_total,
            },
            "options": [
                {
                    "option": label,
                    "count": counts[label],
                    "pct_party": counts[label] / projected_total if projected_total > 0 else None,
                    "pct_electorate": (counts[label] / total_electorate) if (total_electorate and total_electorate > 0) else None,
                }
                for label in option_labels
            ],
        }
        if option_totals_payload:
            party_payload["option_totals"] = option_totals_payload
        if entry.weights:
            profile_payload = {
                "weights": {
                    label: float(entry.weights.get(label, 0.0) or 0.0)
                    for label in option_labels
                }
            }
            if entry.profile_source:
                profile_payload["source"] = entry.profile_source
            party_payload["profile"] = profile_payload
        parties_payload.append(party_payload)

    label_key_map: Dict[str, str] = {}
    for label in option_labels:
        normalised_label = normalize_option_label(label) or str(label).strip()
        label_key_map[label] = _make_option_key(normalised_label) if normalised_label else _make_option_key(label)

    normalised_option_totals: Dict[str, float] = {}
    for label, value in option_totals.items():
        key = label_key_map.get(label)
        if not key:
            continue
        normalised_option_totals[key] = normalised_option_totals.get(key, 0.0) + float(value or 0.0)

    total_projected_all = sum(max(0.0, val) for val in normalised_option_totals.values())
    ratio_map: Dict[str, float] = {}
    if total_projected_all > 0:
        ratio_map = {key: val / total_projected_all for key, val in normalised_option_totals.items()}

    if pseudo_specs:
        for spec in pseudo_specs:
            if not isinstance(spec, Mapping):
                continue
            share_val = _safe_float(spec.get("share"))
            if share_val is None or share_val <= 0:
                continue
            if total_electorate is None or total_electorate <= 0:
                continue
            base_total = share_val * total_electorate
            if base_total <= 0:
                continue
            party_name = str(spec.get("name") or "").strip() or "Pseudo cohort"
            legend_label = str(spec.get("legend") or "").strip()
            party_key = normalize_party_key(party_name) or _make_option_key(party_name)

            counts: Dict[str, float] = {}
            options_payload: List[Dict[str, object]] = []
            for label in option_labels:
                key = label_key_map.get(label)
                ratio = ratio_map.get(key, 0.0) if key else 0.0
                count_val = base_total * ratio if ratio > 0 else 0.0
                count_val = float(count_val)
                counts[label] = count_val
                options_payload.append(
                    {
                        "option": label,
                        "count": count_val,
                        "pct_party": count_val / base_total if base_total > 0 else None,
                        "pct_electorate": (count_val / total_electorate) if (total_electorate and total_electorate > 0) else None,
                    }
                )

            projected_total = base_total
            valid_total = sum(val for label, val in counts.items() if not is_dnv_label(label) and not is_spoiled_label(label))
            dnv_total = sum(val for label, val in counts.items() if is_dnv_label(label))
            spoiled_total = sum(val for label, val in counts.items() if is_spoiled_label(label))

            option_totals_payload = _build_option_totals_payload(counts)
            pseudo_payload = {
                "party": party_name,
                "party_key": party_key,
                "baseline_share": share_val,
                "baseline_electorate": base_total,
                "endorsement": None,
                "counts": counts,
                "totals": {
                    "projected": projected_total,
                    "valid": valid_total,
                    "did_not_vote": dnv_total,
                    "spoiled": spoiled_total,
                },
                "options": options_payload,
                "is_pseudo": True,
            }
            if legend_label:
                pseudo_payload["legend_label"] = legend_label
            if option_totals_payload:
                pseudo_payload["option_totals"] = option_totals_payload
            parties_payload.append(pseudo_payload)

    metadata = {
        "option_labels": tuple(option_labels),
        "party_count": len(parties_payload),
    }
    if total_electorate is not None:
        metadata["electorate"] = total_electorate
    if metadata_extras:
        for key, value in metadata_extras.items():
            if value is None:
                continue
            metadata[key] = value

    return {
        "parties": parties_payload,
        "options": option_totals,
        "metadata": metadata,
    }


def _party_from_mapping(payload: Mapping[str, object]) -> _PartyEntry:
    party = str(payload.get("party", "")).strip()
    party_key = payload.get("party_key")
    if isinstance(party_key, str) and party_key.strip():
        key = party_key.strip()
    else:
        key = normalize_party_key(party) or party.casefold()

    baseline_share = _safe_float(payload.get("baseline_share")) or 0.0
    baseline_electorate = _safe_float(payload.get("baseline_electorate"))
    endorsement = payload.get("endorsement")
    if endorsement is not None:
        endorsement = str(endorsement)

    counts_payload = {}
    counts = payload.get("counts")
    if isinstance(counts, Mapping):
        for label, value in counts.items():
            counts_payload[str(label)] = float(value) if _safe_float(value) is not None else 0.0

    weights_payload: Dict[str, float] = {}
    weights = payload.get("weights")
    if isinstance(weights, Mapping):
        for label, value in weights.items():
            val = _safe_float(value)
            if val is None:
                continue
            weights_payload[str(label)] = float(val)

    profile_source = None
    profile_payload = payload.get("profile")
    if isinstance(profile_payload, Mapping):
        profile_weights = profile_payload.get("weights")
        if isinstance(profile_weights, Mapping):
            for label, value in profile_weights.items():
                val = _safe_float(value)
                if val is None:
                    continue
                weights_payload[str(label)] = float(val)
        source_val = profile_payload.get("source")
        if isinstance(source_val, str) and source_val.strip():
            profile_source = source_val.strip()

    return _PartyEntry(
        party=party,
        party_key=key,
        baseline_share=baseline_share,
        baseline_electorate=baseline_electorate,
        endorsement=endorsement,
        counts=counts_payload,
        weights=weights_payload,
        profile_source=profile_source,
    )


def _label_matches(a: str, b: str) -> bool:
    return normalize_option_label(a) == normalize_option_label(b)


def _normalise_profile_lookup(
    endorsement_profiles: Optional[Mapping[str, Sequence[float]]],
    model_options: Optional[Sequence[str]],
) -> Dict[str, np.ndarray]:
    if not endorsement_profiles or not model_options:
        return {}

    profiles: Dict[str, np.ndarray] = {}
    option_len = len(model_options)
    if option_len == 0:
        return {}

    for key, values in endorsement_profiles.items():
        if values is None:
            continue
        arr = np.asarray(list(values), dtype=float)
        if arr.size != option_len:
            continue
        norm_key = normalize_option_label(key) or str(key)
        profiles[norm_key] = np.clip(arr, 0.0, None)
    return profiles


def _profile_to_output_distribution(
    profile: Optional[Sequence[float]],
    model_options: Optional[Sequence[str]],
    output_labels: Sequence[str],
    model_to_output: Optional[Mapping[str, str]],
) -> Dict[str, float]:
    if profile is None or model_options is None:
        return {}

    arr = np.asarray(list(profile), dtype=float)
    if arr.size != len(model_options):
        return {}

    weights: Dict[str, float] = {label: 0.0 for label in output_labels}
    for idx, model_opt in enumerate(model_options):
        mapped = model_to_output.get(model_opt, model_opt) if model_to_output else model_opt
        if mapped not in weights:
            continue
        weights[mapped] += max(0.0, float(arr[idx]))

    total = sum(weights.values())
    if total <= 0:
        return {}

    return {label: val / total for label, val in weights.items()}


def _resolve_profile_weights(
    profile_key: str,
    profile_map: Mapping[str, np.ndarray],
    model_options: Optional[Sequence[str]],
    output_labels: Sequence[str],
    model_to_output: Optional[Mapping[str, str]],
) -> Dict[str, float]:
    if profile_key not in profile_map:
        return {}
    profile = profile_map.get(profile_key)
    if profile is None:
        return {}
    return _profile_to_output_distribution(profile, model_options, output_labels, model_to_output)


def _invert_mapping(
    model_to_output: Optional[Mapping[str, str]],
    model_options: Optional[Sequence[str]],
) -> Dict[str, Tuple[str, ...]]:
    if model_to_output is None:
        if not model_options:
            return {}
        return {str(opt): (str(opt),) for opt in model_options}

    inverted: Dict[str, List[str]] = {}
    for model_opt, output_opt in model_to_output.items():
        inverted.setdefault(output_opt, []).append(model_opt)
    return {key: tuple(values) for key, values in inverted.items()}


def _safe_float(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        fval = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if np.isnan(fval):
        return None
    return fval


_OPTION_KEY_SANITIZER = re.compile(r"[^a-z0-9]+")


def _make_option_key(label: str) -> str:
    text = str(label or "").strip().casefold()
    if not text:
        return "option"
    key = _OPTION_KEY_SANITIZER.sub("_", text).strip("_")
    return key or "option"
