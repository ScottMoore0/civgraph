"""Utilities for extracting authoritative STV transfer dictionaries.

This module reads the raw ``Transfers`` worksheet emitted by the
``Full election tables`` workbook and reshapes it into structures that
are easier for the web API (and downstream animation code) to consume.

The primary entry point, :func:`build_transfer_event_lookup`, groups rows
by election, count, and transfer subject so the resulting dictionary is
keyed by election metadata and count number. Each transfer event includes
a summary of the source (single candidate or explicit combination), the
individual components that contribute to the transfer, and the
breakdowns for every destination candidate or the non-transferable pile.

The helper deliberately keeps the donor labels exactly as they appear in
``TransferName`` so that combination sources such as
"Michael Collins, Sorcha Eastwood, Fred Rodgers, Conor Campbell, Ellen
Murray" can be surfaced without decomposing them into individual
candidates. When the workbook omits explicit combination rows the helper
falls back to single-candidate labels, ensuring legacy elections still
produce usable dictionaries.
"""

from __future__ import annotations

import copy

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple
from typing import Literal, TypedDict
import math
import re

import pandas as pd


__all__ = [
    "ElectionKey",
    "TransferEvent",
    "build_transfer_event_lookup",
    "get_transfer_events_for_election",
]


ElectionKey = Tuple[str, str, str, str]
"""A normalised key identifying an election (date, event, constituency, body)."""


class TransferDestinationContribution(TypedDict, total=False):
    """Breakdown of a destination gain attributed to a specific donor component."""

    source_label: str
    amount: float
    source_person_id: Optional[int]
    source_party: Optional[str]


class TransferDestination(TypedDict, total=False):
    """Aggregate gains for a destination candidate or the non-transferable pile."""

    name: str
    party: Optional[str]
    amount: float
    type: Literal["candidate", "non_transferable"]
    person_id: Optional[int]
    breakdown: List[TransferDestinationContribution]


class TransferComponentBreakdown(TypedDict, total=False):
    """Breakdown entries for where a donor component's ballots ended up."""

    destination: str
    destination_type: Literal["candidate", "non_transferable"]
    destination_person_id: Optional[int]
    amount: float


class TransferSourceComponent(TypedDict, total=False):
    """Information about an individual donor within a combination."""

    label: str
    party: Optional[str]
    person_id: Optional[int]
    contribution: float
    loss: float
    breakdown: List[TransferComponentBreakdown]


class TransferSource(TypedDict, total=False):
    """Summary of the donor for a transfer event."""

    label: str
    party: Optional[str]
    classification: Literal["candidate", "combination", "unknown"]
    total_transferred: float
    components: List[TransferSourceComponent]
    subject_ids: List[int]
    subject_signature: str
    person_ids: List[int]
    is_surplus: bool
    is_exclusion: bool
    raw_subject: Optional[str]


class TransferEvent(TypedDict, total=False):
    """Structured representation of a per-count transfer event."""

    count: int
    subject_signature: str
    total_transferred: float
    source: TransferSource
    destinations: List[TransferDestination]


@dataclass(frozen=True)
class _GroupKey:
    election: ElectionKey
    count: int
    subject_signature: str


def _clean_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return ""
        text = ("{0:.0f}" if float(value).is_integer() else "{0}").format(float(value))
        return text.strip()
    return str(value).strip()


def _normalise_label(value: Any) -> str:
    text = _clean_str(value)
    return text.casefold() if text else ""


def _parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    text = _clean_str(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value):
            return None
        return int(round(value))
    text = _clean_str(value)
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _clean_str(value).casefold()
    if not text:
        return False
    return text in {"1", "true", "t", "yes", "y"}


