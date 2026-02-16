from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import numpy as np
import pandas as pd

from ..features.endorsements import build_endorsement_history
from ..features.referendum_ml_features_fast import FastReferendumFeatureEngineer
from ..project.referendum import (
    build_custom_two_option_features,
    build_referendum_features_for_group,
    infer_body_options,
    predict_group_rows,
    _add_northern_ireland_view,
)
from ..utils import is_dnv_label, is_spoiled_label, normalize_constituency_name, sort_option_labels


@dataclass
class OptionResult:
    option: str
    count: Optional[float]
    pct_electorate: Optional[float]
    pct_valid: Optional[float]


@dataclass
class AreaResult:
    constituency: str
    body: str
    projected_date: str
    original_date: str
    electorate: Optional[float]
    turnout: Optional[float]
    turnout_pct: Optional[float]
    valid_votes: Optional[float]
    spoiled: Optional[float]
    did_not_vote: Optional[float]
    options: List[OptionResult] = field(default_factory=list)
    table: Dict[str, object] = field(default_factory=dict)
    chart: Dict[str, object] = field(default_factory=dict)
    party_breakdown: Dict[str, object] = field(default_factory=dict)


@dataclass
class ReferendumSimulationConfig:
    date: str
    body_key: Optional[str] = None
    constituency: Optional[str] = None
    constituencies: Optional[List[str]] = None
    custom_options: Optional[List[str]] = None
    custom_endorsements: Optional[Dict[str, str]] = None
    override_endorsements: Optional[Dict[str, str]] = None
    include_northern_ireland_view: bool = True
    breakdown_event_type: Optional[str] = None
    breakdown_elected_body: Optional[str] = None

    def is_custom(self) -> bool:
        return bool(self.custom_options)


@dataclass
class ReferendumSimulationResult:
    areas: List[AreaResult]
    model_options: List[str]
    metadata: Dict[str, object] = field(default_factory=dict)


def run_referendum_simulation(er: pd.DataFrame,
                              endorsements: Optional[pd.DataFrame],
                              model,
                              meta: Dict,
                              config: ReferendumSimulationConfig,
                              census_features: pd.DataFrame = None) -> ReferendumSimulationResult:
    if not config.date:
        raise ValueError("Simulation date must be provided.")

    meta_map = meta if isinstance(meta, Mapping) else {}
    model_spec = _derive_model_spec(model, meta_map)
    model_options = model_spec["options"]
    feat_cols = model_spec["feature_columns"]

    body_key = config.body_key
    if config.is_custom() and not body_key:
        body_key = "CustomReferendum"
    if not body_key:
        raise ValueError("A referendum body identifier must be provided.")

    constituencies, include_national = _resolve_constituencies(
        er,
        config.constituency,
        config.constituencies,
        config.include_northern_ireland_view,
    )

    endorsement_history = None
    if not config.is_custom():
        endorsement_history = build_endorsement_history(endorsements) if endorsements is not None else {}

    # Load census data if not provided
    if census_features is None:
        try:
            census_features = FastReferendumFeatureEngineer().load_census_data('Census2001.xlsx')
        except Exception:
            pass

    projected_rows: List[Dict[str, object]] = []
    for cons in constituencies:
        cons_norm = normalize_constituency_name(cons)
        if not cons_norm:
            continue

        if config.is_custom():
            if not config.custom_options or len(config.custom_options) != 2:
                raise ValueError("Custom referendums must specify exactly two options.")

            feat_df, totals, model_to_output, context = build_custom_two_option_features(
                er,
                config.date,
                cons_norm,
                body_key,
                model_options,
                config.custom_options,
                custom_endorsements=config.custom_endorsements,
                breakdown_event_type=config.breakdown_event_type,
                breakdown_elected_body=config.breakdown_elected_body,
                census_features=census_features,
            )
            context = dict(context or {})
            _apply_model_context_defaults(context, model_spec)
            desired_options = list(config.custom_options)
            if "Spoiled" in model_to_output.values() and "Spoiled" not in desired_options:
                desired_options.append("Spoiled")
            if "Did not vote" not in desired_options:
                desired_options.append("Did not vote")
        else:
            feat_df, totals, context = build_referendum_features_for_group(
                er,
                endorsements,
                config.date,
                cons_norm,
                body_key,
                model_options,
                endorsement_history=endorsement_history,
                override_endorsements=config.override_endorsements,
                breakdown_event_type=config.breakdown_event_type,
                breakdown_elected_body=config.breakdown_elected_body,
                census_features=census_features,
            )
            context = dict(context or {})
            _apply_model_context_defaults(context, model_spec)
            desired_options = infer_body_options(er, endorsements, str(body_key))
            if "Did not vote" not in desired_options:
                desired_options.append("Did not vote")
            if any(is_spoiled_label(opt) for opt in model_options) and not any(
                is_spoiled_label(opt) for opt in desired_options
            ):
                insert_idx = len(desired_options) - 1 if any(is_dnv_label(opt) for opt in desired_options) else len(desired_options)
                desired_options.insert(insert_idx, "Spoiled")
            model_to_output = {opt: opt for opt in model_options}

        rows, _ = predict_group_rows(
            model,
            feat_cols,
            model_options,
            feat_df,
            totals,
            desired_options,
            model_to_output,
            date_str=config.date,
            constituency=cons_norm,
            body_key=str(body_key),
            context=context,
        )
        projected_rows.extend(rows)

    if not projected_rows:
        raise ValueError("No constituencies produced referendum rows for the simulation request.")

    df = pd.DataFrame(projected_rows)

    requested = normalize_constituency_name(config.constituency) if config.constituency else ""
    if config.constituencies:
        requested = ""
    if include_national and (not requested or requested.lower() == "northern ireland" or len(constituencies) > 1):
        df = _add_northern_ireland_view(df)

    areas = _frame_to_area_results(df)
    metadata = _collect_simulation_metadata(
        areas,
        model_summary=_summarise_model_metadata(meta_map, model_spec, model),
    )
    return ReferendumSimulationResult(areas=areas, model_options=model_options, metadata=metadata)


