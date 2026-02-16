"""Scenario feature context helpers for the transfer engine."""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

from .base import _clean_party, _infer_type_from_body
from .ml_tables import _canonical_body_for_model, _canonical_event_for_model

__all__ = ["build_feature_context"]


def build_feature_context(er_df, tr_df, scenario_dict: Dict[str, Any]) -> Dict[str, Any]:
    parties_raw: List[str] = list(scenario_dict.get("parties", []))
    parties: List[str] = [_clean_party(p) for p in parties_raw]
    person_ids_raw = list(scenario_dict.get("person_ids", [None] * len(parties)))
    person_id: np.ndarray = np.array(
        [int(x) if str(x).strip().isdigit() else -1 for x in person_ids_raw], dtype=int
    )

    constituency = str(scenario_dict.get("constituency", "") or "")
    body_raw = str(scenario_dict.get("elected_body", "") or "")
    body = _canonical_body_for_model(body_raw) or body_raw

    def _normalise_election_type(value: str, fallback_body: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        low = raw.casefold().replace(" ", "")
        if low in {"europeanelection", "europeanparliament"}:
            return "EuropeanElection"
        if low in {"devolvedelection", "northernirelandassembly"}:
            return "DevolvedElection"
        if low in {"generalelection"}:
            return "GeneralElection"
        if low in {"byelection", "by-election"}:
            return "ByElection"
        if low in {"localelection", "localcouncil"}:
            return "LocalElection"
        if low in {"referendum", "poll"}:
            return "Referendum"
        if low in {"custom", "customelection"}:
            return _normalise_election_type(_infer_type_from_body(fallback_body), fallback_body)
        return raw

    etype_raw = str(scenario_dict.get("election_type", "") or "")
    event_raw = str(scenario_dict.get("event", "") or "")
    legacy_raw = str(scenario_dict.get("event_type", "") or "")

    etype = _normalise_election_type(etype_raw, body_raw)
    if not etype:
        etype = _normalise_election_type(event_raw, body_raw)
    if not etype:
        etype = _normalise_election_type(legacy_raw, body_raw)
    if not etype:
        etype = _infer_type_from_body(body_raw)
    etype = _canonical_event_for_model(etype) or etype

    first_vals = scenario_dict.get("first_prefs", [])
    try:
        first_arr = np.asarray(first_vals, dtype=float)
    except Exception:
        first_arr = np.zeros(len(parties), dtype=float)

    return {
        "party": np.array(parties, dtype=object),
        "person_id": person_id,
        "constituency": constituency,
        "body": body,
        "election_type": etype,
        "count": 0,
        "debug_mode": bool(scenario_dict.get("debug_mode", False)),
        "sse_job": scenario_dict.get("sse_job"),
        "names": scenario_dict.get("names", []),
        "initial_first": first_arr,
        "ignore_priors": bool(scenario_dict.get("ignore_priors", False)),
        # New toggle parameters for NI Assembly scenarios
        "include_constitutional_convention": bool(scenario_dict.get("include_constitutional_convention", False)),
        "include_european_parliament": bool(scenario_dict.get("include_european_parliament", False)),
    }
