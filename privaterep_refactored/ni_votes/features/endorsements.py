
"""Helpers for working with party endorsements in referendum features."""

from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd
import re
import unicodedata

from ..utils import normalize_option_label, to_date_str


_UNIONIST_KEYS = {
    "dup",
    "democraticunionistparty",
    "pup",
    "progressiveunionistparty",
    "uup",
    "ulsterunionistparty",
    "tuv",
    "traditionalunionistvoice",
    "ucunf",
    "ulsterconservativesandunionists",
    "ukup",
    "unitedkingdomunionistparty",
    "vanguardunionistprogressiveparty",
    "unionistpartyofnorthernireland",
    "unitedulsterunionistparty",
    "northernirelandunionistparty",
    "southbelfastunionists",
    "ulsterconstitutionparty",
    "protestantunionistparty",
    "independentunionist",
    "conservative",
    "unionist",
    "unionists",
    "nationalfront",
    "ukip",
}

_NATIONALIST_KEYS = {
    "sinnfein",
    "republicansinnfein",
    "provisionalsinnfein",
    "sdlp",
    "socialdemocraticandlabourparty",
    "aontu",
    "irsp",
    "irishrepublicansocialistparty",
    "nationalistparty",
    "nationaldemocraticparty",
    "unity",
    "republicanlabourparty",
    "independentnationalist",
    "peoplebeforeprofitalliance",
    "workerspartyrepublicanclubs",
    "communistpartyofireland",
}

_CROSS_COMMUNITY_KEYS = {
    "alliance",
    "greenecology",
    "ni21",
    "labourcoalition",
    "northernirelandwomenscoalition",
    "northernirelandlabourrepresentationcommittee",
    "democraticpartnership",
    "democraticleftnewagenda",
    "labour",
    "labourparty",
}

PARTY_FAMILY_MAP: Dict[str, str] = {key: "unionist" for key in _UNIONIST_KEYS}
PARTY_FAMILY_MAP.update({key: "nationalist" for key in _NATIONALIST_KEYS})
PARTY_FAMILY_MAP.update({key: "cross" for key in _CROSS_COMMUNITY_KEYS})



def normalize_party_key(name: str) -> str:
    """Return a canonical matching key for a party label."""

    try:
        text = str(name or "")
    except Exception:
        text = ""
    text = text.strip()
    if not text:
        return ""

    # Normalise Unicode and strip accents so "Sinn Féin" == "Sinn Fein".
    text = unicodedata.normalize("NFKC", text)
    text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    text = re.sub(r"\s+", " ", text).strip()
    key = re.sub(r"[^a-z0-9]+", "", text.casefold())
    if not key:
        return ""

    alias_map = {
        "alliancepartyofnorthernireland": "alliance",
        "thealliancepartyofnorthernireland": "alliance",
        "alliancepartyofnireland": "alliance",
        "allianceni": "alliance",
        "alliancenorthernireland": "alliance",
        "allianceparty": "alliance",
        "democraticunionistparty": "dup",
        "dup": "dup",
        "progressiveunionistparty": "pup",
        "pup": "pup",
        "ulsterunionistparty": "uup",
        "uup": "uup",
        "ulsterconservativesandunionists": "ucunf",
        "ucunf": "ucunf",
        "socialdemocraticandlabourparty": "sdlp",
        "sdlp": "sdlp",
        "traditionalunionistvoice": "tuv",
        "tuv": "tuv",
        "greenpartyinnorthernireland": "greenecology",
        "greenparty": "greenecology",
        "greenecology": "greenecology",
        "peoplebeforeprofit": "peoplebeforeprofitalliance",
        "peoplebeforeprofitalliance": "peoplebeforeprofitalliance",
        "irishrepublicansocialistparty": "irsp",
        "irsp": "irsp",
        "unitedkingdomindependenceparty": "ukip",
        "ukindependenceparty": "ukip",
        "ukip": "ukip",
        "workersparty": "workerspartyrepublicanclubs",
        "workerspartyireland": "workerspartyrepublicanclubs",
        "workerspartyrepublicanclubs": "workerspartyrepublicanclubs",
    }

    canonical = alias_map.get(key)
    if canonical:
        return canonical

    # Handle common cases where workbook strings append or prepend abbreviations
    # (e.g. "Democratic Unionist Party - D.U.P." -> "democraticunionistpartydup").
    for variant, mapped in alias_map.items():
        if not variant:
            continue
        if key.startswith(variant) or key.endswith(variant):
            return mapped

    return key