def _resolve_constituencies(er: pd.DataFrame,
                            constituency: Optional[str],
                            constituencies: Optional[List[str]],
                            include_national: bool) -> Tuple[List[str], bool]:
    selected: List[str] = []

    if constituencies:
        seen = set()
        for raw in constituencies:
            cons_norm = normalize_constituency_name(raw)
            if not cons_norm:
                continue
            if cons_norm.lower() == "northern ireland":
                include_national = True
                continue
            key = cons_norm.lower()
            if key in seen:
                continue
            seen.add(key)
            selected.append(cons_norm)

    if not selected and constituency:
        cons_norm = normalize_constituency_name(constituency)
        if cons_norm.lower() == "northern ireland":
            cons_list = _list_constituencies(er)
            return cons_list, include_national
        selected.append(cons_norm)

    if not selected:
        return _list_constituencies(er), include_national

    return selected, include_national


def _list_constituencies(er: pd.DataFrame) -> List[str]:
    cons_set = set()
    if "Constituency" not in er.columns:
        return []
    for raw in er["Constituency"].astype(str).dropna():
        cons_norm = normalize_constituency_name(raw)
        if cons_norm and cons_norm.lower() != "northern ireland":
            cons_set.add(cons_norm)
    return sorted(cons_set)


def _ensure_dataframe(grp: Any, default_cols: List[str] = None) -> pd.DataFrame:
    """
    Ensure that grp is a proper DataFrame. If it's a numpy array, Series,
    or other type, convert it or return an empty DataFrame with expected columns.
    """
    if grp is None:
        return pd.DataFrame()
    
    # If it's already a DataFrame, return it
    if isinstance(grp, pd.DataFrame):
        return grp
    
    # If it's a Series, convert to DataFrame
    if isinstance(grp, pd.Series):
        return grp.to_frame().T  # Convert to single-row DataFrame
    
    # If it's a numpy array, try to convert
    if isinstance(grp, np.ndarray):
        # Try to reshape into a DataFrame
        try:
            if grp.ndim == 1:
                return pd.DataFrame([grp], columns=default_cols if default_cols else [f'col_{i}' for i in range(len(grp))])
            else:
                return pd.DataFrame(grp, columns=default_cols if default_cols else [f'col_{i}' for i in range(grp.shape[1])])
        except:
            return pd.DataFrame()
    
    # If it's a scalar or other type, return empty DataFrame
    return pd.DataFrame()