def _subject_signature(value: Any) -> Tuple[str, List[int]]:
    """Normalise the ``TransferSubject`` column to a stable signature."""

    text = _clean_str(value)
    if not text:
        return "", []
    tokens = [tok.strip() for tok in re.split(r"[;,/]+", text) if tok.strip()]
    if not tokens:
        return "", []
    ids: List[int] = []
    extras: List[str] = []
    for token in tokens:
        try:
            number = int(float(token))
        except ValueError:
            extras.append(token.casefold())
        else:
            if number not in ids:
                ids.append(number)
    if ids:
        signature = ",".join(str(num) for num in ids)
        return signature, ids
    if extras:
        signature = "str:" + ",".join(dict.fromkeys(extras))
        return signature, []
    return text.replace(" ", ""), []


def _destination_label(result_type: str, name: str) -> str:
    if result_type == "nontransferable":
        return "Non-transferable votes"
    return name or "Unknown candidate"


def _classify_source(label: str, component_count: int, subject_ids: Iterable[int]) -> Literal[
    "candidate", "combination", "unknown"
]:
    label_norm = label.casefold()
    if component_count <= 0 and not label_norm:
        return "unknown"
    if component_count > 1:
        return "combination"
    if "," in label_norm or " and " in label_norm:
        return "combination"
    if len(list(subject_ids)) > 1:
        return "combination"
    return "candidate"


def _ensure_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df, pd.DataFrame):
        return df
    raise TypeError("Expected a pandas.DataFrame for transfers data")


def build_transfer_event_lookup(transfers_df: pd.DataFrame) -> Dict[ElectionKey, Dict[int, List[TransferEvent]]]:
    """Return a lookup of transfer events grouped by election and count.

    Parameters
    ----------
    transfers_df:
        DataFrame parsed from the ``Transfers`` worksheet. The helper tolerates
        minor column omissions but expects the standard columns produced by the
        workbook (``Date``, ``Event``, ``Constituency``, ``ElectedBody``,
        ``Count``, ``Transfers``, ``TransferName``, ``TransferSubject``,
        ``TransferParty``, ``ResultType`` and ``PersonID``/``SourcePersonID``).

    Returns
    -------
    dict
        ``{ election_key: { count_number: [TransferEvent, ...], ... }, ... }``
        where ``election_key`` is ``(date, event, constituency, elected_body)``.
    """

    df = _ensure_dataframe(transfers_df)
    if df is None or df.empty:
        return {}

    records = df.to_dict(orient="records")
    grouped: MutableMapping[_GroupKey, List[Dict[str, Any]]] = {}

    for record in records:
        date = _clean_str(record.get("Date"))
        event = _clean_str(record.get("Event"))
        constituency = _clean_str(record.get("Constituency"))
        body = _clean_str(record.get("ElectedBody"))
        count = _parse_int(record.get("Count"))
        if not count or count <= 0:
            continue
        subject_sig, _ = _subject_signature(record.get("TransferSubject"))
        donor_label = _normalise_label(record.get("TransferName"))
        if subject_sig:
            signature = f"subject:{subject_sig}"
        elif donor_label:
            signature = f"label:{donor_label}"
        else:
            # Fall back to the recipient information so the row still groups.
            recipient_label = _normalise_label(record.get("Name"))
            if recipient_label:
                signature = f"recipient:{recipient_label}"
            else:
                signature = f"row:{id(record)}"
        key = _GroupKey((date, event, constituency, body), count, signature)
        grouped.setdefault(key, []).append(record)

    lookup: Dict[ElectionKey, Dict[int, List[TransferEvent]]] = {}

    for key, rows in grouped.items():
        event_payload = _build_event_from_rows(key, rows)
        if not event_payload:
            continue
        election_map = lookup.setdefault(key.election, {})
        election_map.setdefault(key.count, []).append(event_payload)

    # Sort counts and ensure deterministic ordering of events per count.
    for election_map in lookup.values():
        for count, events in election_map.items():
            events.sort(key=lambda evt: evt["source"].get("label", ""))
        # Sort counts numerically when materialised later.

    return lookup