def infer_party_family(name: str) -> str:
    """Classify a party into a broad family (unionist, nationalist, cross, other)."""

    key = normalize_party_key(name)
    if not key:
        return "other"
    return PARTY_FAMILY_MAP.get(key, "other")


EndorsementSnapshot = Tuple[pd.Timestamp, Dict[str, str]]


def _ensure_body_key(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy of *df* with a "BodyKey" column inferred when missing."""

    end = df.copy()
    if "BodyKey" not in end.columns:
        body_col = None
        for cand in ["ElectedBody", "ReferendumName", "Body", "PollName"]:
            if cand in end.columns:
                body_col = cand
                break
        end["BodyKey"] = end[body_col].astype(str) if body_col else ""
    return end


def build_endorsement_history(endorsements: pd.DataFrame) -> Dict[str, List[EndorsementSnapshot]]:
    """Return chronological endorsement snapshots for each referendum body.

    The returned structure is ``{body_key: [(timestamp, mapping), ...]}`` where each
    mapping captures the cumulative endorsements in effect after processing that
    timestamp. Later updates for a subset of parties inherit the prior choices for
    other parties, matching the "persists until replaced" rule used throughout the
    simulator code. Empty or missing endorsement values remove a party from the
    active mapping.
    """

    if endorsements is None or endorsements.empty:
        return {}

    end = _ensure_body_key(endorsements)
    end["DateStr"] = end.get("DateStr", end.get("Date", pd.Series("", index=end.index))).apply(to_date_str)
    end["DateTS"] = pd.to_datetime(end["DateStr"], errors="coerce")

    history: Dict[str, List[EndorsementSnapshot]] = {}

    for body_key, grp in end.groupby("BodyKey"):
        grp = grp.sort_values(["DateTS", "Party"], kind="mergesort")

        current: Dict[str, Tuple[str, str]] = {}
        snapshots: List[EndorsementSnapshot] = []

        for ts, ts_rows in grp.groupby("DateTS"):
            if pd.isna(ts):
                # Without a valid timestamp we cannot order the endorsement. Skip.
                continue

            working = dict(current)
            for _, row in ts_rows.iterrows():
                raw_party = str(row.get("Party", "")).strip()
                key = normalize_party_key(raw_party)
                if not key:
                    continue
                endorsed = str(row.get("EndorsedClean", "")).strip()
                if endorsed:
                    normalized_choice = normalize_option_label(endorsed)
                    if not normalized_choice:
                        working.pop(key, None)
                        continue
                    working[key] = (raw_party, normalized_choice)
                else:
                    working.pop(key, None)

            current = working
            snapshot_map = {display: choice for display, choice in current.values()}
            snapshots.append((pd.Timestamp(ts), snapshot_map))

        if snapshots:
            history[str(body_key)] = snapshots

    return history


def resolve_endorsements_for_date(history: Dict[str, List[EndorsementSnapshot]],
                                  body_key: str,
                                  date_str: str) -> Dict[str, str]:
    """Return the endorsement map for ``body_key`` in effect on ``date_str``.

    If ``date_str`` is after the latest known endorsement, the most recent mapping
    is returned. If the date precedes any endorsement, an empty mapping is
    produced. ``date_str`` may be ``None`` or unparsable, in which case the latest
    mapping is chosen.
    """

    snapshots = history.get(str(body_key), [])
    if not snapshots:
        return {}

    target = pd.to_datetime(date_str, errors="coerce")
    if pd.isna(target):
        # No usable date supplied -> fall back to latest endorsement.
        return dict(snapshots[-1][1])

    chosen: Dict[str, str] | None = None
    for ts, mapping in snapshots:
        if ts <= target:
            chosen = mapping
        else:
            break

    if chosen is None:
        return {}
    return dict(chosen)