def _safe_group_get(grp: Any, column: str, default: Any = None) -> Any:
    """
    Safely get a column from a group, handling cases where grp might be
    a numpy array, Series, or DataFrame.
    """
    if grp is None:
        return default
    
    # Ensure we have a DataFrame
    df = _ensure_dataframe(grp)
    
    # If we have an empty DataFrame or column doesn't exist, return default
    if df.empty or column not in df.columns:
        return default
    
    # Return the column/series
    return df[column]


def _frame_to_area_results(df: pd.DataFrame) -> List[AreaResult]:
    if df.empty:
        return []

    groups = df.groupby(["ProjectedDate", "OriginalDate", "Constituency", "ElectedBody"], sort=False)
    areas: List[AreaResult] = []

    for (proj_date, orig_date, cons, body), grp in groups:
        options: List[OptionResult] = []
        counts: Dict[str, float] = {}
        
        # Ensure grp is always a proper DataFrame (not a numpy array or Series)
        grp = _ensure_dataframe(grp)
        
        breakdown_series = _safe_group_get(grp, "PartyBreakdown")
        party_breakdown: Dict[str, object] = {}
        if breakdown_series is not None:
            first_payload = _first_non_null(breakdown_series)
            if isinstance(first_payload, Mapping):
                party_breakdown = dict(first_payload)

        for _, row in grp.iterrows():
            label = str(row.get("Option", ""))
            count = _coerce_float(row.get("ProjectedCount"))
            pct_el = _coerce_float(row.get("ProjectedPctElectorate"))
            pct_valid = _coerce_float(row.get("ProjectedPctValid"))
            options.append(OptionResult(option=label, count=count, pct_electorate=pct_el, pct_valid=pct_valid))
            if count is not None:
                counts[label] = count

        electorate = _coerce_float(_first_non_null(_safe_group_get(grp, "Electorate")))
        spoiled_series = _safe_group_get(grp, "ProjectedSpoiled")
        spoiled = _coerce_float(_first_non_null(spoiled_series))

        valid_votes = 0.0
        valid_defined = False
        for label, value in counts.items():
            if value is None or not np.isfinite(value):
                continue
            if is_dnv_label(label) or is_spoiled_label(label):
                continue
            valid_votes += float(value)
            valid_defined = True

        spoiled_defined = False
        spoiled_total = 0.0
        for label, value in counts.items():
            if value is None or not np.isfinite(value):
                continue
            if is_spoiled_label(label):
                spoiled_total += float(value)
                spoiled_defined = True
        if spoiled_defined:
            spoiled = spoiled_total

        turnout = None
        if valid_defined:
            turnout = valid_votes + (spoiled if spoiled is not None and np.isfinite(spoiled) else 0.0)

        did_not_vote = None
        if turnout is not None and electorate and np.isfinite(electorate):
            did_not_vote = float(electorate) - float(turnout)
            if did_not_vote < 0:
                did_not_vote = 0.0
        else:
            dnv_sum = 0.0
            dnv_defined = False
            for label, value in counts.items():
                if value is None or not np.isfinite(value):
                    continue
                if is_dnv_label(label):
                    dnv_sum += float(value)
                    dnv_defined = True
            if dnv_defined:
                did_not_vote = dnv_sum

        # Recompute turnout_pct with updated figures
        turnout_pct = None
        if turnout is not None and electorate and np.isfinite(electorate) and electorate > 0:
            turnout_pct = 100.0 * float(turnout) / float(electorate)

        # Recompute per-option percentages so they reflect adjusted totals
        valid_total = valid_votes if valid_defined else None
        if valid_total is None or (turnout is None and not valid_defined):
            valid_total = None
        if turnout is not None and spoiled is not None and np.isfinite(spoiled):
            valid_total = float(turnout) - float(spoiled)

        table_rows: List[Dict[str, Optional[float]]] = []

        for opt in options:
            if opt.count is not None and electorate and np.isfinite(electorate) and electorate > 0:
                opt.pct_electorate = 100.0 * float(opt.count) / float(electorate)
            else:
                opt.pct_electorate = None
            if (
                opt.count is not None
                and valid_total is not None
                and np.isfinite(valid_total)
                and valid_total > 0
                and not is_dnv_label(opt.option)
                and not is_spoiled_label(opt.option)
            ):
                opt.pct_valid = 100.0 * float(opt.count) / float(valid_total)
            else:
                opt.pct_valid = None

            vote_val = _coerce_float(opt.count)
            table_rows.append(
                {
                    "option": opt.option,
                    "votes": vote_val,
                    "pct_electorate": _coerce_float(opt.pct_electorate),
                    "pct_valid": _coerce_float(opt.pct_valid),
                }
            )

        table_summary = {
            "electorate": _coerce_float(electorate),
            "turnout": _coerce_float(turnout),
            "turnout_pct": _coerce_float(turnout_pct),
            "valid": _coerce_float(valid_total),
            "spoiled": _coerce_float(spoiled),
            "did_not_vote": _coerce_float(did_not_vote),
        }

        has_spoiled_row = any(is_spoiled_label(str(row.get("option"))) for row in table_rows)
        if (
            not has_spoiled_row
            and table_summary.get("spoiled") is not None
            and np.isfinite(table_summary["spoiled"])
            and float(table_summary["spoiled"]) > 0
        ):
            spoiled_votes = float(table_summary["spoiled"])
            pct_el = None
            if electorate and np.isfinite(electorate) and electorate > 0:
                pct_el = 100.0 * spoiled_votes / float(electorate)
            table_rows.append(
                {
                    "option": "Spoiled",
                    "votes": spoiled_votes,
                    "pct_electorate": pct_el,
                    "pct_valid": None,
                }
            )

        # Order table rows using the same heuristics as option inference so charts remain stable.
        label_order = sort_option_labels([str(row.get("option")) for row in table_rows if row.get("option")])
        ordered_rows: List[Dict[str, Optional[float]]] = []
        seen_labels = set()
        for label in label_order:
            for row in table_rows:
                if row.get("option") == label and label not in seen_labels:
                    ordered_rows.append(row)
                    seen_labels.add(label)
                    break
        for row in table_rows:
            label = row.get("option")
            if not label or label in seen_labels:
                continue
            ordered_rows.append(row)
            seen_labels.add(label)
        table_rows = ordered_rows

        chart_labels: List[str] = []
        chart_values: List[Optional[float]] = []
        for row in table_rows:
            label = row.get("option")
            if not label:
                continue
            chart_labels.append(str(label))
            votes = row.get("votes")
            chart_values.append(0.0 if votes is None else float(votes))

        has_dnv = any(is_dnv_label(label) for label in chart_labels)
        if (
            not has_dnv
            and table_summary.get("did_not_vote") is not None
            and np.isfinite(table_summary["did_not_vote"])
        ):
            chart_labels.append("Did not vote")
            chart_values.append(float(table_summary["did_not_vote"]))

        chart_payload = {
            "labels": chart_labels,
            "values": chart_values,
            "electorate": table_summary["electorate"],
            "turnout": table_summary["turnout"],
            "valid": table_summary["valid"],
            "spoiled": table_summary["spoiled"],
            "did_not_vote": table_summary["did_not_vote"],
        }

        areas.append(
            AreaResult(
                constituency=str(cons),
                body=str(body),
                projected_date=str(proj_date),
                original_date=str(orig_date),
                electorate=electorate,
                turnout=turnout,
                turnout_pct=turnout_pct,
                valid_votes=valid_total,
                spoiled=spoiled,
                did_not_vote=did_not_vote,
                options=options,
                table={"rows": table_rows, "summary": table_summary},
                chart=chart_payload,
                party_breakdown=party_breakdown,
            )
        )

    return areas