def get_transfer_events_for_election(
    lookup: Optional[Mapping[ElectionKey, Dict[int, List[TransferEvent]]]],
    election_key: ElectionKey,
) -> Dict[int, List[TransferEvent]]:
    """Return a deep-copied map of transfer events for a specific election.

    Parameters
    ----------
    lookup:
        The lookup produced by :func:`build_transfer_event_lookup`.
    election_key:
        Tuple ``(date, event, constituency, elected_body)`` identifying the
        election whose transfers should be returned.

    Returns
    -------
    dict
        ``{count_number: [TransferEvent, ...], ...}`` for the requested election.
        The returned structure is detached from the cached lookup so callers can
        mutate it without affecting global state.
    """

    if not lookup:
        return {}

    events = lookup.get(election_key)
    if not isinstance(events, dict):
        return {}

    result: Dict[int, List[TransferEvent]] = {}
    for count, payload in events.items():
        if not isinstance(payload, list):
            continue
        try:
            count_num = int(count)
        except Exception:
            continue
        result[count_num] = copy.deepcopy(payload)
    return result


def _build_event_from_rows(key: _GroupKey, rows: List[Dict[str, Any]]) -> Optional[TransferEvent]:
    if not rows:
        return None

    subject_signature_text = ""
    subject_ids: List[int] = []
    source_label: Optional[str] = None
    source_party: Optional[str] = None
    source_person_ids: List[int] = []
    is_surplus = False
    is_exclusion = False
    raw_subject: Optional[str] = None

    destination_lookup: Dict[Tuple[str, Optional[int], str], TransferDestination] = {}
    component_lookup: Dict[Any, TransferSourceComponent] = {}

    total_transferred = 0.0

    for record in rows:
        amount = _parse_float(record.get("Transfers"))
        if amount is None:
            continue

        subject_sig, ids = _subject_signature(record.get("TransferSubject"))
        if subject_sig and not subject_signature_text:
            subject_signature_text = subject_sig
        if ids:
            for ident in ids:
                if ident not in subject_ids:
                    subject_ids.append(ident)
        if raw_subject is None:
            raw_subject = _clean_str(record.get("TransferSubject")) or None

        donor_label_raw = _clean_str(record.get("TransferName"))
        donor_party_raw = _clean_str(record.get("TransferParty")) or None
        donor_label_norm = _normalise_label(donor_label_raw)
        donor_component_name = _clean_str(record.get("Name"))
        donor_component_party = _clean_str(record.get("Party")) or None

        src_person_id = _parse_int(record.get("SourcePersonID"))
        recipient_person_id = _parse_int(record.get("PersonID"))
        result_type = _normalise_label(record.get("ResultType"))

        is_surplus = is_surplus or _parse_bool(record.get("ElectedThisRound"))
        is_exclusion = is_exclusion or _parse_bool(record.get("EliminatedThisRound"))

        if amount < 0:
            component_key: Any
            if src_person_id is not None:
                component_key = ("pid", src_person_id)
            elif donor_label_norm:
                component_key = ("label", donor_label_norm)
            else:
                component_key = ("name", donor_component_name.casefold())

            component = component_lookup.setdefault(
                component_key,
                {
                    "label": donor_component_name or donor_label_raw or "Unknown source",
                    "party": donor_component_party or donor_party_raw,
                    "person_id": src_person_id or recipient_person_id,
                    "contribution": 0.0,
                    "loss": 0.0,
                    "breakdown": [],
                },
            )
            component["loss"] = component.get("loss", 0.0) + (-amount)
            if not component.get("label"):
                component["label"] = donor_label_raw or donor_component_name or "Unknown source"
            if not component.get("party"):
                component["party"] = donor_component_party or donor_party_raw
            pid = component.get("person_id")
            if pid is None and (src_person_id or recipient_person_id):
                component["person_id"] = src_person_id or recipient_person_id
            pid = component.get("person_id")
            if pid is not None and pid not in source_person_ids:
                source_person_ids.append(pid)
            if not source_label:
                source_label = donor_label_raw or donor_component_name or "Unknown source"
            elif donor_label_raw and ("," in donor_label_raw or len(subject_ids) > 1):
                # Prefer explicit combination labels when present.
                source_label = donor_label_raw
            if donor_party_raw and not source_party:
                source_party = donor_party_raw
            continue

        destination_type = "candidate" if result_type == "candidate" else "non_transferable"
        dest_name = _destination_label(destination_type, donor_component_name)
        dest_party = donor_component_party if destination_type == "candidate" else None

        dest_key = (destination_type, recipient_person_id, dest_name.casefold())
        destination = destination_lookup.setdefault(
            dest_key,
            {
                "name": dest_name,
                "party": dest_party,
                "amount": 0.0,
                "type": destination_type,
                "person_id": recipient_person_id,
                "breakdown": [],
            },
        )
        destination["amount"] += amount
        destination["party"] = destination.get("party") or dest_party
        destination["breakdown"].append(
            {
                "source_label": donor_label_raw or source_label or dest_name,
                "amount": amount,
                "source_person_id": src_person_id,
                "source_party": donor_party_raw,
            }
        )

        total_transferred += amount

        if donor_label_raw and not source_label:
            source_label = donor_label_raw
        if donor_party_raw and not source_party:
            source_party = donor_party_raw

        component_key: Any
        if src_person_id is not None:
            component_key = ("pid", src_person_id)
        elif donor_label_norm:
            component_key = ("label", donor_label_norm)
        else:
            component_key = ("name", dest_name.casefold())

        component = component_lookup.setdefault(
            component_key,
            {
                "label": donor_label_raw or donor_component_name or dest_name,
                "party": donor_party_raw or donor_component_party,
                "person_id": src_person_id,
                "contribution": 0.0,
                "loss": 0.0,
                "breakdown": [],
            },
        )
        component["contribution"] = component.get("contribution", 0.0) + amount
        if src_person_id is not None and component.get("person_id") is None:
            component["person_id"] = src_person_id
        if component.get("party") is None:
            component["party"] = donor_party_raw or donor_component_party
        component.setdefault("breakdown", []).append(
            {
                "destination": dest_name,
                "destination_type": destination_type,
                "destination_person_id": recipient_person_id,
                "amount": amount,
            }
        )
        pid = component.get("person_id")
        if pid is not None and pid not in source_person_ids:
            source_person_ids.append(pid)

    if not destination_lookup and not component_lookup:
        return None

    components: List[TransferSourceComponent] = []
    for component in component_lookup.values():
        contribution = float(component.get("contribution", 0.0))
        loss = float(component.get("loss", 0.0))
        component["breakdown"] = sorted(
            component.get("breakdown", []),
            key=lambda entry: (-entry.get("amount", 0.0), entry.get("destination", "")),
        )
        component["contribution"] = contribution
        component["loss"] = loss
        components.append(component)

    components.sort(key=lambda item: (-item.get("contribution", 0.0), item.get("label", "")))

    destinations = list(destination_lookup.values())
    destinations.sort(key=lambda entry: (-entry.get("amount", 0.0), entry.get("name", "")))

    if not source_label:
        source_label = "Unknown source"

    classification = _classify_source(source_label, len(components), subject_ids)

    source: TransferSource = {
        "label": source_label,
        "party": source_party,
        "classification": classification,
        "total_transferred": total_transferred if total_transferred else sum(
            item.get("contribution", 0.0) for item in components
        ),
        "components": components,
        "subject_ids": subject_ids,
        "subject_signature": subject_signature_text or key.subject_signature,
        "person_ids": sorted(source_person_ids),
        "is_surplus": bool(is_surplus and not is_exclusion),
        "is_exclusion": bool(is_exclusion),
        "raw_subject": raw_subject,
    }

    event: TransferEvent = {
        "count": key.count,
        "subject_signature": subject_signature_text or key.subject_signature,
        "total_transferred": source["total_transferred"],
        "source": source,
        "destinations": destinations,
    }

    return event