def _collect_simulation_metadata(
    areas: Sequence[AreaResult],
    *,
    model_summary: Optional[Mapping[str, Any]] = None,
) -> Dict[str, object]:
    if not areas:
        return {}

    option_labels: Optional[Tuple[str, ...]] = None
    constituencies: List[str] = []
    constituency_seen: Set[str] = set()
    bodies: List[str] = []
    body_seen: Set[str] = set()
    projected_dates: List[str] = []
    projected_seen: Set[str] = set()
    original_dates: List[str] = []
    original_seen: Set[str] = set()
    event_types: List[str] = []
    event_seen: Set[str] = set()
    elected_bodies: List[str] = []
    elected_seen: Set[str] = set()
    families: List[str] = []
    family_seen: Set[str] = set()
    elections: List[Dict[str, object]] = []
    election_seen: Set[Tuple[Tuple[str, str], ...]] = set()
    includes_national = False
    basis_total = 0.0
    basis_seen = False
    constituency_electorate = 0.0
    electorate_seen = False
    electorate_keys: Set[str] = set()
    non_participant_total = 0.0
    non_participant_weight = 0.0
    non_participant_label: Optional[str] = None
    spoiled_total = 0.0
    spoiled_weight = 0.0
    spoiled_label: Optional[str] = None
    turnout_total = 0.0
    turnout_weight = 0.0

    def _iter_values(value: object) -> Iterable[str]:
        if isinstance(value, str):
            text = value.strip()
            if text:
                yield text
        elif isinstance(value, (list, tuple, set)):
            for item in value:
                if not isinstance(item, str):
                    continue
                text = item.strip()
                if text:
                    yield text

    for area in areas:
        constituency = (area.constituency or "").strip()
        if constituency:
            const_key = constituency.casefold()
            if const_key == "northern ireland":
                includes_national = True
            elif const_key not in constituency_seen:
                constituency_seen.add(const_key)
                constituencies.append(constituency)
            if const_key != "northern ireland" and const_key not in electorate_keys:
                if area.electorate is not None and np.isfinite(area.electorate):
                    constituency_electorate += float(area.electorate)
                    electorate_seen = True
                electorate_keys.add(const_key)

        body = (area.body or "").strip()
        if body:
            body_key = body.casefold()
            if body_key not in body_seen:
                body_seen.add(body_key)
                bodies.append(body)

        proj = (area.projected_date or "").strip()
        if proj:
            proj_key = proj.casefold()
            if proj_key not in projected_seen:
                projected_seen.add(proj_key)
                projected_dates.append(proj)

        orig = (area.original_date or "").strip()
        if orig:
            orig_key = orig.casefold()
            if orig_key not in original_seen:
                original_seen.add(orig_key)
                original_dates.append(orig)

        breakdown = area.party_breakdown if isinstance(area.party_breakdown, Mapping) else None
        if not breakdown:
            continue
        meta = breakdown.get("metadata") if isinstance(breakdown, Mapping) else None
        if not isinstance(meta, Mapping):
            continue

        labels = meta.get("option_labels")
        if option_labels is None and isinstance(labels, (list, tuple)):
            option_labels = tuple(str(label) for label in labels)

        for value in _iter_values(meta.get("event_type")):
            key = value.casefold()
            if key and key not in event_seen:
                event_seen.add(key)
                event_types.append(value)

        for value in _iter_values(meta.get("elected_body")):
            key = value.casefold()
            if key and key not in elected_seen:
                elected_seen.add(key)
                elected_bodies.append(value)

        for value in _iter_values(meta.get("families")):
            key = value.casefold()
            if key and key not in family_seen:
                family_seen.add(key)
                families.append(value)

        basis_val = _coerce_float(meta.get("basis_electorate"))
        if basis_val is not None:
            basis_total += basis_val
            basis_seen = True

        np_share_val = _coerce_float(meta.get("non_participant_share"))
        if np_share_val is not None:
            weight = basis_val
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = _coerce_float(meta.get("electorate"))
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = 1.0
            non_participant_total += float(np_share_val) * float(weight)
            non_participant_weight += float(weight)

        np_label_val = meta.get("non_participant_label")
        if isinstance(np_label_val, str) and np_label_val.strip():
            non_participant_label = np_label_val.strip()

        spoiled_share_val = _coerce_float(meta.get("spoiled_share"))
        if spoiled_share_val is not None:
            weight = basis_val
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = _coerce_float(meta.get("electorate"))
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = 1.0
            spoiled_total += float(spoiled_share_val) * float(weight)
            spoiled_weight += float(weight)

        spoiled_label_val = meta.get("spoiled_label")
        if isinstance(spoiled_label_val, str) and spoiled_label_val.strip():
            spoiled_label = spoiled_label_val.strip()

        turnout_share_val = _coerce_float(meta.get("baseline_turnout_share"))
        if turnout_share_val is not None:
            weight = basis_val
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = _coerce_float(meta.get("electorate"))
            if weight is None or not np.isfinite(weight) or weight <= 0:
                weight = 1.0
            turnout_total += float(turnout_share_val) * float(weight)
            turnout_weight += float(weight)

        elections_meta = meta.get("elections")
        if isinstance(elections_meta, (list, tuple)):
            for record in elections_meta:
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

    metadata: Dict[str, object] = {}

    if option_labels:
        metadata["option_labels"] = option_labels
    if constituencies:
        metadata["constituencies"] = constituencies
        metadata["constituency_count"] = len(constituencies)
    if bodies:
        metadata["bodies"] = bodies[0] if len(bodies) == 1 else tuple(bodies)
    if projected_dates:
        metadata["projected_date"] = projected_dates[0] if len(projected_dates) == 1 else tuple(projected_dates)
    if original_dates:
        metadata["original_date"] = original_dates[0] if len(original_dates) == 1 else tuple(original_dates)
    if event_types:
        metadata["event_type"] = event_types[0] if len(event_types) == 1 else tuple(event_types)
    if elected_bodies:
        metadata["elected_body"] = (
            elected_bodies[0] if len(elected_bodies) == 1 else tuple(elected_bodies)
        )
    if families:
        metadata["families"] = tuple(families)
    if elections:
        metadata["elections"] = elections
    if basis_seen:
        metadata["basis_electorate"] = basis_total
    if electorate_seen:
        metadata["constituency_electorate"] = constituency_electorate
    if non_participant_weight > 0:
        metadata["non_participant_share"] = non_participant_total / non_participant_weight
        if non_participant_label:
            metadata["non_participant_label"] = non_participant_label
    if spoiled_weight > 0:
        metadata["spoiled_share"] = spoiled_total / spoiled_weight
        if spoiled_label:
            metadata["spoiled_label"] = spoiled_label
    if turnout_weight > 0:
        metadata["baseline_turnout_share"] = turnout_total / turnout_weight

    metadata["includes_northern_ireland_view"] = includes_national
    metadata["area_count"] = len(areas)

    if model_summary:
        metadata["model"] = dict(model_summary)

    return metadata


def _derive_model_spec(model, meta: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    meta = meta if isinstance(meta, Mapping) else {}

    options = list(getattr(model, "options", []) or meta.get("options", []) or [])
    if not options:
        raise ValueError("Model metadata must include option labels.")

    feat_cols = list(
        getattr(model, "feature_columns", [])
        or getattr(model, "feat_cols", [])
        or meta.get("feat_cols", [])
        or []
    )
    if not feat_cols:
        raise ValueError("Model metadata must include feature column names.")

    target_cols = list(
        meta.get("target_cols")
        or getattr(model, "target_columns", [])
        or [f"target::{opt}" for opt in options]
    )

    def _clean_profiles(profile_map: Optional[Mapping[str, Sequence[float]]]):
        if not isinstance(profile_map, Mapping):
            return {}
        cleaned: Dict[str, List[float]] = {}
        for key, values in profile_map.items():
            try:
                cleaned[str(key)] = [float(v) for v in values]
            except Exception:
                continue
        return cleaned

    endorsement_profiles = _clean_profiles(meta.get("endorsement_profiles"))
    neutral_profile = meta.get("neutral_profile")
    if neutral_profile is not None:
        try:
            neutral_profile = [float(v) for v in neutral_profile]
        except Exception:
            neutral_profile = None

    return {
        "options": list(options),
        "feature_columns": list(feat_cols),
        "target_columns": list(target_cols),
        "endorsement_profiles": endorsement_profiles,
        "neutral_profile": neutral_profile,
        "non_participant_label": meta.get("non_participant_label"),
        "non_participant_share": meta.get("non_participant_share"),
        "baseline_turnout_share": meta.get("baseline_turnout_share"),
    }


def _apply_model_context_defaults(context: Dict[str, object], model_spec: Mapping[str, Any]) -> None:
    profiles = model_spec.get("endorsement_profiles")
    if profiles:
        context.setdefault("endorsement_profiles", profiles)

    neutral_profile = model_spec.get("neutral_profile")
    if neutral_profile is not None:
        context.setdefault("neutral_profile", neutral_profile)

    label = model_spec.get("non_participant_label")
    if isinstance(label, str) and label.strip():
        context.setdefault("non_participant_label", label.strip())

    non_participant_share = model_spec.get("non_participant_share")
    if non_participant_share is not None:
        try:
            value = float(non_participant_share)
        except (TypeError, ValueError):
            value = None
        if value is not None:
            context.setdefault("non_participant_share", value)

    baseline_turnout = model_spec.get("baseline_turnout_share")
    if baseline_turnout is not None:
        try:
            value = float(baseline_turnout)
        except (TypeError, ValueError):
            value = None
        if value is not None:
            context.setdefault("baseline_turnout_share", value)


def _summarise_model_metadata(
    meta: Mapping[str, Any],
    model_spec: Mapping[str, Any],
    model: Any,
) -> Dict[str, Any]:
    meta_map = meta if isinstance(meta, Mapping) else {}
    summary: Dict[str, Any] = {
        "bundle_version": meta_map.get("bundle_version"),
        "options": tuple(model_spec.get("options", ())),
        "feature_columns": tuple(model_spec.get("feature_columns", ())),
        "target_columns": tuple(model_spec.get("target_columns", ())),
    }

    for key in (
        "feature_version",
        "trained_at",
        "training_rows",
        "training_config",
        "cv_metrics",
        "source_workbook",
    ):
        if key in meta_map:
            summary[key] = meta_map[key]

    temperature = getattr(model, "temperature", None)
    if isinstance(temperature, (int, float)) and np.isfinite(temperature):
        summary["temperature"] = float(temperature)

    return summary


def _coerce_float(value) -> Optional[float]:
    """
    Convert a value to float, handling None, NaN, and numpy arrays.
    """
    if value is None:
        return None
    
    # Handle numpy arrays with single values
    if isinstance(value, np.ndarray):
        if value.size == 0:
            return None
        # Get the first element if it's a single value array
        if value.size == 1:
            value = value.item()
        else:
            # For multi-element arrays, try to get the first element
            value = value.flat[0]
    
    # Handle pandas missing values
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    
    try:
        fval = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(fval):
        return None
    return fval


def _first_non_null(series: Optional[Any]):
    """
    Safely get the first non-null value from a pandas Series, numpy array, or other iterable.
    Handles edge cases where the input might be None or an unexpected type.
    
    Args:
        series: A pandas Series, numpy array, list, or other iterable
        
    Returns:
        The first non-null value, or None if not found
    """
    if series is None:
        return None
    
    # Convert numpy array to pandas Series for consistent handling
    if isinstance(series, np.ndarray):
        series = pd.Series(series)
    
    # If it's already a pandas Series, use pandas methods
    if isinstance(series, pd.Series):
        # Use pandas dropna() which is more efficient and handles edge cases
        non_null = series.dropna()
        if not non_null.empty:
            return non_null.iloc[0]
        return None
    
    # For other iterables (list, tuple, etc.)
    try:
        for value in series:
            if pd.notna(value):
                return value
    except TypeError:
        # If it's not iterable, return None
        pass
    
    return None